/**
 * AnalyticsManager.ts — Lightweight analytics for DGNS Vehicle Scanner
 *
 * Tracks session metrics, timing data, and error logs without blocking the main flow.
 * Persists cumulative stats locally and optionally syncs to cloud.
 *
 * @author DGNS
 * @license MIT
 */

@component
export class AnalyticsManager extends BaseScriptComponent {

    // =====================================================================
    // SESSION COUNTERS (reset each launch)
    // =====================================================================
    private scansThisSession: number = 0;
    private savesThisSession: number = 0;
    private tradesThisSession: number = 0;
    private errorsThisSession: number = 0;
    private antiCheatBlocksThisSession: number = 0;

    // =====================================================================
    // TIMING
    // =====================================================================
    private scanTimings: number[] = [];
    private imageGenTimings: number[] = [];

    // =====================================================================
    // ERROR LOG (circular buffer, last N errors)
    // =====================================================================
    private readonly MAX_ERROR_LOG: number = 20;
    private errorLog: Array<{ timestamp: number; category: string; message: string }> = [];

    // =====================================================================
    // CUMULATIVE STATS (persisted across sessions)
    // =====================================================================
    private readonly STORAGE_KEY: string = 'dgns_analytics';
    private cumulativeStats = {
        totalSessions: 0,
        totalScans: 0,
        totalSaves: 0,
        totalTrades: 0,
        totalErrors: 0,
        totalAntiCheatBlocks: 0,
        firstSessionDate: '',
        lastSessionDate: '',
    };

    // =====================================================================
    // CALLBACKS
    // =====================================================================
    /** Optional: sync analytics snapshot to cloud. */
    onSyncToCloud: ((snapshot: string) => void) | null = null;

    // =====================================================================
    // LIFECYCLE
    // =====================================================================

    onAwake(): void {
        this.loadStats();
        this.cumulativeStats.totalSessions++;
        const today = new Date().toISOString().split('T')[0];
        if (!this.cumulativeStats.firstSessionDate) {
            this.cumulativeStats.firstSessionDate = today;
        }
        this.cumulativeStats.lastSessionDate = today;
        this.saveStats();
        print('AnalyticsManager: Session #' + this.cumulativeStats.totalSessions + ' started');
    }

    // =====================================================================
    // PUBLIC API — Called by other modules
    // =====================================================================

    /** Log a generic event. */
    logEvent(category: string, action: string, label?: string): void {
        print('Analytics: [' + category + '] ' + action + (label ? ' — ' + label : ''));
    }

    /** Record a completed scan with timing. */
    logScan(durationMs: number, success: boolean): void {
        this.scansThisSession++;
        this.cumulativeStats.totalScans++;
        if (success) {
            this.scanTimings.push(durationMs);
        }
        this.saveStats();
    }

    /** Record a completed save with image generation timing. */
    logSave(imageGenDurationMs: number): void {
        this.savesThisSession++;
        this.cumulativeStats.totalSaves++;
        this.imageGenTimings.push(imageGenDurationMs);
        this.saveStats();
    }

    /** Record a completed trade. */
    logTrade(type: 'given' | 'received', method: 'colocated' | 'async'): void {
        this.tradesThisSession++;
        this.cumulativeStats.totalTrades++;
        this.saveStats();
        this.logEvent('trade', type, method);
    }

    /** Record an anti-cheat block. */
    logAntiCheatBlock(): void {
        this.antiCheatBlocksThisSession++;
        this.cumulativeStats.totalAntiCheatBlocks++;
        this.saveStats();
        this.logEvent('anti_cheat', 'blocked', 'screen_or_photo');
    }

    /** Record an error. */
    logError(category: string, message: string): void {
        this.errorsThisSession++;
        this.cumulativeStats.totalErrors++;
        this.errorLog.push({ timestamp: Date.now(), category, message: message.substring(0, 200) });
        if (this.errorLog.length > this.MAX_ERROR_LOG) {
            this.errorLog.shift();
        }
        this.saveStats();
        print('Analytics: [ERROR] [' + category + '] ' + message);
    }

    // =====================================================================
    // GETTERS — Session stats
    // =====================================================================

    getSessionStats(): {
        scans: number; saves: number; trades: number; errors: number; antiCheatBlocks: number;
        avgScanMs: number; avgImageGenMs: number;
    } {
        return {
            scans: this.scansThisSession,
            saves: this.savesThisSession,
            trades: this.tradesThisSession,
            errors: this.errorsThisSession,
            antiCheatBlocks: this.antiCheatBlocksThisSession,
            avgScanMs: this.average(this.scanTimings),
            avgImageGenMs: this.average(this.imageGenTimings),
        };
    }

    getCumulativeStats(): typeof this.cumulativeStats {
        return { ...this.cumulativeStats };
    }

    getRecentErrors(): Array<{ timestamp: number; category: string; message: string }> {
        return [...this.errorLog];
    }

    /** Returns a JSON snapshot of all analytics for cloud sync. */
    getSnapshot(): string {
        return JSON.stringify({
            session: this.getSessionStats(),
            cumulative: this.cumulativeStats,
            recentErrors: this.errorLog,
        });
    }

    // =====================================================================
    // PERSISTENCE
    // =====================================================================

    private saveStats(): void {
        try {
            const store = global.persistentStorageSystem.store;
            store.putString(this.STORAGE_KEY, JSON.stringify(this.cumulativeStats));
        } catch (e) { /* silent */ }
    }

    private loadStats(): void {
        try {
            const store = global.persistentStorageSystem.store;
            const json = store.getString(this.STORAGE_KEY);
            if (json && json.length > 2) {
                const loaded = JSON.parse(json);
                Object.assign(this.cumulativeStats, loaded);
                print('AnalyticsManager: Loaded cumulative stats — '
                    + this.cumulativeStats.totalSessions + ' sessions, '
                    + this.cumulativeStats.totalScans + ' scans');
            }
        } catch (e) {
            print('AnalyticsManager: Error loading stats: ' + e);
        }
    }

    // =====================================================================
    // UTILS
    // =====================================================================

    private average(arr: number[]): number {
        if (arr.length === 0) return 0;
        let sum = 0;
        for (let i = 0; i < arr.length; i++) sum += arr[i];
        return Math.round(sum / arr.length);
    }
}
