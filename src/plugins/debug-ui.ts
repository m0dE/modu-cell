/**
 * Debug UI - Simple stats overlay for game instances
 *
 * Usage:
 *   Modu.enableDebugUI(game);  // Pass game instance
 *   Modu.setDebugHash(() => computeMyHash()); // Optional: show live state hash
 *
 * Also enables determinism guard to warn about non-deterministic function calls.
 */

import { enableDeterminismGuard } from './determinism-guard';
import type { Game } from '../game';
import { ENGINE_VERSION } from '../version';

/** Interface for objects that can be displayed in debug UI */
export interface DebugUITarget {
    getClientId(): string | null;
    getFrame(): number;
    getNodeUrl(): string | null;
    getLastSnapshot(): { hash: number | null; frame: number; size: number; entityCount: number };
    getServerFps(): number;
    getRoomId(): string | null;
    getUploadRate(): number;
    getDownloadRate(): number;
    getClients(): string[];
    getStateHash(): number;
    getEntityCount?(): number;
    getDriftStats?(): { determinismPercent: number; totalChecks: number; matchingFieldCount: number; totalFieldCount: number };
    // State sync info
    getReliabilityScores?(): Record<string, number>;
    getActiveClients?(): string[];
    getDeltaBandwidth?(): number;
    getSyncStats?(): { syncPercent: number; passed: number; failed: number; isDesynced: boolean; resyncPending: boolean };
    // Prediction/rollback info
    isPredictionEnabled?(): boolean;
    getPredictionStats?(): { rollbackCount: number; framesResimulated: number; avgRollbackDepth: number; maxRollbackDepth: number; currentPredictionDepth: number } | null;
    getTimeSyncStats?(): { clockDelta: number; synced: boolean; sampleCount: number; tickRateMultiplier: number; estimatedLatency: number } | null;
}

export interface DebugUIOptions {
    /** Position: 'top-right' (default), 'top-left', 'bottom-right', 'bottom-left' */
    position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

let debugDiv: HTMLDivElement | null = null;
let updateInterval: number | null = null;
let hashCallback: (() => string | number) | null = null;
let debugTarget: DebugUITarget | null = null;

// FPS tracking
let lastFrameTime = 0;
let frameCount = 0;
let renderFps = 0;
let fpsUpdateTime = 0;

/**
 * Set a callback to compute the current state hash for debug display.
 * The hash will be shown in the debug UI and should change as bodies move.
 */
export function setDebugHash(callback: () => string | number): void {
    hashCallback = callback;
}

/**
 * Format the prediction/rollback section for debug UI.
 * Always shows the section, indicates disabled state when CSP is off.
 */
function formatPredictionSection(eng: DebugUITarget, sectionStyle: string): string {
    const isPredEnabled = (eng as any).isPredictionEnabled?.() ?? false;
    const predStats = (eng as any).getPredictionStats?.() ?? null;
    const timeSyncStats = (eng as any).getTimeSyncStats?.() ?? null;

    let html = `<div style="${sectionStyle}">PREDICTION</div>`;

    if (!isPredEnabled) {
        html += `<div>CSP: <span style="color:#888">disabled</span></div>`;
        html += `<div>Rollbacks: <span style="color:#888">-</span></div>`;
        html += `<div>Latency: <span style="color:#888">-</span></div>`;
        return html;
    }

    if (predStats) {
        const depth = predStats.currentPredictionDepth;
        const depthColor = depth <= 4 ? '#0f0' : depth <= 8 ? '#ff0' : '#f00';

        html += `<div>Depth: <span style="color:${depthColor}">${depth}</span> frames ahead</div>`;

        if (predStats.rollbackCount > 0) {
            html += `<div>Rollbacks: <span style="color:#f80">${predStats.rollbackCount}</span></div>`;
            html += `<div>Resim: <span style="color:#f80">${predStats.framesResimulated}</span> frames</div>`;
            html += `<div>Avg depth: <span style="color:#888">${predStats.avgRollbackDepth.toFixed(1)}</span></div>`;
            html += `<div>Max depth: <span style="color:#888">${predStats.maxRollbackDepth}</span></div>`;
        } else {
            html += `<div>Rollbacks: <span style="color:#0f0">0</span></div>`;
        }
    } else {
        html += `<div>Depth: <span style="color:#888">-</span></div>`;
        html += `<div>Rollbacks: <span style="color:#888">-</span></div>`;
    }

    if (timeSyncStats) {
        const latency = Math.round(timeSyncStats.estimatedLatency);
        const latencyColor = latency < 50 ? '#0f0' : latency < 100 ? '#ff0' : '#f00';
        const syncColor = timeSyncStats.synced ? '#0f0' : '#f80';
        const rateMultiplier = timeSyncStats.tickRateMultiplier;
        const rateColor = Math.abs(rateMultiplier - 1.0) < 0.01 ? '#0f0' : '#ff0';

        html += `<div>Latency: <span style="color:${latencyColor}">${latency}ms</span></div>`;
        html += `<div>Synced: <span style="color:${syncColor}">${timeSyncStats.synced ? 'yes' : 'no'}</span> <span style="color:#888">(${timeSyncStats.sampleCount} samples)</span></div>`;
        html += `<div>Rate: <span style="color:${rateColor}">${rateMultiplier.toFixed(3)}x</span></div>`;
    } else {
        html += `<div>Latency: <span style="color:#888">-</span></div>`;
    }

    return html;
}

/**
 * Enable debug UI overlay - shows frame, client, node, snapshot info automatically
 * @param target - Object implementing DebugUITarget interface
 * @param options - UI options
 */
export function enableDebugUI(target?: DebugUITarget, options: DebugUIOptions = {}): HTMLDivElement {
    if (debugDiv) return debugDiv;

    // Store target reference for updates
    debugTarget = target || null;

    // Enable determinism guard if target is a Game instance
    if (target && 'world' in target) {
        enableDeterminismGuard(target as unknown as Game);
    }

    const pos = options.position || 'top-right';

    debugDiv = document.createElement('div');
    debugDiv.id = 'modu-debug-ui';
    debugDiv.style.cssText = `
        position: fixed;
        ${pos.includes('top') ? 'top: 10px' : 'bottom: 10px'};
        ${pos.includes('right') ? 'right: 10px' : 'left: 10px'};
        background: rgba(0, 0, 0, 0.8);
        color: #0f0;
        font: 12px monospace;
        padding: 8px 12px;
        border-radius: 4px;
        z-index: 10000;
        min-width: 180px;
        user-select: text;
        cursor: text;
        
    `;
    document.body.appendChild(debugDiv);

    // Update loop
    const update = (now: number) => {
        if (!debugDiv) return;

        // Calculate render FPS
        frameCount++;
        if (now - fpsUpdateTime >= 1000) {
            renderFps = frameCount;
            frameCount = 0;
            fpsUpdateTime = now;
        }

        const eng = debugTarget;
        if (!eng) {
            debugDiv.innerHTML = '<div style="color:#f00">No engine instance</div>';
            return;
        }

        const clientId = eng.getClientId();
        const frame = eng.getFrame();
        const nodeUrl = eng.getNodeUrl();
        const lastSnap = eng.getLastSnapshot();
        const fps = eng.getServerFps();
        const roomId = eng.getRoomId();
        const up = eng.getUploadRate();
        const down = eng.getDownloadRate();
        const clients = eng.getClients();

        // Compute live state hash (use custom callback if set, otherwise use engine's hash)
        let currentHash = '--------';
        try {
            if (hashCallback) {
                const hash = hashCallback();
                currentHash = typeof hash === 'number' ? hash.toString(16).padStart(8, '0') : String(hash).slice(0, 8);
            } else {
                const hash = eng.getStateHash();
                currentHash = hash.toString(16).padStart(8, '0');
            }
        } catch (e) {
            currentHash = 'error';
        }

        // Format bandwidth with appropriate unit
        const formatBandwidth = (bytes: number): string => {
            if (bytes >= 1024) {
                return (bytes / 1024).toFixed(1) + ' kB/s';
            }
            return Math.round(bytes) + ' B/s';
        };
        const upStr = formatBandwidth(up);
        const downStr = formatBandwidth(down);

        // Get delta bandwidth for sync status
        const deltaBw = (eng as any).getDeltaBandwidth?.() || 0;

        // Get hash-based sync stats
        const syncStats = (eng as any).getSyncStats?.() || { syncPercent: 100, passed: 0, failed: 0, isDesynced: false, resyncPending: false };
        const totalHashChecks = syncStats.passed + syncStats.failed;

        // Format sync status
        // Priority: 1) Show resync status if pending, 2) Show hash-based sync %, 3) Show "active" if delta bw > 0
        let syncStatus: string;
        if (syncStats.resyncPending) {
            // Waiting for resync snapshot
            syncStatus = '<span style="color:#f80">resyncing...</span>';
        } else if (syncStats.isDesynced) {
            // Desynced but no resync available
            syncStatus = '<span style="color:#f00">DESYNCED</span>';
        } else if (totalHashChecks > 0) {
            // Have hash-based sync stats - show percentage
            const syncPct = (Math.floor(syncStats.syncPercent * 10) / 10).toFixed(1);
            const syncColor = syncStats.syncPercent === 100 ? '#0f0' :
                            syncStats.syncPercent >= 99 ? '#ff0' : '#f00';
            syncStatus = `<span style="color:${syncColor}">${syncPct}%</span> <span style="color:#888">(${totalHashChecks} checks)</span>`;
        } else if (deltaBw > 0) {
            // Sending state hashes but no comparisons yet
            syncStatus = '<span style="color:#0f0">active</span>';
        } else {
            // Not connected or sync not started
            syncStatus = '<span style="color:#888">-</span>';
        }

        // Format received snapshot info with frames ago
        const framesAgo = lastSnap.frame ? frame - lastSnap.frame : 0;
        const snapHashStr = lastSnap.hash !== null ? lastSnap.hash.toString(16).padStart(8, '0') : null;
        const snapInfo = snapHashStr ? `${snapHashStr} <span style="color:#888">(${framesAgo} ago)</span>` : 'none';

        // Format size with appropriate units
        const formatSize = (bytes: number): string => {
            if (bytes >= 1024 * 1024) {
                return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
            } else if (bytes >= 1024) {
                return (bytes / 1024).toFixed(1) + ' KB';
            }
            return bytes + ' B';
        };
        const sizeStr = lastSnap.size > 0 ? formatSize(lastSnap.size) : '-';
        // Use local world entity count, not received snapshot count
        const localEntityCount = (eng as any).getEntityCount?.() || 0;
        const entityStr = localEntityCount > 0 ? String(localEntityCount) : '-';

        // Section header style
        const sectionStyle = 'color:#666;font-size:10px;margin-top:6px;margin-bottom:2px;border-bottom:1px solid #333;';

        const deltaBwStr = formatBandwidth(deltaBw);

        debugDiv.innerHTML = `
            <div style="${sectionStyle}">ROOM</div>
            <div>ID: <span style="color:#fff">${roomId || '-'}</span></div>
            <div>Players: <span style="color:#ff0">${clients.length}</span></div>
            <div>Frame: <span style="color:#fff">${frame}</span></div>

            <div style="${sectionStyle}">CLIENT</div>
            <div>ID: <span style="color:#ff0">${clientId ? clientId.slice(0, 8) : '-'}</span></div>

            <div style="${sectionStyle}">ENGINE</div>
            <div>Commit: <span style="color:#888">${ENGINE_VERSION}</span></div>
            <div>FPS: <span style="color:#0f0">${renderFps}</span> render, <span style="color:#0f0">${fps}</span> tick</div>
            <div>Net: <span style="color:#0f0">${upStr}</span> up, <span style="color:#f80">${downStr}</span> down</div>

            <div style="${sectionStyle}">STATE SYNC</div>
            <div>Hash: <span style="color:#f0f">${currentHash}</span></div>
            <div>Delta: <span style="color:#0ff">${deltaBwStr}</span></div>
            <div>Sync: ${syncStatus}</div>
            <div>Entities: <span style="color:#fff">${entityStr}</span></div>
            ${formatPredictionSection(eng, sectionStyle)}
        `;
    };

    // Update every frame
    const loop = (now: number) => {
        update(now);
        updateInterval = requestAnimationFrame(loop) as unknown as number;
    };
    fpsUpdateTime = performance.now();
    requestAnimationFrame(loop);

    return debugDiv;
}

/**
 * Disable debug UI
 */
export function disableDebugUI(): void {
    if (updateInterval) {
        cancelAnimationFrame(updateInterval);
        updateInterval = null;
    }
    if (debugDiv) {
        debugDiv.remove();
        debugDiv = null;
    }
    debugTarget = null;
}

/**
 * Check if debug UI is enabled
 */
export function isDebugUIEnabled(): boolean {
    return debugDiv !== null;
}
