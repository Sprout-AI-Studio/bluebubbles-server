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
        for (const i of webhooks) {
            const eventTypes = JSON.parse(i.events) as Array<string>;
            if (!eventTypes.includes("*") && !eventTypes.includes(event.type)) continue;
            this.log.debug(`Dispatching event to webhook: ${i.url}`);

            // We don't need to await this
            this.sendPost(i.url, event).catch(ex => {
                this.log.debug(`Failed to dispatch "${event.type}" event to webhook: ${i.url}`);
                this.log.debug(`  -> Error: ${ex?.message ?? String(ex)}`);
                this.log.debug(`  -> Status Text: ${ex?.response?.statusText}`);
            });
        }
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
