import axios, { AxiosError } from "axios";
import { Server } from "@server";
import { Loggable } from "@server/lib/logging/Loggable";
import { AsyncRetryer } from "@server/lib/decorators/AsyncRetryerDecorator";

export type WebhookEvent = {
    type: string;
    data: any;
};

/**
 * Handles dispatching webhooks
 */
export class WebhookService extends Loggable {
    tag = "WebhookService";

    async dispatch(event: WebhookEvent) {
        const webhooks = await Server().repo.getWebhooks();
        this.log.debug(`[WebhookService] Dispatching event "${event.type}" to ${webhooks.length} registered webhook(s)`);

        let dispatched = 0;
        for (const i of webhooks) {
            const eventTypes = JSON.parse(i.events) as Array<string>;
            if (!eventTypes.includes("*") && !eventTypes.includes(event.type)) {
                this.log.debug(`[WebhookService] Skipping webhook ${i.url} — not subscribed to "${event.type}"`);
                continue;
            }

            this.log.debug(`[WebhookService] Sending "${event.type}" to ${i.url}`);
            dispatched += 1;

            // We don't need to await this
            this.sendPost(i.url, event)
                .then(() => {
                    this.log.debug(`[WebhookService] Successfully delivered "${event.type}" to ${i.url}`);
                })
                .catch(ex => {
                    this.log.warn(`[WebhookService] Failed to deliver "${event.type}" to ${i.url} after all retries`);
                    this.log.warn(`  -> Error: ${ex?.message ?? String(ex)}`);
                    if (ex?.response) {
                        this.log.warn(`  -> HTTP ${ex.response.status} ${ex.response.statusText}`);
                    }
                });
        }

        this.log.debug(`[WebhookService] Dispatched "${event.type}" to ${dispatched}/${webhooks.length} webhook(s)`);
    }

    @AsyncRetryer({
        name: "WebhookService.sendPost",
        maxTries: 3,
        retryDelay: 5000,
        onError: (ex: AxiosError) => {
            // If the server responded (4xx/5xx), don't retry — it won't help
            if (ex?.response) return { skip: true };
            // Network-level failure — return null to trigger a retry
            return null;
        }
    })
    private async sendPost(url: string, event: WebhookEvent) {
        return await axios.post(url, event, {
            headers: { "Content-Type": "application/json" },
            timeout: 30000
        });
    }
}
