import axios from "axios";
import { Server } from "@server";
import { Loggable } from "@server/lib/logging/Loggable";
import { ScheduledService } from "@server/lib/ScheduledService";
import { AsyncRetryer } from "@server/lib/decorators/AsyncRetryerDecorator";

type SlackBlock =
    | { type: "header"; text: { type: "plain_text"; text: string; emoji?: boolean } }
    | { type: "section"; text: { type: "mrkdwn"; text: string }; fields?: Array<{ type: "mrkdwn"; text: string }> }
    | { type: "section"; fields: Array<{ type: "mrkdwn"; text: string }> }
    | { type: "divider" }
    | { type: "context"; elements: Array<{ type: "mrkdwn"; text: string }> };

export class SlackAlertService extends Loggable {
    tag = "SlackAlertService";

    private lastReceivedTimestamp: Date | null = null;
    private lastSentTimestamp: Date | null = null;
    private lastNoReceiveAlertTime: Date | null = null;
    private lastNoSendAlertTime: Date | null = null;
    private lastDailyReportDate: string | null = null;
    private hourlyCounts: Array<{ hour: Date; sent: number; received: number }> = [];
    private lastActivityDropAlertHour = -1;
    private serviceLoop: ScheduledService;
    private isStopped = false;

    async start() {
        this.isStopped = false;
        this.log.info("Starting Slack Alert Service...");

        // Seed timestamps from DB
        try {
            await this.seedTimestamps();
        } catch (ex: any) {
            this.log.warn(`Failed to seed timestamps: ${ex?.message ?? String(ex)}`);
        }

        // If we're already past the report hour today, mark today as done
        // so we don't fire the daily report immediately on restart
        this.seedDailyReportDate();

        // Seed hourly counts from DB so activity drop alerts work immediately
        try {
            await this.seedHourlyCounts();
        } catch (ex: any) {
            this.log.warn(`Failed to seed hourly counts: ${ex?.message ?? String(ex)}`);
        }

        this.serviceLoop = new ScheduledService(async () => {
            if (this.isStopped) {
                this.serviceLoop.stop();
                return;
            }

            try {
                await this.runChecks();
            } catch (ex: any) {
                this.log.error(`Error running Slack alert checks: ${ex?.message ?? String(ex)}`);
            }
        }, 60000);
    }

    stop() {
        this.isStopped = true;
        this.serviceLoop?.stop();
        this.lastReceivedTimestamp = null;
        this.lastSentTimestamp = null;
        this.lastNoReceiveAlertTime = null;
        this.lastNoSendAlertTime = null;
        this.lastDailyReportDate = null;
        this.hourlyCounts = [];
        this.lastActivityDropAlertHour = -1;
        this.log.info("Slack Alert Service stopped.");
    }

    private async seedTimestamps() {
        const repo = Server().iMessageRepo;
        if (!repo) return;

        // Get most recent received message
        const [receivedMessages] = await repo.getMessages({
            limit: 1,
            sort: "DESC",
            where: [{ statement: "message.is_from_me = 0", args: {} }, ...this.getServiceFilter()]
        });
        if (receivedMessages.length > 0 && receivedMessages[0].dateCreated) {
            this.lastReceivedTimestamp = receivedMessages[0].dateCreated;
        }

        // Get most recent sent message
        const [sentMessages] = await repo.getMessages({
            limit: 1,
            sort: "DESC",
            where: [{ statement: "message.is_from_me = 1", args: {} }, ...this.getServiceFilter()]
        });
        if (sentMessages.length > 0 && sentMessages[0].dateCreated) {
            this.lastSentTimestamp = sentMessages[0].dateCreated;
        }

        this.log.info(
            `Seeded timestamps - Last received: ${this.lastReceivedTimestamp?.toISOString() ?? "none"}, ` +
            `Last sent: ${this.lastSentTimestamp?.toISOString() ?? "none"}`
        );
    }

    private async seedHourlyCounts() {
        const repo = Server().iMessageRepo;
        if (!repo) return;

        const now = new Date();
        const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

        // Query the past 24 hours, one entry per hour
        for (let i = 23; i >= 0; i--) {
            const hourStart = new Date(currentHour.getTime() - i * 60 * 60 * 1000);
            const hourEnd = new Date(hourStart.getTime() + 60 * 60 * 1000);

            const sent = await repo.getMessageCount({ after: hourStart, before: hourEnd, isFromMe: true });
            const total = await repo.getMessageCount({ after: hourStart, before: hourEnd });
            this.hourlyCounts.push({ hour: hourStart, sent, received: total - sent });
        }

        this.log.info(`Seeded ${this.hourlyCounts.length} hourly count entries from DB history.`);
    }

    private seedDailyReportDate() {
        try {
            const reportHour = Server().repo.getConfig("slack_daily_report_hour") as number ?? 9;
            const timezone = Server().repo.getConfig("slack_daily_report_timezone") as string ?? "America/New_York";

            const now = new Date();
            const formatter = new Intl.DateTimeFormat("en-US", {
                timeZone: timezone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                hour12: false
            });

            const parts = formatter.formatToParts(now);
            const currentHour = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);

            if (currentHour >= reportHour) {
                const currentYear = parts.find(p => p.type === "year")?.value;
                const currentMonth = parts.find(p => p.type === "month")?.value;
                const currentDay = parts.find(p => p.type === "day")?.value;
                this.lastDailyReportDate = `${currentYear}-${currentMonth}-${currentDay}`;
                this.log.info(`Past report hour (${reportHour}:00 ${timezone}), skipping daily report until tomorrow.`);
            }
        } catch (ex: any) {
            this.log.warn(`Failed to seed daily report date: ${ex?.message ?? String(ex)}`);
        }
    }

    private async runChecks() {
        if (!this.isEnabled()) return;

        await this.checkNoReceive();
        await this.checkNoSend();
        await this.checkActivityDrop();
        await this.checkDailyReport();
    }

    private async checkNoReceive() {
        const repo = Server().iMessageRepo;
        if (!repo) return;

        const thresholdMinutes = Server().repo.getConfig("slack_alert_no_receive_minutes") as number ?? 10;

        const [messages] = await repo.getMessages({
            limit: 1,
            sort: "DESC",
            where: [{ statement: "message.is_from_me = 0", args: {} }, ...this.getServiceFilter()]
        });

        const latestTimestamp = messages.length > 0 ? messages[0].dateCreated : null;

        if (latestTimestamp && (!this.lastReceivedTimestamp || latestTimestamp > this.lastReceivedTimestamp)) {
            if (this.lastNoReceiveAlertTime !== null) {
                this.log.info("New received message detected, resetting no-receive alert.");
            }
            this.lastReceivedTimestamp = latestTimestamp;
            this.lastNoReceiveAlertTime = null;
            return;
        }

        const referenceTime = this.lastReceivedTimestamp ?? new Date();
        const gapMs = Date.now() - referenceTime.getTime();
        const gapMinutes = gapMs / (1000 * 60);

        if (gapMinutes <= thresholdMinutes) return;

        // Alert if: never alerted, or enough time has passed since last alert (re-alert every threshold interval)
        const msSinceLastAlert = this.lastNoReceiveAlertTime
            ? Date.now() - this.lastNoReceiveAlertTime.getTime()
            : Infinity;
        const shouldAlert = this.lastNoReceiveAlertTime === null ||
            msSinceLastAlert >= thresholdMinutes * 60 * 1000;

        if (shouldAlert) {
            this.lastNoReceiveAlertTime = new Date();
            const gapDisplay = Math.round(gapMinutes);
            const lastTime = this.lastReceivedTimestamp?.toLocaleString("en-US", { timeZone: "UTC" }) ?? "N/A";

            await this.sendSlackBlocks([
                { type: "header", text: { type: "plain_text", text: `\u26a0\ufe0f No Messages Received (${this.getServiceFilterLabel()})`, emoji: true } },
                { type: "section", fields: [
                    { type: "mrkdwn", text: `*Duration:*\n${gapDisplay} minutes` },
                    { type: "mrkdwn", text: `*Threshold:*\n${thresholdMinutes} minutes` }
                ]},
                { type: "section", text: { type: "mrkdwn", text: `*Last received:* ${lastTime}` } },
                { type: "divider" },
                this.buildAlertContext("Check if the iPhone is connected and iMessage is forwarding properly.")
            ]);
        }
    }

    private async checkNoSend() {
        const repo = Server().iMessageRepo;
        if (!repo) return;

        const thresholdMinutes = Server().repo.getConfig("slack_alert_no_send_minutes") as number ?? 10;

        const [messages] = await repo.getMessages({
            limit: 1,
            sort: "DESC",
            where: [{ statement: "message.is_from_me = 1", args: {} }, ...this.getServiceFilter()]
        });

        const latestTimestamp = messages.length > 0 ? messages[0].dateCreated : null;

        if (latestTimestamp && (!this.lastSentTimestamp || latestTimestamp > this.lastSentTimestamp)) {
            if (this.lastNoSendAlertTime !== null) {
                this.log.info("New sent message detected, resetting no-send alert.");
            }
            this.lastSentTimestamp = latestTimestamp;
            this.lastNoSendAlertTime = null;
            return;
        }

        const referenceTime = this.lastSentTimestamp ?? new Date();
        const gapMs = Date.now() - referenceTime.getTime();
        const gapMinutes = gapMs / (1000 * 60);

        if (gapMinutes <= thresholdMinutes) return;

        const msSinceLastAlert = this.lastNoSendAlertTime
            ? Date.now() - this.lastNoSendAlertTime.getTime()
            : Infinity;
        const shouldAlert = this.lastNoSendAlertTime === null ||
            msSinceLastAlert >= thresholdMinutes * 60 * 1000;

        if (shouldAlert) {
            this.lastNoSendAlertTime = new Date();
            const gapDisplay = Math.round(gapMinutes);
            const lastTime = this.lastSentTimestamp?.toLocaleString("en-US", { timeZone: "UTC" }) ?? "N/A";

            await this.sendSlackBlocks([
                { type: "header", text: { type: "plain_text", text: `\u26a0\ufe0f No Messages Sent (${this.getServiceFilterLabel()})`, emoji: true } },
                { type: "section", fields: [
                    { type: "mrkdwn", text: `*Duration:*\n${gapDisplay} minutes` },
                    { type: "mrkdwn", text: `*Threshold:*\n${thresholdMinutes} minutes` }
                ]},
                { type: "section", text: { type: "mrkdwn", text: `*Last sent:* ${lastTime}` } },
                { type: "divider" },
                this.buildAlertContext("SMS forwarding or outgoing message delivery may be impacted.")
            ]);
        }
    }

    private async checkActivityDrop() {
        const repo = Server().iMessageRepo;
        if (!repo) return;

        const dropPercent = Server().repo.getConfig("slack_activity_drop_percent") as number ?? 50;

        const now = new Date();
        const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

        // Remove entries older than 24 hours
        const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        this.hourlyCounts = this.hourlyCounts.filter(entry => entry.hour >= cutoff);

        let currentEntry = this.hourlyCounts.find(e => e.hour.getTime() === currentHour.getTime());
        if (!currentEntry) {
            const hourStart = currentHour;
            const hourEnd = new Date(currentHour.getTime() + 60 * 60 * 1000);
            const sent = await repo.getMessageCount({ after: hourStart, before: hourEnd, isFromMe: true });
            const received = await repo.getMessageCount({ after: hourStart, before: hourEnd });
            currentEntry = { hour: currentHour, sent, received: received - sent };
            this.hourlyCounts.push(currentEntry);
        } else {
            const hourStart = currentHour;
            const hourEnd = new Date(currentHour.getTime() + 60 * 60 * 1000);
            const sent = await repo.getMessageCount({ after: hourStart, before: hourEnd, isFromMe: true });
            const received = await repo.getMessageCount({ after: hourStart, before: hourEnd });
            currentEntry.sent = sent;
            currentEntry.received = received - sent;
        }

        // Need at least 6 hours of data to compare
        const previousEntries = this.hourlyCounts.filter(e => e.hour.getTime() < currentHour.getTime());
        if (previousEntries.length < 6) return;

        const avgTotal = previousEntries.reduce((sum, e) => sum + e.sent + e.received, 0) / previousEntries.length;
        const currentTotal = currentEntry.sent + currentEntry.received;

        // Skip if average is very low (avoid false alerts)
        if (avgTotal < 2) return;

        const thresholdValue = avgTotal * ((100 - dropPercent) / 100);
        if (currentTotal < thresholdValue && this.lastActivityDropAlertHour !== currentHour.getHours()) {
            this.lastActivityDropAlertHour = currentHour.getHours();
            const dropActual = avgTotal > 0 ? Math.round((1 - currentTotal / avgTotal) * 100) : 0;
            const hourLabel = currentHour.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

            await this.sendSlackBlocks([
                { type: "header", text: { type: "plain_text", text: "\ud83d\udcc9 Activity Drop Detected", emoji: true } },
                { type: "section", fields: [
                    { type: "mrkdwn", text: `*Current Hour:*\n${currentTotal} messages` },
                    { type: "mrkdwn", text: `*Hourly Average:*\n${Math.round(avgTotal)} messages` }
                ]},
                { type: "section", fields: [
                    { type: "mrkdwn", text: `*Drop:*\n${dropActual}%` },
                    { type: "mrkdwn", text: `*Threshold:*\n${dropPercent}%` }
                ]},
                { type: "divider" },
                this.buildAlertContext(`Detected at ${hourLabel} \u2022 Based on ${previousEntries.length}h of data \u2022 This could indicate a connectivity issue`)
            ]);
        }
    }

    private async checkDailyReport() {
        const repo = Server().iMessageRepo;
        if (!repo) return;

        const reportHour = Server().repo.getConfig("slack_daily_report_hour") as number ?? 9;
        const timezone = Server().repo.getConfig("slack_daily_report_timezone") as string ?? "America/New_York";

        // Get current time in configured timezone
        const now = new Date();
        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            hour12: false
        });

        const parts = formatter.formatToParts(now);
        const currentHour = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
        const currentYear = parts.find(p => p.type === "year")?.value;
        const currentMonth = parts.find(p => p.type === "month")?.value;
        const currentDay = parts.find(p => p.type === "day")?.value;
        const today = `${currentYear}-${currentMonth}-${currentDay}`;

        if (currentHour < reportHour) return;
        if (this.lastDailyReportDate === today) return;

        this.lastDailyReportDate = today;

        // Calculate yesterday's date in the configured timezone
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const yesterdayFormatter = new Intl.DateTimeFormat("en-US", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        });
        const yParts = yesterdayFormatter.formatToParts(yesterday);
        const yYear = parseInt(yParts.find(p => p.type === "year")?.value ?? "0", 10);
        const yMonth = parseInt(yParts.find(p => p.type === "month")?.value ?? "1", 10) - 1;
        const yDay = parseInt(yParts.find(p => p.type === "day")?.value ?? "1", 10);

        // Create date range in the configured timezone (5 AM to 11:59 PM)
        const windowStart = this.dateInTimezone(yYear, yMonth, yDay, 5, 0, timezone);
        const windowEnd = this.dateInTimezone(yYear, yMonth, yDay, 23, 59, timezone);

        // Fetch all sent messages with chats and participants for reach calculation
        const [sentMessages] = await repo.getMessages({
            after: windowStart,
            before: windowEnd,
            withChats: true,
            withChatParticipants: true,
            withAttachments: false,
            limit: 10000,
            sort: "DESC",
            where: [{ statement: "message.is_from_me = 1", args: {} }]
        });

        // Aggregate by service type (iMessage, SMS, RCS, etc.)
        const serviceStats: Record<string, { msgCount: number; reach: number }> = {};

        for (const msg of sentMessages) {
            const chat = msg.chats?.[0];
            // Participant count excludes self (iMessage DB stores only other handles)
            const participantCount = chat?.participants?.length ?? 1;
            const service = msg.service ?? "iMessage";

            if (!serviceStats[service]) {
                serviceStats[service] = { msgCount: 0, reach: 0 };
            }
            serviceStats[service].msgCount += 1;
            serviceStats[service].reach += participantCount;
        }

        // Get received count
        const totalCount = await repo.getMessageCount({ after: windowStart, before: windowEnd });
        const totalSent = Object.values(serviceStats).reduce((sum, s) => sum + s.msgCount, 0);
        const receivedCount = totalCount - totalSent;
        const totalReach = Object.values(serviceStats).reduce((sum, s) => sum + s.reach, 0);

        const dateLabel = `${yYear}-${String(yMonth + 1).padStart(2, "0")}-${String(yDay).padStart(2, "0")}`;

        // Build service breakdown fields (2 per row in Slack's field layout)
        const serviceFields: Array<{ type: "mrkdwn"; text: string }> = [];
        for (const [service, stats] of Object.entries(serviceStats).sort(([a], [b]) => a.localeCompare(b))) {
            serviceFields.push(
                { type: "mrkdwn", text: `*${service}*\n${stats.msgCount} sent \u2192 ${stats.reach} reached` }
            );
        }

        const blocks: SlackBlock[] = [
            { type: "header", text: { type: "plain_text", text: `\ud83d\udcf0 Daily Message Report \u2014 ${dateLabel}`, emoji: true } },
            { type: "divider" }
        ];

        // Service breakdown
        if (serviceFields.length > 0) {
            blocks.push({ type: "section", fields: serviceFields } as SlackBlock);
        }

        // Summary stats
        blocks.push(
            { type: "divider" },
            { type: "section", fields: [
                { type: "mrkdwn", text: `*Total Sent*\n${totalSent} messages` },
                { type: "mrkdwn", text: `*People Reached*\n${totalReach}` }
            ]},
            { type: "section", fields: [
                { type: "mrkdwn", text: `*Received*\n${receivedCount} messages` },
                { type: "mrkdwn", text: `*Grand Total*\n${totalCount} messages` }
            ]},
            { type: "divider" },
            { type: "context", elements: [
                { type: "mrkdwn", text: `*Env:* ${this.getEnvironmentLabel()} \u2022 Window: 5:00 AM \u2013 11:59 PM (${timezone}) \u2022 BlueBubbles Server` }
            ]}
        );

        await this.sendSlackBlocks(blocks);
    }

    private getServiceFilter(): Array<{ statement: string; args: Record<string, any> }> {
        const filter = Server().repo.getConfig("slack_alert_message_filter") as string ?? "all";
        if (filter === "all") return [];
        return [{ statement: "message.service = :service", args: { service: filter } }];
    }

    private getServiceFilterLabel(): string {
        const filter = Server().repo.getConfig("slack_alert_message_filter") as string ?? "all";
        return filter === "all" ? "All" : filter;
    }

    private getEnvironmentLabel(): string {
        const env = Server().repo.getConfig("custom_environment") as string ?? "";
        return env || process.env.NODE_ENV || "unknown";
    }

    private buildAlertContext(defaultText: string): SlackBlock {
        const customMessage = Server().repo.getConfig("slack_alert_custom_message") as string ?? "";
        const env = this.getEnvironmentLabel();
        const elements: Array<{ type: "mrkdwn"; text: string }> = [
            { type: "mrkdwn", text: `*Env:* ${env} \u2022 ${defaultText}` }
        ];
        if (customMessage) {
            elements.push({ type: "mrkdwn", text: customMessage });
        }
        return { type: "context", elements };
    }

    private dateInTimezone(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
        const tempDate = new Date(dateStr + "Z");
        const utcStr = tempDate.toLocaleString("en-US", { timeZone: "UTC" });
        const tzStr = tempDate.toLocaleString("en-US", { timeZone: timezone });
        const utcDate = new Date(utcStr);
        const tzDate = new Date(tzStr);
        const offsetMs = utcDate.getTime() - tzDate.getTime();
        return new Date(tempDate.getTime() + offsetMs);
    }

    @AsyncRetryer({
        name: "SlackAlertService.sendSlack",
        maxTries: 3,
        retryDelay: 5000,
        onSuccess: () => true,
        retryCondition: (data: any) => !data
    })
    private async sendSlackBlocks(blocks: SlackBlock[]): Promise<void> {
        const webhookUrl = Server().repo.getConfig("slack_webhook_url") as string;
        if (!webhookUrl) {
            this.log.warn("Slack webhook URL is not configured, skipping alert.");
            return;
        }

        const channel = Server().repo.getConfig("slack_channel") as string;

        // Extract a plain text fallback from the first header or section block
        const fallback = blocks.find(b => b.type === "header" || b.type === "section");
        const text = fallback?.type === "header"
            ? (fallback as any).text.text
            : (fallback as any)?.text?.text ?? "BlueBubbles Alert";

        const payload: Record<string, any> = { text, blocks };
        if (channel) {
            payload.channel = channel;
        }

        this.log.info(`Sending Slack alert: ${text}`);
        await axios.post(webhookUrl, payload);
    }

    private isEnabled(): boolean {
        const enabled = Server().repo.getConfig("slack_alerts_enabled") as boolean;
        const webhookUrl = Server().repo.getConfig("slack_webhook_url") as string;
        return !!enabled && !!webhookUrl;
    }
}
