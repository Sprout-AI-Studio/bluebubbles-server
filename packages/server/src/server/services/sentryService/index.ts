import * as Sentry from "@sentry/node";
import { EventEmitter } from "events";
import { getLogger } from "@server/lib/logging/Loggable";

export class SentryService extends EventEmitter {
    private static instance: SentryService;
    private initialized = false;
    private errorTrackingEnabled = false;
    private messageLoggingEnabled = false;
    private lifecycleLoggingEnabled = false;
    private logger = getLogger("SentryService");

    private constructor() {
        super();
    }

    static getInstance(): SentryService {
        if (!SentryService.instance) {
            SentryService.instance = new SentryService();
        }
        return SentryService.instance;
    }

    initialize(dsn: string, errorTracking: boolean = true, messageLogging: boolean = false, lifecycleLogging: boolean = false): void {
        if (this.initialized || !dsn) return;

        this.errorTrackingEnabled = errorTracking;
        this.messageLoggingEnabled = messageLogging;
        this.lifecycleLoggingEnabled = lifecycleLogging;

        Sentry.init({
            dsn,
            enableLogs: true,
            sendDefaultPii: false,

            beforeSendLog: (log) => {
                if (!this.messageLoggingEnabled && !this.lifecycleLoggingEnabled) return null;
                return log;
            },

            beforeSend: (event) => {
                if (!this.errorTrackingEnabled) return null;
                return event;
            },

            environment: process.env.NODE_ENV || "development"
        });

        this.initialized = true;
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    isErrorTrackingEnabled(): boolean {
        return this.errorTrackingEnabled;
    }

    isMessageLoggingEnabled(): boolean {
        return this.messageLoggingEnabled;
    }

    isLifecycleLoggingEnabled(): boolean {
        return this.lifecycleLoggingEnabled;
    }

    enableLifecycleLogging(enabled: boolean): void {
        this.lifecycleLoggingEnabled = enabled;
    }

    captureError(error: Error, context?: Record<string, any>): void {
        if (!this.initialized || !this.errorTrackingEnabled) return;

        if (context) {
            Sentry.setContext("additional", context);
        }
        Sentry.captureException(error);
    }

    logIncomingMessage(messageData: {
        guid: string;
        text?: string;
        sender?: string;
        chatGuid: string;
        timestamp: Date | number;
        attachments?: any[];
        isFromMe: boolean;
        chatName?: string;
    }): void {
        if (!this.initialized || !this.messageLoggingEnabled) return;

        Sentry.logger.info("Incoming iMessage received", {
            direction: "incoming",
            messageGuid: messageData.guid,
            chatGuid: messageData.chatGuid,
            chatName: messageData.chatName,
            sender: messageData.sender,
            timestamp: messageData.timestamp,
            isFromMe: messageData.isFromMe,
            hasAttachments: Array.isArray(messageData.attachments) && messageData.attachments.length > 0,
            attachmentCount: messageData.attachments?.length ?? 0,
            messageText: messageData.text
        });
    }

    logOutgoingMessage(messageData: {
        tempGuid: string;
        chatGuid: string;
        text?: string;
        method?: string;
        subject?: string;
        effectId?: string;
        timestamp: Date | number;
        attachments?: any[];
    }): void {
        if (!this.initialized || !this.messageLoggingEnabled) return;

        Sentry.logger.info("Outgoing iMessage sent", {
            direction: "outgoing",
            tempGuid: messageData.tempGuid,
            chatGuid: messageData.chatGuid,
            method: messageData.method,
            timestamp: messageData.timestamp,
            hasAttachments: Array.isArray(messageData.attachments) && messageData.attachments.length > 0,
            attachmentCount: messageData.attachments?.length ?? 0,
            messageText: messageData.text,
            subject: messageData.subject,
            effectId: messageData.effectId
        });
    }

    logLifecycleStep(data: {
        correlationId: string;
        step: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
        stepName: string;
        direction: 'incoming' | 'outgoing';
        timestamp: number;
        messageGuid?: string;
        tempGuid?: string;
        chatGuid?: string;
        sender?: string;
        text?: string;
        details?: string;
        error?: string;
    }): void {
        if (!this.lifecycleLoggingEnabled) return;

        const stepNumber = data.step;
        const stepName = data.stepName;
        const direction = data.direction;
        
        const message = `[${stepNumber}/8] ${stepName} - ${direction === 'incoming' ? 'Incoming' : 'Outgoing'} message`;
        
        const logData = {
            correlationId: data.correlationId,
            step: data.step,
            stepName: data.stepName,
            direction: data.direction,
            timestamp: data.timestamp,
            messageGuid: data.messageGuid,
            tempGuid: data.tempGuid,
            chatGuid: data.chatGuid,
            sender: data.sender,
            messageText: data.text,
            details: data.details
        };
        
        // Always log to electron-log (main.log)
        if (data.error) {
            this.logger.error(`[STEP ERROR] ${message}: ${data.error}`, logData);
        } else {
            this.logger.info(message, logData);
        }

        // Also log to Sentry if enabled
        if (this.initialized && this.lifecycleLoggingEnabled) {
            if (data.error) {
                Sentry.logger.error(`[STEP ERROR] ${message}`, {
                    ...logData,
                    error: data.error
                });
            } else {
                Sentry.logger.info(message, logData);
            }
        }
    }

    logDeliveryUpdate(data: {
        correlationId: string;
        messageGuid: string;
        tempGuid?: string;
        chatGuid: string;
        text?: string;
        status: 'sent' | 'delivered' | 'read' | 'failed' | 'unsent';
        timestamp: number;
        deliveredAt?: number;
        readAt?: number;
        errorCode?: number;
        errorMessage?: string;
    }): void {
        if (!this.lifecycleLoggingEnabled) return;

        const statusMessages = {
            sent: 'Message sent successfully',
            delivered: 'Message delivered to recipient',
            read: 'Message read by recipient',
            failed: 'Message delivery failed',
            unsent: 'Message unsent by sender'
        };

        const logData = {
            correlationId: data.correlationId,
            messageGuid: data.messageGuid,
            tempGuid: data.tempGuid,
            chatGuid: data.chatGuid,
            messageText: data.text,
            status: data.status,
            timestamp: data.timestamp,
            deliveredAt: data.deliveredAt,
            readAt: data.readAt,
            errorCode: data.errorCode,
            errorMessage: data.errorMessage
        };

        // Always log to electron-log (main.log)
        if (data.status === 'failed' || data.status === 'unsent') {
            this.logger.error(`[DELIVERY ERROR] ${statusMessages[data.status]}: ${data.errorMessage}`, logData);
        } else {
            this.logger.info(`[DELIVERY] ${statusMessages[data.status]}`, logData);
        }

        // Also log to Sentry if enabled
        if (this.initialized && this.lifecycleLoggingEnabled) {
            if (data.status === 'failed' || data.status === 'unsent') {
                Sentry.logger.error(`[DELIVERY ERROR] ${statusMessages[data.status]}`, logData);
            } else {
                Sentry.logger.info(`[DELIVERY] ${statusMessages[data.status]}`, logData);
            }
        }
    }

    logProcessEvent(data: {
        processName: string;
        eventType: string;
        eventDetails: string;
        timestamp: number;
        correlationId?: string;
        messageGuid?: string;
    }): void {
        if (!this.lifecycleLoggingEnabled) return;

        const logData = {
            processName: data.processName,
            eventType: data.eventType,
            eventDetails: data.eventDetails,
            timestamp: data.timestamp,
            correlationId: data.correlationId,
            messageGuid: data.messageGuid
        };

        // Always log to electron-log (main.log)
        this.logger.debug(`[PROCESS] ${data.processName} - ${data.eventType}: ${data.eventDetails.substring(0, 100)}`, logData);

        // Also log to Sentry if enabled
        if (this.initialized && this.lifecycleLoggingEnabled) {
            Sentry.logger.debug(`[PROCESS] ${data.processName} - ${data.eventType}`, logData);
        }
    }
}

export const SentryService: SentryService = SentryService.getInstance();
