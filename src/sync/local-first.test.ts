/**
 * Local-First Mode Test
 *
 * Tests that games can run locally without a server connection.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Game } from '../game';
import { Transform2D, Player } from '../components';

describe('Local-First Mode', () => {
    // Mock performance.now and requestAnimationFrame for Node.js
    let mockTime = 0;
    const originalPerformance = global.performance;
    let rafCallbacks: Function[] = [];

    beforeEach(() => {
        mockTime = 0;
        rafCallbacks = [];

        global.performance = {
            now: () => mockTime
        } as any;

        // Mock requestAnimationFrame
        (global as any).requestAnimationFrame = (cb: Function) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        };

        (global as any).cancelAnimationFrame = (id: number) => {
            // No-op for tests
        };
    });

    afterEach(() => {
        global.performance = originalPerformance;
        delete (global as any).requestAnimationFrame;
        delete (global as any).cancelAnimationFrame;
    });

    // Helper to run RAF callbacks (simulate browser frame)
    function runFrame() {
        const cbs = [...rafCallbacks];
        rafCallbacks = [];
        cbs.forEach(cb => cb());
    }

    test('game.start() begins local simulation without server', () => {
        const game = new Game({ tickRate: 60 });

        game.defineEntity('player')
            .with(Transform2D)
            .with(Player);

        let roomCreated = false;

        game.start({
            onRoomCreate: () => {
                roomCreated = true;
                game.spawn('player', { x: 100, y: 100 });
            }
        });

        // onRoomCreate should be called immediately
        expect(roomCreated).toBe(true);
        expect([...game.query('player')].length).toBe(1);

        // Frame should start at 0
        expect(game.frame).toBe(0);

        // No connection = local mode
        expect((game as any).connection).toBeNull();
    });

    test('local ticks advance frame at tickRate', () => {
        const game = new Game({ tickRate: 20 }); // 20 fps = 50ms per tick

        game.defineEntity('player')
            .with(Transform2D);

        let tickCount = 0;

        game.start({
            onTick: () => {
                tickCount++;
            }
        });

        // Initially at frame 0
        expect(game.frame).toBe(0);
        expect(tickCount).toBe(0);

        // Simulate 100ms passing (should be 2 ticks at 20fps = 50ms/tick)
        mockTime = 100;
        runFrame();

        expect(tickCount).toBe(2);
        expect(game.frame).toBe(2);

        // Simulate another 100ms
        mockTime = 200;
        runFrame();

        expect(tickCount).toBe(4);
        expect(game.frame).toBe(4);
    });

    test('game.time returns deterministic time based on frame', () => {
        const game = new Game({ tickRate: 20 }); // 20 fps = 50ms per tick

        game.defineEntity('player')
            .with(Transform2D);

        game.start({});

        // At frame 0, time should be 0
        expect(game.frame).toBe(0);
        expect(game.time).toBe(0);

        // Simulate 100ms (2 ticks at 50ms/tick)
        mockTime = 100;
        runFrame();

        expect(game.frame).toBe(2);
        expect(game.time).toBe(100); // 2 frames * 50ms = 100ms
    });

    test('onTick callback is called each frame', () => {
        const game = new Game({ tickRate: 20 }); // 20 fps = 50ms per tick

        game.defineEntity('player')
            .with(Transform2D);

        const frames: number[] = [];

        game.start({
            onTick: (frame) => {
                frames.push(frame);
            }
        });

        // Simulate 150ms (3 ticks)
        mockTime = 150;
        runFrame();

        expect(frames).toEqual([1, 2, 3]);
    });
});
