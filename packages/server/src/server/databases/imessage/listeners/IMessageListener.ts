import fs from "fs";
import { MultiFileWatcher } from "@server/lib/MultiFileWatcher";
import type { FileChangeEvent } from "@server/lib/MultiFileWatcher";
import { Loggable } from "@server/lib/logging/Loggable";
import { Sema } from "async-sema";
import { IMessageCache, IMessagePoller } from "../pollers";
import { MessageRepository } from "..";
import { waitMs } from "@server/helpers/utils";
import { DebounceSubsequentWithWait } from "@server/lib/decorators/DebounceDecorator";

const WATCHDOG_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

export class IMessageListener extends Loggable {
    tag = "IMessageListener";

    stopped: boolean;

    filePaths: string[];

    watcher: MultiFileWatcher;

    repo: MessageRepository;

    processLock: Sema;

    pollers: IMessagePoller[];

    cache: IMessageCache;

    lastCheck = 0;

    private watchdogTimer: NodeJS.Timeout | null = null;

    constructor({ filePaths, repo, cache }: { filePaths: string[], repo: MessageRepository, cache: IMessageCache }) {
        super();

        this.filePaths = filePaths;
        this.repo = repo;
        this.pollers = [];
        this.cache = cache;
        this.stopped = false;
        this.processLock = new Sema(1);
    }

    stop() {
        this.log.info("Stopping IMessage file watcher and watchdog.");
        this.stopped = true;
        if (this.watchdogTimer) {
            clearInterval(this.watchdogTimer);
            this.watchdogTimer = null;
        }
        this.watcher?.stop();
        this.removeAllListeners();
    }

    addPoller(poller: IMessagePoller) {
        this.pollers.push(poller);
    }

    getEarliestModifiedDate() {
        let earliest = new Date();
        for (const filePath of this.filePaths) {
            const stat = fs.statSync(filePath);
            if (stat.mtime < earliest) {
                earliest = stat.mtime;
            }
        }

        return earliest;
    }

    async start() {
        this.log.info(`Starting IMessage file watcher on: ${this.filePaths.join(", ")}`);
        this.lastCheck = this.getEarliestModifiedDate().getTime() - 60000;
        this.stopped = false;

        // Perform an initial poll to kinda seed the cache.
        // We'll use the earliest modified date of the files to determine the initial poll date.
        // We'll also subtract 1 minute just to pre-load the cache with a little bit of data.
        await this.poll(new Date(this.lastCheck), false);
        this.log.debug(`Initial poll complete. lastCheck set to ${new Date(this.lastCheck).toISOString()}`);

        this.watcher = new MultiFileWatcher(this.filePaths);
        this.watcher.on("change", async (event: FileChangeEvent) => {
            await this.handleChangeEvent(event);
        });

        this.watcher.on("rename", ({ filePath }: { filePath: string }) => {
            this.log.warn(`File renamed/replaced (WAL checkpoint?): ${filePath}. Watcher restarting...`);
        });

        this.watcher.on("error", (error) => {
            this.log.error(`Failed to watch database files: ${this.filePaths.join(", ")}`);
            this.log.debug(`Error: ${error}`);
        });

        this.watcher.start();

        this.watchdogTimer = setInterval(async () => {
            const now = Date.now();
            if (now - this.lastCheck < WATCHDOG_THRESHOLD_MS) return;

            let fileModified = false;
            for (const filePath of this.filePaths) {
                try {
                    const stat = fs.statSync(filePath);
                    if (stat.mtimeMs > this.lastCheck) {
                        fileModified = true;
                        break;
                    }
                } catch { /* file may not exist */ }
            }

            if (fileModified) {
                this.log.warn(
                    `[Watchdog] No file-change events for ${Math.round((now - this.lastCheck) / 1000)}s ` +
                    `but DB was modified. Watcher may be stalled — forcing poll.`
                );
                await this.handleChangeEvent({ filePath: this.filePaths[0], currentStat: null, prevStat: null });
            } else {
                this.log.debug(
                    `[Watchdog] No file-change events for ${Math.round((now - this.lastCheck) / 1000)}s. ` +
                    `DB not modified — silence expected.`
                );
            }
        }, WATCHDOG_THRESHOLD_MS);
    }

    @DebounceSubsequentWithWait('IMessageListener.handleChangeEvent', 500)
    async handleChangeEvent(event: FileChangeEvent) {
        this.log.debug(`File change detected on ${event.filePath}. Polling...`);
        await this.processLock.acquire();
        try {
            const now = Date.now();
            let prevTime = this.lastCheck;
    
            if (prevTime <= 0 || prevTime > now) {
                this.log.debug(`Previous time is invalid (${prevTime}), setting to now...`);
                prevTime = now;
            } else if (now - prevTime > 86400000) {
                this.log.debug(`Previous time is > 24 hours ago, setting to 24 hours ago...`);
                prevTime = now - 86400000;
            }
    
            let afterTime = prevTime - 30000;
            if (afterTime > now) {
                afterTime = now;
            }
            await this.poll(new Date(afterTime));
            this.lastCheck = now;
    
            this.cache.trimCaches();
            if (this.processLock.nrWaiting() > 0) {
                await waitMs(100);
            }
        } catch (error) {
            this.log.error(`Error handling change event: ${error}`);
        } finally {
            this.processLock.release();
        }
    }

    async poll(after: Date, emitResults = true) {
        let totalEvents = 0;
        for (const poller of this.pollers) {
            const results = await poller.poll(after);
            totalEvents += results.length;

            if (emitResults) {
                for (const result of results) {
                    this.emit(result.eventType, result.data);
                    await waitMs(10);
                }
            }
        }
        this.log.debug(`Poll complete. Found ${totalEvents} events.`);
    }
}
