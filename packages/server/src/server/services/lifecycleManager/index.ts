import { EventEmitter } from "events";
import { Loggable } from "@server/lib/logging/Loggable";
import { SentryService } from "../sentryService";
import { ProcessMonitorService } from "../processMonitorService";

export interface LifecycleData {
    correlationId: string;
    messageGuid?: string;
    tempGuid?: string;
    chatGuid: string;
    sender?: string;
    text?: string;
    isFromMe: boolean;
    direction: "incoming" | "outgoing";
    startTime: number;
    steps: Map<number, { name: string; timestamp: number; details?: string; error?: string }>;
}

export const LIFECYCLE_STEPS = {
    INCOMING: {
        1: "External Received",
        2: "Mac Process Received",
        3: "macOS Processed",
        4: "iMessage Stored",
        5: "ChatDB Updated",
        6: "BlueBubbles Received",
        7: "Message Parsed",
        8: "Webhook Dispatched"
    },
    OUTGOING: {
        1: "Message Queued",
        2: "Private API Called",
        3: "imagent Send Start",
        4: "imagent Send Finish",
        5: "apsd Delivering",
        6: "Message Sent to Apple",
        7: "Delivery Confirmed",
        8: "Client Notified"
    }
} as const;

export class LifecycleManager extends Loggable {
    private static instance: LifecycleManager;
    private activeLifecycles = new Map<string, LifecycleData>();
    private guidToCorrelation = new Map<string, string>();
    private tempGuidToCorrelation = new Map<string, string>();
    private cleanupInterval: NodeJS.Timeout | null = null;

    tag = "LifecycleManager";

    private constructor() {
        super();
        this.startCleanupInterval();
    }

    static getInstance(): LifecycleManager {
        if (!LifecycleManager.instance) {
            LifecycleManager.instance = new LifecycleManager();
        }
        return LifecycleManager.instance;
    }

    private startCleanupInterval(): void {
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60 * 60 * 1000);
    }

    private cleanup(): void {
        const now = Date.now();
        const maxAge = 60 * 60 * 1000;

        for (const [correlationId, data] of this.activeLifecycles.entries()) {
            if (now - data.startTime > maxAge) {
                this.activeLifecycles.delete(correlationId);
                if (data.messageGuid) {
                    this.guidToCorrelation.delete(data.messageGuid);
                }
                if (data.tempGuid) {
                    this.tempGuidToCorrelation.delete(data.tempGuid);
                }
            }
        }
    }

    generateCorrelationId(): string {
        return `lifecycle-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    startIncomingLifecycle(correlationId: string, data: {
        messageGuid: string;
        chatGuid: string;
        sender?: string;
        text?: string;
    }): void {
        const lifecycle: LifecycleData = {
            correlationId,
            messageGuid: data.messageGuid,
            chatGuid: data.chatGuid,
            sender: data.sender,
            text: data.text,
            isFromMe: false,
            direction: "incoming",
            startTime: Date.now(),
            steps: new Map()
        };

        this.activeLifecycles.set(correlationId, lifecycle);
        this.guidToCorrelation.set(data.messageGuid, correlationId);

        if (ProcessMonitorService.getInstance().isEnabled()) {
            ProcessMonitorService.getInstance().registerMessage(correlationId, {
                messageGuid: data.messageGuid,
                chatGuid: data.chatGuid,
                timestamp: Date.now()
            });
        }

        this.log.debug(`Started incoming lifecycle: ${correlationId} for message: ${data.messageGuid}`);
    }

    startOutgoingLifecycle(correlationId: string, data: {
        tempGuid: string;
        chatGuid: string;
        text?: string;
    }): void {
        const lifecycle: LifecycleData = {
            correlationId,
            tempGuid: data.tempGuid,
            chatGuid: data.chatGuid,
            text: data.text,
            isFromMe: true,
            direction: "outgoing",
            startTime: Date.now(),
            steps: new Map()
        };

        this.activeLifecycles.set(correlationId, lifecycle);
        this.tempGuidToCorrelation.set(data.tempGuid, correlationId);

        if (ProcessMonitorService.getInstance().isEnabled()) {
            ProcessMonitorService.getInstance().registerMessage(correlationId, {
                tempGuid: data.tempGuid,
                chatGuid: data.chatGuid,
                timestamp: Date.now()
            });
        }

        this.log.debug(`Started outgoing lifecycle: ${correlationId} for tempGuid: ${data.tempGuid}`);
    }

    recordStep(correlationId: string, step: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, details?: string): void {
        const lifecycle = this.activeLifecycles.get(correlationId);
        if (!lifecycle) {
            this.log.warn(`Lifecycle not found: ${correlationId}`);
            return;
        }

        const steps = lifecycle.direction === "incoming" ? LIFECYCLE_STEPS.INCOMING : LIFECYCLE_STEPS.OUTGOING;
        const stepName = steps[step] as string;
        const timestamp = Date.now();

        lifecycle.steps.set(step, {
            name: stepName,
            timestamp,
            details
        });

        SentryService.logLifecycleStep({
            correlationId,
            step,
            stepName,
            direction: lifecycle.direction,
            timestamp,
            messageGuid: lifecycle.messageGuid,
            tempGuid: lifecycle.tempGuid,
            chatGuid: lifecycle.chatGuid,
            sender: lifecycle.sender,
            text: lifecycle.text,
            details
        });

        this.log.debug(`Recorded step ${step}: ${stepName} for ${correlationId}`);
    }

    recordStepError(correlationId: string, step: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, error: string, details?: string): void {
        const lifecycle = this.activeLifecycles.get(correlationId);
        if (!lifecycle) {
            this.log.warn(`Lifecycle not found: ${correlationId}`);
            return;
        }

        const steps = lifecycle.direction === "incoming" ? LIFECYCLE_STEPS.INCOMING : LIFECYCLE_STEPS.OUTGOING;
        const stepName = steps[step] as string;
        const timestamp = Date.now();

        lifecycle.steps.set(step, {
            name: stepName,
            timestamp,
            details,
            error
        });

        SentryService.logLifecycleStep({
            correlationId,
            step,
            stepName,
            direction: lifecycle.direction,
            timestamp,
            messageGuid: lifecycle.messageGuid,
            tempGuid: lifecycle.tempGuid,
            chatGuid: lifecycle.chatGuid,
            sender: lifecycle.sender,
            text: lifecycle.text,
            details,
            error
        });

        this.log.debug(`Recorded step error ${step}: ${stepName} for ${correlationId}: ${error}`);
    }

    recordProcessEvent(correlationId: string, processName: string, eventType: string, details: string): void {
        const lifecycle = this.activeLifecycles.get(correlationId);
        if (!lifecycle) return;

        let step: number | undefined;
        const lowerEvent = eventType.toLowerCase();

        if (lifecycle.direction === "outgoing") {
            if (processName.toLowerCase().includes("imagent")) {
                if (lowerEvent.includes("send_start")) {
                    step = 3;
                } else if (lowerEvent.includes("send_finish") || lowerEvent.includes("send_complete")) {
                    step = 4;
                } else if (lowerEvent.includes("error")) {
                    step = 4;
                }
            } else if (processName.toLowerCase().includes("apsd")) {
                if (lowerEvent.includes("deliver_start") || lowerEvent.includes("push_sent")) {
                    step = 5;
                } else if (lowerEvent.includes("deliver_finish")) {
                    step = 6;
                } else if (lowerEvent.includes("error")) {
                    step = 6;
                }
            } else if (processName.toLowerCase().includes("sharingd")) {
                if (lowerEvent.includes("relay_request")) {
                    step = 5;
                } else if (lowerEvent.includes("relay_response")) {
                    step = 6;
                }
            }
        } else {
            if (processName.toLowerCase().includes("imagent")) {
                if (lowerEvent.includes("received") || lowerEvent.includes("new_message")) {
                    step = 1;
                } else if (lowerEvent.includes("store") || lowerEvent.includes("persist")) {
                    step = 4;
                }
            }
        }

        if (step) {
            this.recordStep(correlationId, step as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8, `${processName}: ${eventType} - ${details}`);
        }
    }

    updateMessageGuid(correlationId: string, messageGuid: string): void {
        const lifecycle = this.activeLifecycles.get(correlationId);
        if (lifecycle) {
            lifecycle.messageGuid = messageGuid;
            this.guidToCorrelation.set(messageGuid, correlationId);

            if (ProcessMonitorService.getInstance().isEnabled()) {
                ProcessMonitorService.getInstance().registerMessage(correlationId, {
                    messageGuid: messageGuid,
                    chatGuid: lifecycle.chatGuid,
                    timestamp: Date.now()
                });
            }
        }
    }

    completeLifecycle(correlationId: string): void {
        const lifecycle = this.activeLifecycles.get(correlationId);
        if (lifecycle) {
            const duration = Date.now() - lifecycle.startTime;
            this.log.debug(`Completed lifecycle ${correlationId} in ${duration}ms`);
        }
    }

    getByCorrelationId(correlationId: string): LifecycleData | undefined {
        return this.activeLifecycles.get(correlationId);
    }

    getByMessageGuid(guid: string): LifecycleData | undefined {
        const correlationId = this.guidToCorrelation.get(guid);
        return correlationId ? this.activeLifecycles.get(correlationId) : undefined;
    }

    getByTempGuid(tempGuid: string): LifecycleData | undefined {
        const correlationId = this.tempGuidToCorrelation.get(tempGuid);
        return correlationId ? this.activeLifecycles.get(correlationId) : undefined;
    }

    stop(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}
