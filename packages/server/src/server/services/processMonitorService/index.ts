import { EventEmitter } from "events";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import { Loggable } from "@server/lib/logging/Loggable";
import { SentryService } from "../sentryService";
import { LifecycleManager } from "../lifecycleManager";

interface ProcessState {
    pid: number;
    name: string;
    startedAt: number;
}

interface LifecycleMessageInfo {
    messageGuid?: string;
    tempGuid?: string;
    chatGuid: string;
    timestamp: number;
}

const IMessageProcesses = [
    "imagent",
    "apsd",
    "IMDPersistenceAgent",
    "sharingd",
    "rapportd",
    "Messages",
    "IMDAgent"
];

const STRICT_LOG_FILTERS = {
    imagent: [
        "IMDMessage",
        "send",
        "deliver",
        "receive",
        "message",
        "error",
        "finish",
        "start"
    ],
    apsd: [
        "APS",
        "deliver",
        "push",
        "message",
        "notification",
        "error",
        "connection"
    ],
    sharingd: [
        "share",
        "relay",
        "handoff",
        "airdrop"
    ],
    rapportd: [
        "session",
        "handoff",
        "device"
    ]
};

interface ParsedLogEvent {
    processName: string;
    eventType: string;
    eventCategory: string;
    eventDetails: string;
    timestamp: number;
    messageGuid?: string;
    recipientId?: string;
    isError: boolean;
}

export class ProcessMonitorService extends Loggable {
    private static instance: ProcessMonitorService;
    private logStreamProcess: ChildProcessWithoutNullStreams | null = null;
    private pollInterval: NodeJS.Timeout | null = null;
    private runningProcesses = new Map<string, ProcessState>();
    private enabled = false;
    private recentMessages = new Map<string, LifecycleMessageInfo>();

    tag = "ProcessMonitorService";

    private constructor() {
        super();
    }

    static getInstance(): ProcessMonitorService {
        if (!ProcessMonitorService.instance) {
            ProcessMonitorService.instance = new ProcessMonitorService();
        }
        return ProcessMonitorService.instance;
    }

    start(): void {
        if (this.enabled) return;
        
        this.enabled = true;
        this.log.info("Starting process monitor service with strict event filtering...");
        
        this.startProcessPolling();
        this.startLogStream();
        
        this.log.info("Process monitor service started - capturing imagent, apsd, sharingd, rapportd events");
    }

    stop(): void {
        this.enabled = false;
        
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }

        if (this.logStreamProcess) {
            this.logStreamProcess.kill();
            this.logStreamProcess = null;
        }

        this.runningProcesses.clear();
        this.recentMessages.clear();
        this.log.info("Process monitor service stopped");
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    registerMessage(correlationId: string, info: LifecycleMessageInfo): void {
        if (info.messageGuid) {
            this.recentMessages.set(info.messageGuid, { ...info, timestamp: Date.now() });
        }
        if (info.tempGuid) {
            this.recentMessages.set(info.tempGuid, { ...info, timestamp: Date.now() });
        }
    }

    private startProcessPolling(): void {
        this.pollInterval = setInterval(() => {
            this.pollProcesses();
        }, 5000);

        this.pollProcesses();
    }

    private async pollProcesses(): Promise<void> {
        try {
            const { exec } = await import("child_process");
            const { promisify } = await import("util");
            const execAsync = promisify(exec);

            const { stdout } = await execAsync(
                `ps -ax -o pid,comm=NAME,args=ARGS | grep -E "${IMessageProcesses.join("|")}" | grep -v grep`
            );

            const currentPids = new Set<number>();
            const lines = stdout.split("\n").filter(Boolean);

            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 2) continue;

                const pid = parseInt(parts[0], 10);
                const name = parts[1];

                currentPids.add(pid);

                if (!this.runningProcesses.has(name)) {
                    this.runningProcesses.set(name, {
                        pid,
                        name,
                        startedAt: Date.now()
                    });

                    this.log.debug(`Process started: ${name} (PID: ${pid})`);
                }
            }

            for (const [name, state] of this.runningProcesses.entries()) {
                if (!currentPids.has(state.pid)) {
                    this.runningProcesses.delete(name);
                    this.log.debug(`Process stopped: ${name} (PID: ${state.pid})`);
                }
            }
        } catch (error) {
            this.log.debug(`Error polling processes: ${error}`);
        }
    }

    private startLogStream(): void {
        const predicate = IMessageProcesses
            .map(p => `process CONTAINS "${p}"`)
            .join(" OR ");

        try {
            this.logStreamProcess = spawn("log", [
                "stream",
                "--predicate", predicate,
                "--style", "json",
                "--level", "info"
            ]);

            this.logStreamProcess.stdout.on("data", (data: Buffer) => {
                this.handleLogData(data);
            });

            this.logStreamProcess.stderr.on("data", (data: Buffer) => {
                this.log.debug(`Log stream stderr: ${data.toString()}`);
            });

            this.logStreamProcess.on("close", (code) => {
                if (this.enabled) {
                    this.log.warn(`Log stream closed with code ${code}, restarting...`);
                    setTimeout(() => this.startLogStream(), 5000);
                }
            });

            this.log.info("Log stream started for iMessage processes");
        } catch (error) {
            this.log.error(`Failed to start log stream: ${error}`);
        }
    }

    private handleLogData(data: Buffer): void {
        const lines = data.toString().split("\n").filter(Boolean);

        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                this.processLogEntry(entry);
            } catch (error) {
            }
        }
    }

    private processLogEntry(entry: any): void {
        const timestamp = new Date(entry.timestamp).getTime();
        if (isNaN(timestamp)) return;

        const processName = entry.processImagePath?.split("/").pop() || entry.process || "unknown";
        const eventMessage = entry.eventMessage || "";

        if (!IMessageProcesses.some(p => processName.toLowerCase().includes(p.toLowerCase()))) {
            return;
        }

        const parsed = this.parseLogEvent(processName, eventMessage, timestamp);
        if (!parsed) return;

        const correlationId = this.correlateWithLifecycle(parsed);

        const logMessage = `[${parsed.processName}] ${parsed.eventType}: ${parsed.eventDetails}`;
        
        if (parsed.isError) {
            this.log.error(logMessage);
        } else {
            this.log.info(logMessage);
        }

        SentryService.logProcessEvent({
            processName: parsed.processName,
            eventType: parsed.eventType,
            eventDetails: parsed.eventDetails,
            timestamp: parsed.timestamp,
            correlationId,
            messageGuid: parsed.messageGuid
        });
    }

    private parseLogEvent(processName: string, eventMessage: string, timestamp: number): ParsedLogEvent | null {
        const lower = eventMessage.toLowerCase();
        const processLower = processName.toLowerCase();

        let eventType = "unknown";
        let eventCategory = "general";
        let messageGuid: string | undefined;
        let recipientId: string | undefined;
        let isError = lower.includes("error") || lower.includes("fail") || lower.includes("denied");

        if (processLower.includes("imagent")) {
            if (lower.includes("send") && lower.includes("start")) {
                eventType = "IMAGENT_SEND_START";
                eventCategory = "send";
            } else if (lower.includes("send") && (lower.includes("finish") || lower.includes("complete"))) {
                eventType = "IMAGENT_SEND_FINISH";
                eventCategory = "send";
            } else if (lower.includes("send") && lower.includes("error")) {
                eventType = "IMAGENT_SEND_ERROR";
                eventCategory = "error";
                isError = true;
            } else if (lower.includes("deliver") && lower.includes("error")) {
                eventType = "IMAGENT_DELIVERY_ERROR";
                eventCategory = "error";
                isError = true;
            } else if (lower.includes("deliver")) {
                eventType = "IMAGENT_DELIVERY";
                eventCategory = "delivery";
            } else if (lower.includes("receive") || lower.includes("incoming")) {
                eventType = "IMAGENT_RECEIVED";
                eventCategory = "receive";
            } else if (lower.includes("message") && lower.includes("new")) {
                eventType = "IMAGENT_NEW_MESSAGE";
                eventCategory = "receive";
            } else if (lower.includes("store") || lower.includes("persist")) {
                eventType = "IMAGENT_STORE";
                eventCategory = "storage";
            } else if (lower.includes("sync")) {
                eventType = "IMAGENT_SYNC";
                eventCategory = "sync";
            } else {
                eventType = "IMAGENT_OTHER";
                eventCategory = "general";
            }

            const guidMatch = eventMessage.match(/GUID[:\s]+([^\s,]+)/i);
            if (guidMatch) messageGuid = guidMatch[1];

            const recipientMatch = eventMessage.match(/(?:to|recipient)[:\s]+([^\s,]+)/i);
            if (recipientMatch) recipientId = recipientMatch[1];

        } else if (processLower.includes("apsd")) {
            if (lower.includes("deliver") && lower.includes("start")) {
                eventType = "APSD_DELIVER_START";
                eventCategory = "delivery";
            } else if (lower.includes("deliver") && lower.includes("finish")) {
                eventType = "APSD_DELIVER_FINISH";
                eventCategory = "delivery";
            } else if (lower.includes("deliver") && lower.includes("error")) {
                eventType = "APSD_DELIVERY_ERROR";
                eventCategory = "error";
                isError = true;
            } else if (lower.includes("push") && lower.includes("sent")) {
                eventType = "APSD_PUSH_SENT";
                eventCategory = "delivery";
            } else if (lower.includes("push") && lower.includes("error")) {
                eventType = "APSD_PUSH_ERROR";
                eventCategory = "error";
                isError = true;
            } else if (lower.includes("connection") && lower.includes("error")) {
                eventType = "APSD_CONNECTION_ERROR";
                eventCategory = "error";
                isError = true;
            } else if (lower.includes("connect")) {
                eventType = "APSD_CONNECT";
                eventCategory = "connection";
            } else if (lower.includes("disconnect")) {
                eventType = "APSD_DISCONNECT";
                eventCategory = "connection";
            } else {
                eventType = "APSD_OTHER";
                eventCategory = "general";
            }

        } else if (processLower.includes("sharingd")) {
            if (lower.includes("relay") && lower.includes("request")) {
                eventType = "SHARINGD_RELAY_REQUEST";
                eventCategory = "relay";
            } else if (lower.includes("relay") && lower.includes("response")) {
                eventType = "SHARINGD_RELAY_RESPONSE";
                eventCategory = "relay";
            } else if (lower.includes("relay") && (lower.includes("error") || lower.includes("fail"))) {
                eventType = "SHARINGD_RELAY_ERROR";
                eventCategory = "error";
                isError = true;
            } else if (lower.includes("handoff")) {
                eventType = "SHARINGD_HANDOFF";
                eventCategory = "handoff";
            } else if (lower.includes("airdrop")) {
                eventType = "SHARINGD_AIRDROP";
                eventCategory = "airdrop";
            } else {
                eventType = "SHARINGD_OTHER";
                eventCategory = "general";
            }

        } else if (processLower.includes("rapportd")) {
            if (lower.includes("session") && lower.includes("active")) {
                eventType = "RAPPORTD_SESSION_ACTIVE";
                eventCategory = "session";
            } else if (lower.includes("session") && lower.includes("end")) {
                eventType = "RAPPORTD_SESSION_END";
                eventCategory = "session";
            } else if (lower.includes("handoff")) {
                eventType = "RAPPORTD_HANDOFF";
                eventCategory = "handoff";
            } else {
                eventType = "RAPPORTD_OTHER";
                eventCategory = "general";
            }

        } else {
            return null;
        }

        return {
            processName,
            eventType,
            eventCategory,
            eventDetails: eventMessage.substring(0, 500),
            timestamp,
            messageGuid,
            recipientId,
            isError
        };
    }

    private correlateWithLifecycle(parsed: ParsedLogEvent): string | undefined {
        const lifecycleManager = LifecycleManager.getInstance();
        const timeWindow = 30000;
        const now = Date.now();

        if (parsed.messageGuid) {
            const lifecycle = lifecycleManager.getByMessageGuid(parsed.messageGuid);
            if (lifecycle) {
                return lifecycle.correlationId;
            }
        }

        for (const [correlationId, lifecycle] of lifecycleManager["activeLifecycles"]) {
            if (now - lifecycle.startTime > timeWindow) continue;

            const stepTimes = Array.from(lifecycle.steps.values()).map(s => s.timestamp);
            const closestStepTime = stepTimes.reduce((prev, curr) => {
                return Math.abs(curr - parsed.timestamp) < Math.abs(prev - parsed.timestamp) ? curr : prev;
            }, lifecycle.startTime);

            if (Math.abs(closestStepTime - parsed.timestamp) < timeWindow) {
                return correlationId;
            }
        }

        return undefined;
    }

    getRunningProcesses(): string[] {
        return Array.from(this.runningProcesses.keys());
    }
}
