import { Game } from '../game';
import { Simple2DRenderer } from './simple-2d-renderer';
import { Transform2D, Body2D } from '../components';

interface FrameRecord {
    frame: number;
    clients: Map<number, 'confirmed' | 'predicted' | 'mispredicted'>;
    hadRollback: boolean;
}

interface TimeSyncRecord {
    timestamp: number;
    clockDelta: number;
    latency: number;
    tickRateMultiplier: number;
    predictionDepth: number;
}

interface GhostState {
    positions: Map<number, { x: number; y: number; radius: number }>;
    timestamp: number;
}

export interface PredictionDebugOptions {
    position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
    timelineFrames?: number;
    ghostFadeDuration?: number;
}

export class PredictionDebugPlugin {
    private game: Game;
    private overlay: HTMLCanvasElement;
    private octx: CanvasRenderingContext2D;
    private visible: boolean = true;

    private frameRecords: FrameRecord[] = [];
    private timeSyncRecords: TimeSyncRecord[] = [];
    private ghosts: GhostState[] = [];

    private maxFrames: number;
    private ghostFadeMs: number;
    private rollbackFrames: Set<number> = new Set();

    private origOnRollback: ((from: number, to: number) => void) | null = null;
    private rafId: number = 0;
    private destroyed: boolean = false;
    private lastRecordedFrame: number = -1;

    constructor(game: Game, options: PredictionDebugOptions = {}) {
        this.game = game;
        this.maxFrames = options.timelineFrames ?? 300;
        this.ghostFadeMs = options.ghostFadeDuration ?? 500;

        this.overlay = document.createElement('canvas');
        this.overlay.width = 500;
        this.overlay.height = 220;
        const pos = options.position ?? 'bottom-left';
        Object.assign(this.overlay.style, {
            position: 'fixed',
            zIndex: '9999',
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.75)',
            borderRadius: '4px',
            ...(pos.includes('bottom') ? { bottom: '8px' } : { top: '8px' }),
            ...(pos.includes('left') ? { left: '8px' } : { right: '8px' }),
        });
        document.body.appendChild(this.overlay);
        this.octx = this.overlay.getContext('2d')!;

        this.hookRollback();
        this.startLoop();
    }

    private startLoop(): void {
        const loop = () => {
            if (this.destroyed) return;
            this.update();
            this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
    }

    private hookRollback(): void {
        const pm = this.game.getPredictionManager();
        if (!pm) return;

        this.origOnRollback = pm.onRollback;
        pm.onRollback = (fromFrame: number, toFrame: number) => {
            this.origOnRollback?.(fromFrame, toFrame);
            this.captureGhosts();
            for (let f = toFrame; f <= fromFrame; f++) {
                this.rollbackFrames.add(f);
            }
        };
    }

    private captureGhosts(): void {
        const renderer = this.game.getPlugin(Simple2DRenderer);
        if (!renderer) return;

        const positions = new Map<number, { x: number; y: number; radius: number }>();
        for (const entity of this.game.getAllEntities()) {
            let t;
            try { t = entity.get(Transform2D); } catch { continue; }
            let radius = 10;
            try {
                const b = entity.get(Body2D);
                if (b.radius > 0) radius = b.radius;
                else if (b.width > 0) radius = b.width / 2;
            } catch { /* no body */ }
            positions.set(entity.eid, { x: t.x, y: t.y, radius });
        }
        this.ghosts.push({ positions, timestamp: performance.now() });
    }

    toggle(): void {
        this.visible = !this.visible;
        this.overlay.style.display = this.visible ? '' : 'none';
    }

    update(): void {
        this.collectFrameData();
        this.collectTimeSyncData();
        this.pruneGhosts();

        if (this.visible) {
            this.renderOverlay();
            this.renderGhosts();
        }
    }

    private collectFrameData(): void {
        const pm = this.game.getPredictionManager();
        if (!pm) return;

        const ih = pm.getInputHistory();
        const local = pm.localFrame;
        if (local <= this.lastRecordedFrame) return;

        for (let f = this.lastRecordedFrame + 1; f <= local; f++) {
            const record: FrameRecord = {
                frame: f,
                clients: new Map(),
                hadRollback: this.rollbackFrames.has(f),
            };

            const fs = ih.getFrameSet(f);
            if (fs) {
                for (const [cid, input] of fs.inputs) {
                    if (this.rollbackFrames.has(f)) {
                        record.clients.set(cid, 'mispredicted');
                    } else if (input.confirmed) {
                        record.clients.set(cid, 'confirmed');
                    } else {
                        record.clients.set(cid, 'predicted');
                    }
                }
            }

            this.frameRecords.push(record);
            if (this.frameRecords.length > this.maxFrames) {
                this.frameRecords.shift();
            }
        }

        this.lastRecordedFrame = local;
        this.rollbackFrames.clear();
    }

    private collectTimeSyncData(): void {
        const stats = this.game.getTimeSyncStats();
        const pstats = this.game.getPredictionStats();
        if (!stats) return;

        this.timeSyncRecords.push({
            timestamp: performance.now(),
            clockDelta: stats.clockDelta,
            latency: stats.estimatedLatency,
            tickRateMultiplier: stats.tickRateMultiplier,
            predictionDepth: pstats?.currentPredictionDepth ?? 0,
        });
        if (this.timeSyncRecords.length > this.maxFrames) {
            this.timeSyncRecords.shift();
        }
    }

    private pruneGhosts(): void {
        const now = performance.now();
        this.ghosts = this.ghosts.filter(g => now - g.timestamp < this.ghostFadeMs);
    }

    private renderOverlay(): void {
        const ctx = this.octx;
        const W = this.overlay.width;
        const H = this.overlay.height;
        ctx.clearRect(0, 0, W, H);

        this.renderTimeline(ctx, 0, 0, W, 130);
        this.renderTimeSyncGraph(ctx, 0, 130, W, 90);
    }

    private renderTimeline(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): void {
        ctx.fillStyle = '#aaa';
        ctx.font = '10px monospace';
        ctx.fillText('INPUT TIMELINE', x0 + 4, y0 + 12);

        const records = this.frameRecords;
        if (records.length === 0) return;

        const pm = this.game.getPredictionManager();
        if (!pm) return;
        const localCid = pm.getLocalClientId();
        const activeClients = pm.getInputHistory().getActiveClients();
        const clients = [...activeClients].sort((a, b) => a - b);
        if (clients.length === 0) return;

        const barH = Math.min(14, (h - 30) / Math.max(clients.length, 1));
        const barX = x0 + 70;
        const barW = w - 80;
        const frameW = Math.max(1, barW / this.maxFrames);

        clients.forEach((cid, ci) => {
            const by = y0 + 18 + ci * (barH + 2);
            const isLocal = cid === localCid;
            ctx.fillStyle = isLocal ? '#fff' : '#888';
            ctx.fillText(`${isLocal ? '▸' : ' '}client ${cid}:`, x0 + 4, by + barH - 3);

            for (let i = 0; i < records.length; i++) {
                const r = records[i];
                const state = r.clients.get(cid);
                if (!state) continue;

                ctx.fillStyle = state === 'confirmed' ? '#4a4' :
                    state === 'predicted' ? '#cc4' : '#c44';
                ctx.fillRect(barX + i * frameW, by, Math.max(1, frameW - 0.5), barH);

                if (r.hadRollback) {
                    ctx.fillStyle = 'rgba(255,60,60,0.7)';
                    ctx.fillRect(barX + i * frameW, y0 + 16, 1, h - 20);
                }
            }
        });

        // Current frame marker
        const curX = barX + (records.length - 1) * frameW;
        ctx.fillStyle = '#fff';
        ctx.fillText('▼', curX - 3, y0 + 16);

        // Legend
        const ly = y0 + h - 4;
        ctx.font = '9px monospace';
        ctx.fillStyle = '#4a4'; ctx.fillText('■ confirmed', x0 + 4, ly);
        ctx.fillStyle = '#cc4'; ctx.fillText('■ predicted', x0 + 100, ly);
        ctx.fillStyle = '#c44'; ctx.fillText('■ mispred', x0 + 196, ly);
    }

    private renderTimeSyncGraph(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number): void {
        ctx.fillStyle = '#aaa';
        ctx.font = '10px monospace';
        ctx.fillText('TIME SYNC', x0 + 4, y0 + 12);

        const data = this.timeSyncRecords;
        if (data.length < 2) return;

        const gx = x0 + 4;
        const gy = y0 + 16;
        const gw = w - 8;
        const gh = h - 24;

        const drawLine = (values: number[], color: string) => {
            if (values.length < 2) return;
            let min = Infinity, max = -Infinity;
            for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
            const range = max - min || 1;

            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let i = 0; i < values.length; i++) {
                const px = gx + (i / (values.length - 1)) * gw;
                const py = gy + gh - ((values[i] - min) / range) * gh;
                if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.stroke();

            // Label
            ctx.fillStyle = color;
            ctx.font = '9px monospace';
            const last = values[values.length - 1];
            ctx.fillText(last.toFixed(1), gx + gw + 2 - 40, gy + gh);
        };

        drawLine(data.map(d => d.latency), '#4af');
        drawLine(data.map(d => d.clockDelta), '#fa4');
        drawLine(data.map(d => d.tickRateMultiplier), '#4f4');

        // Legend
        const ly = y0 + h - 2;
        ctx.font = '9px monospace';
        ctx.fillStyle = '#4af'; ctx.fillText('latency', x0 + 4, ly);
        ctx.fillStyle = '#fa4'; ctx.fillText('clockΔ', x0 + 70, ly);
        ctx.fillStyle = '#4f4'; ctx.fillText('tickRate', x0 + 130, ly);
    }

    private renderGhosts(): void {
        const renderer = this.game.getPlugin(Simple2DRenderer);
        if (!renderer || this.ghosts.length === 0) return;

        const gctx = renderer.context;
        const now = performance.now();

        gctx.save();
        for (const ghost of this.ghosts) {
            const alpha = Math.max(0, 1 - (now - ghost.timestamp) / this.ghostFadeMs) * 0.4;
            gctx.fillStyle = `rgba(255, 60, 60, ${alpha})`;
            gctx.strokeStyle = `rgba(255, 60, 60, ${alpha * 1.5})`;
            gctx.lineWidth = 1;

            for (const [, pos] of ghost.positions) {
                gctx.beginPath();
                gctx.arc(pos.x, pos.y, pos.radius, 0, Math.PI * 2);
                gctx.fill();
                gctx.stroke();
            }
        }
        gctx.restore();
    }

    destroy(): void {
        this.destroyed = true;
        cancelAnimationFrame(this.rafId);
        this.overlay.remove();
        const pm = this.game.getPredictionManager();
        if (pm) {
            pm.onRollback = this.origOnRollback;
        }
    }
}
