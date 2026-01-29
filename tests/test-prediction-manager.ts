/**
 * PredictionManager Unit Tests
 *
 * Tests for PredictionManager (src/prediction/prediction-manager.ts).
 * Uses stub World and minimal mocks.
 */

import { PredictionManager, ServerInput } from '../src/prediction/prediction-manager';

console.log('=== PredictionManager Unit Tests ===\n');

let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean) {
    try {
        if (fn()) {
            console.log(`  PASS: ${name}`);
            passed++;
        } else {
            console.log(`  FAIL: ${name}`);
            failed++;
        }
    } catch (e) {
        console.log(`  FAIL: ${name} - ${e}`);
        failed++;
    }
}

/** Minimal World stub that tracks tick calls and manages snapshots. */
function createMockWorld() {
    let snapshotCounter = 0;
    const tickCalls: { frame: number; inputs: any[] }[] = [];
    let currentSnapshot: any = { id: 0 };

    return {
        tickCalls,
        tick(frame: number, inputs: any[]) {
            tickCalls.push({ frame, inputs });
            currentSnapshot = { id: ++snapshotCounter, frame };
        },
        getSparseSnapshot() {
            return { ...currentSnapshot };
        },
        loadSparseSnapshot(snapshot: any) {
            currentSnapshot = { ...snapshot };
        }
    } as any;
}

function createPM(config: any = {}) {
    const world = createMockWorld();
    const pm = new PredictionManager(world, config);
    pm.setClientIdResolver((id: string) => parseInt(id, 10));
    pm.setLocalClientId(1);
    pm.addClient(1);
    return { pm, world };
}

// ============================================
// enable / disable
// ============================================

console.log('Test 1: enable / disable');

test('starts disabled', () => {
    const { pm } = createPM();
    return !pm.enabled;
});

test('enable enables prediction', () => {
    const { pm } = createPM();
    pm.enable();
    return pm.enabled;
});

test('disable disables prediction', () => {
    const { pm } = createPM();
    pm.enable();
    pm.disable();
    return !pm.enabled;
});

test('enable with config override', () => {
    const { pm } = createPM();
    pm.enable({ maxPredictionFrames: 16 });
    return pm.enabled;
});

// ============================================
// advanceFrame
// ============================================

console.log('\nTest 2: advanceFrame');

test('increments localFrame', () => {
    const { pm } = createPM();
    pm.enable();
    pm.advanceFrame();
    return pm.localFrame === 1;
});

test('calls world.tick with correct frame', () => {
    const { pm, world } = createPM();
    pm.enable();
    pm.advanceFrame();
    return world.tickCalls.length === 1 && world.tickCalls[0].frame === 1;
});

test('does nothing when disabled', () => {
    const { pm, world } = createPM();
    pm.advanceFrame();
    return pm.localFrame === 0 && world.tickCalls.length === 0;
});

test('stops at maxPredictionFrames', () => {
    const { pm } = createPM({ maxPredictionFrames: 3 });
    pm.enable();
    for (let i = 0; i < 10; i++) {
        pm.advanceFrame();
    }
    // Should stop at frame 3 (predictionDepth = 3 - 0 = 3 >= maxPredictionFrames)
    return pm.localFrame === 3;
});

test('saves snapshot before tick', () => {
    const { pm, world } = createPM();
    pm.enable();
    // First advance saves snapshot at frame 0, then ticks frame 1
    pm.advanceFrame();
    // The snapshot should have been saved before tick
    return world.tickCalls.length === 1;
});

// ============================================
// queueLocalInput
// ============================================

console.log('\nTest 3: queueLocalInput');

test('applies inputDelayFrames offset', () => {
    const { pm } = createPM({ inputDelayFrames: 2 });
    pm.enable();

    // At localFrame=0, queue input → stored at frame 0+2=2
    pm.queueLocalInput({ moveX: 100 });

    // Verify: the input is a confirmed local input at frame 2
    // but at frame 1 it would only be a prediction (via repeat-last)
    // The key behavior is that queueLocalInput targets localFrame + delay
    pm.advanceFrame(); // frame 1
    pm.advanceFrame(); // frame 2

    // localFrame should be 2
    return pm.localFrame === 2;
});

// ============================================
// receiveServerTick
// ============================================

console.log('\nTest 4: receiveServerTick');

test('lifecycle events at past frame trigger rollback', () => {
    const { pm, world } = createPM();
    pm.enable();
    pm.advanceFrame(); // frame 1

    const ticksBefore = world.tickCalls.length;

    // Join event at frame 1 (which we've already simulated past)
    const result = pm.receiveServerTick(1, [
        { seq: 1, clientId: '5', data: { type: 'join' } },
    ]);

    // Lifecycle event at simulated frame → rollback
    return result === true && world.tickCalls.length > ticksBefore;
});

test('lifecycle events at future frame do NOT trigger rollback', () => {
    const { pm } = createPM();
    pm.enable();
    // Don't advance — localFrame is 0

    const result = pm.receiveServerTick(5, [
        { seq: 1, clientId: '5', data: { type: 'join' } },
    ]);

    return result === false;
});

test('lifecycle events at future frame call onLifecycleEvent immediately', () => {
    const { pm } = createPM();
    pm.enable();

    const events: any[] = [];
    pm.onLifecycleEvent = (input) => { events.push(input); };

    // Frame 5 is ahead of localFrame (0)
    pm.receiveServerTick(5, [
        { seq: 1, clientId: '5', data: { type: 'join' } },
    ]);

    return events.length === 1 && events[0].data.type === 'join';
});

test('confirms matching inputs without rollback', () => {
    const { pm } = createPM();
    pm.enable();

    // Queue input and advance
    pm.queueLocalInput({ moveX: 100 });
    pm.advanceFrame(); // frame 1
    pm.advanceFrame(); // frame 2
    pm.advanceFrame(); // frame 3

    // Server confirms frame 1 with same inputs (empty for frame 1 since delay=2)
    const result = pm.receiveServerTick(1, []);
    return result === false;
});

test('detects misprediction and triggers rollback', () => {
    const { pm, world } = createPM({ inputDelayFrames: 0 });
    pm.enable();
    pm.addClient(2);

    // Advance several frames (client 2 will be predicted as empty)
    pm.advanceFrame(); // frame 1
    pm.advanceFrame(); // frame 2
    pm.advanceFrame(); // frame 3

    const ticksBefore = world.tickCalls.length;

    // Server says client 2 had moveX: 999 at frame 1 — different from prediction
    const result = pm.receiveServerTick(1, [
        { seq: 1, clientId: '2', data: { moveX: 999 } }
    ]);

    // Should have rolled back and resimulated
    return result === true && world.tickCalls.length > ticksBefore;
});

test('advances confirmedFrame', () => {
    const { pm } = createPM();
    pm.enable();
    pm.advanceFrame();

    pm.receiveServerTick(1, []);
    return pm.confirmedFrame === 1;
});

test('no rollback when disabled', () => {
    const { pm } = createPM();
    const result = pm.receiveServerTick(1, [
        { seq: 1, clientId: '1', data: { moveX: 100 } }
    ]);
    return result === false;
});

test('no rollback for future frame (frame > localFrame)', () => {
    const { pm } = createPM({ inputDelayFrames: 0 });
    pm.enable();
    pm.addClient(2);
    pm.advanceFrame(); // frame 1

    // Server sends frame 5 which is ahead of our localFrame (1)
    const result = pm.receiveServerTick(5, [
        { seq: 1, clientId: '2', data: { moveX: 999 } }
    ]);

    // Frame 5 > localFrame 1 → no rollback even if misprediction
    return result === false;
});

// ============================================
// executeRollback — stats
// ============================================

console.log('\nTest 5: executeRollback stats');

test('tracks rollbackCount', () => {
    const { pm } = createPM({ inputDelayFrames: 0 });
    pm.enable();
    pm.addClient(2);

    pm.advanceFrame(); // 1
    pm.advanceFrame(); // 2

    pm.receiveServerTick(1, [
        { seq: 1, clientId: '2', data: { moveX: 999 } }
    ]);

    return pm.getStats().rollbackCount === 1;
});

test('tracks framesResimulated', () => {
    const { pm } = createPM({ inputDelayFrames: 0 });
    pm.enable();
    pm.addClient(2);

    pm.advanceFrame(); // 1
    pm.advanceFrame(); // 2
    pm.advanceFrame(); // 3

    // Rollback to frame 1, resimulate frames 1,2,3 → 3 frames resimulated
    // Actually: framesResimulated = localFrame(3) - toFrame(1) = 2
    pm.receiveServerTick(1, [
        { seq: 1, clientId: '2', data: { moveX: 999 } }
    ]);

    return pm.getStats().framesResimulated === 2;
});

test('tracks maxRollbackDepth', () => {
    const { pm } = createPM({ inputDelayFrames: 0, maxPredictionFrames: 10 });
    pm.enable();
    pm.addClient(2);

    for (let i = 0; i < 5; i++) pm.advanceFrame(); // frames 1-5

    pm.receiveServerTick(1, [
        { seq: 1, clientId: '2', data: { moveX: 999 } }
    ]);

    // maxRollbackDepth = localFrame(5) - toFrame(1) = 4
    return pm.getStats().maxRollbackDepth === 4;
});

test('onRollback callback is called', () => {
    const { pm } = createPM({ inputDelayFrames: 0 });
    pm.enable();
    pm.addClient(2);

    let callbackArgs: [number, number] | null = null;
    pm.onRollback = (from, to) => { callbackArgs = [from, to]; };

    pm.advanceFrame();
    pm.advanceFrame();

    pm.receiveServerTick(1, [
        { seq: 1, clientId: '2', data: { moveX: 999 } }
    ]);

    return callbackArgs !== null && callbackArgs[0] === 2 && callbackArgs[1] === 1;
});

// ============================================
// initialize
// ============================================

console.log('\nTest 6: initialize');

test('sets localFrame and confirmedFrame', () => {
    const { pm } = createPM();
    pm.initialize(50);
    return pm.localFrame === 50 && pm.confirmedFrame === 50;
});

test('resets stats', () => {
    const { pm } = createPM({ inputDelayFrames: 0 });
    pm.enable();
    pm.addClient(2);
    pm.advanceFrame();
    pm.receiveServerTick(1, [{ seq: 1, clientId: '2', data: { x: 1 } }]);

    pm.initialize(100);
    const stats = pm.getStats();
    return stats.rollbackCount === 0 && stats.framesResimulated === 0;
});

// ============================================
// getStats
// ============================================

console.log('\nTest 7: getStats');

test('returns correct predictionDepth', () => {
    const { pm } = createPM();
    pm.enable();
    pm.advanceFrame();
    pm.advanceFrame();
    pm.advanceFrame();

    const stats = pm.getStats();
    return stats.currentPredictionDepth === 3;
});

// ============================================
// Lifecycle event rollback — undo and replay
// ============================================

console.log('\nTest 8: Lifecycle rollback undo/replay');

test('lifecycle event replayed at correct frame during resimulation', () => {
    const { pm, world } = createPM({ inputDelayFrames: 0 });
    pm.enable();

    // Track tick count when lifecycle event fires during resimulation
    // This tells us which resim frame the event was replayed at
    let tickCountAtLifecycleReplay = -1;
    pm.onLifecycleEvent = (input) => {
        tickCountAtLifecycleReplay = world.tickCalls.length;
    };
    pm.onUndoLifecycleEvent = () => {};

    pm.advanceFrame(); // 1 (tick 1)
    pm.advanceFrame(); // 2 (tick 2)
    pm.advanceFrame(); // 3 (tick 3)
    // 3 original ticks

    // Join at frame 2 — rollback loads snapshot at frame 1, then resimulates 2,3
    // Lifecycle event should fire BEFORE the tick for frame 2
    pm.receiveServerTick(2, [
        { seq: 1, clientId: '5', data: { type: 'join' } },
    ]);

    // After rollback: 3 original + 2 resim ticks = 5 total
    // Lifecycle fires before resim frame 2's tick, so at tick count 3 (after original 3)
    return tickCountAtLifecycleReplay === 3;
});

test('lifecycle event NOT replayed at wrong frame', () => {
    const { pm, world } = createPM({ inputDelayFrames: 0 });
    pm.enable();

    let lifecycleCallCount = 0;
    pm.onLifecycleEvent = () => { lifecycleCallCount++; };
    pm.onUndoLifecycleEvent = () => {};

    pm.advanceFrame(); // 1
    pm.advanceFrame(); // 2
    pm.advanceFrame(); // 3

    // Join at frame 2 — should replay exactly once during resimulation
    pm.receiveServerTick(2, [
        { seq: 1, clientId: '5', data: { type: 'join' } },
    ]);

    // Resimulates frames 2 and 3, but lifecycle is only at frame 2
    return lifecycleCallCount === 1;
});

test('undo happens in reverse frame order before rollback', () => {
    const { pm } = createPM({ inputDelayFrames: 0, maxPredictionFrames: 10 });
    pm.enable();
    pm.addClient(2);

    const undoClientIds: string[] = [];
    pm.onLifecycleEvent = () => {};
    pm.onUndoLifecycleEvent = (input) => {
        undoClientIds.push(input.clientId);
    };

    pm.advanceFrame(); // 1
    pm.advanceFrame(); // 2
    pm.advanceFrame(); // 3

    // Place lifecycle events at frames 1 and 3 via sequential server ticks
    pm.receiveServerTick(1, [
        { seq: 1, clientId: '5', data: { type: 'join' } },
    ]);
    undoClientIds.length = 0; // reset after first rollback

    pm.receiveServerTick(3, [
        { seq: 2, clientId: '6', data: { type: 'join' } },
    ]);
    undoClientIds.length = 0; // reset after second rollback

    // Trigger rollback to frame 1 via a game input misprediction for tracked client 2
    pm.receiveServerTick(1, [
        { seq: 3, clientId: '2', data: { moveX: 999 } },
    ]);

    // Undo should process frame 3 first (client 6), then frame 1 (client 5)
    return undoClientIds.length === 2 &&
           undoClientIds[0] === '6' &&
           undoClientIds[1] === '5';
});

test('lifecycle + game input misprediction both trigger rollback with correct resim', () => {
    const { pm, world } = createPM({ inputDelayFrames: 0 });
    pm.enable();
    pm.addClient(2);

    let lifecycleFired = false;
    pm.onLifecycleEvent = () => { lifecycleFired = true; };
    pm.onUndoLifecycleEvent = () => {};

    pm.advanceFrame(); // 1
    pm.advanceFrame(); // 2

    const ticksBefore = world.tickCalls.length; // 2

    // Both a lifecycle event and a game input misprediction at frame 1
    const result = pm.receiveServerTick(1, [
        { seq: 1, clientId: '5', data: { type: 'join' } },
        { seq: 2, clientId: '2', data: { moveX: 999 } },
    ]);

    // Should rollback and resimulate frames 1+2 = 2 extra ticks
    return result === true &&
           world.tickCalls.length === ticksBefore + 2 &&
           lifecycleFired;
});

test('executeRollback with missing snapshot does not crash', () => {
    const { pm } = createPM({ inputDelayFrames: 0 });
    pm.enable();

    // Call executeRollback directly for a frame with no saved snapshot
    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => { warned = true; };
    try {
        pm.executeRollback(50); // no snapshot at frame 49
        return warned;
    } finally {
        console.warn = originalWarn;
    }
});

test('resimulation ticks correct frames with corrected inputs', () => {
    const { pm, world } = createPM({ inputDelayFrames: 0 });
    pm.enable();
    pm.addClient(2);

    pm.onLifecycleEvent = () => {};
    pm.onUndoLifecycleEvent = () => {};

    pm.advanceFrame(); // 1 — client 2 predicted as empty
    pm.advanceFrame(); // 2
    pm.advanceFrame(); // 3

    // Server says client 2 had moveX:999 at frame 1
    pm.receiveServerTick(1, [
        { seq: 1, clientId: '2', data: { moveX: 999 } },
    ]);

    // Resimulation should tick frames 1, 2, 3
    const resimTicks = world.tickCalls.slice(3); // skip the 3 original ticks
    if (resimTicks.length !== 3) return false;
    if (resimTicks[0].frame !== 1) return false;
    if (resimTicks[1].frame !== 2) return false;
    if (resimTicks[2].frame !== 3) return false;

    // Frame 1's resim should include client 2's confirmed input
    const frame1Inputs = resimTicks[0].inputs;
    const client2Input = frame1Inputs.find((i: any) => i.clientId === 2);
    return client2Input?.data?.moveX === 999;
});

test('resimulation saves corrected snapshots', () => {
    const { pm, world } = createPM({ inputDelayFrames: 0 });
    pm.enable();
    pm.addClient(2);

    pm.onLifecycleEvent = () => {};
    pm.onUndoLifecycleEvent = () => {};

    pm.advanceFrame(); // 1
    pm.advanceFrame(); // 2

    // Trigger rollback via misprediction — resimulation should save snapshots
    pm.receiveServerTick(1, [
        { seq: 1, clientId: '2', data: { moveX: 999 } },
    ]);

    // After resimulation, trigger another rollback via lifecycle event at frame 1
    // Lifecycle events always force rollback for past frames, regardless of confirmInput
    const result = pm.receiveServerTick(1, [
        { seq: 2, clientId: '8', data: { type: 'join' } },
    ]);
    // If snapshots were saved during resim, rollback succeeds without crash
    return result === true;
});

// ============================================
// Time sync delegation methods
// ============================================

console.log('\nTest 9: Time sync delegation');

test('getTimeSyncManager returns TimeSyncManager', () => {
    const { pm } = createPM();
    const tsm = pm.getTimeSyncManager();
    return tsm !== null && typeof tsm.isSynced === 'function';
});

test('onTimeSync delegates to TimeSyncManager', () => {
    const { pm } = createPM();
    pm.onTimeSync(1000, 2050, 1100);
    return pm.isTimeSynced();
});

test('isTimeSynced returns false before sync', () => {
    const { pm } = createPM();
    return !pm.isTimeSynced();
});

test('needsMoreTimeSyncSamples returns true initially', () => {
    const { pm } = createPM();
    return pm.needsMoreTimeSyncSamples();
});

test('getEstimatedLatency returns 0 before sync', () => {
    const { pm } = createPM();
    return pm.getEstimatedLatency() === 0;
});

test('getEstimatedLatency returns latency after sync', () => {
    const { pm } = createPM();
    pm.onTimeSync(1000, 2050, 1100);
    return pm.getEstimatedLatency() === 50;
});

test('getTargetFrame returns 0 without server start time', () => {
    const { pm } = createPM();
    return pm.getTargetFrame() === 0;
});

test('getAdjustedTickInterval returns tickInterval * multiplier', () => {
    const { pm } = createPM();
    pm.setTickInterval(50);
    // Default multiplier is 1.0
    return pm.getAdjustedTickInterval() === 50;
});

test('setTickInterval changes tick interval', () => {
    const { pm } = createPM();
    pm.setTickInterval(100);
    return pm.getAdjustedTickInterval() === 100;
});

test('onTickReceived does not crash', () => {
    const { pm } = createPM();
    pm.onTickReceived();
    pm.onTickReceived();
    return true;
});

// ============================================
// setInputsCallback
// ============================================

console.log('\nTest 10: setInputsCallback');

test('uses callback for collecting inputs during advanceFrame', () => {
    const { pm, world } = createPM({ inputDelayFrames: 0 });
    pm.enable();

    let callbackFrame = -1;
    pm.setInputsCallback((frame: number) => {
        callbackFrame = frame;
        const map = new Map<number, Record<string, any>>();
        map.set(1, { custom: true });
        return map;
    });

    pm.advanceFrame();
    return callbackFrame === 1 &&
           world.tickCalls[0].inputs.some((i: any) => i.data?.custom === true);
});

// ============================================
// reset
// ============================================

console.log('\nTest 11: reset');

test('reset resets localFrame and confirmedFrame', () => {
    const { pm } = createPM();
    pm.enable();
    pm.advanceFrame();
    pm.advanceFrame();
    pm.reset();
    return pm.localFrame === 0 && pm.confirmedFrame === 0;
});

test('reset resets time sync', () => {
    const { pm } = createPM();
    pm.onTimeSync(1000, 2050, 1100);
    pm.reset();
    return !pm.isTimeSynced();
});

// ============================================
// Lifecycle rollback — undo and replay (continued)
// ============================================

console.log('\nTest 12: Lifecycle rollback undo/replay');

test('reset clears lifecycle events', () => {
    const { pm } = createPM({ inputDelayFrames: 0 });
    pm.enable();

    const events: any[] = [];
    pm.onLifecycleEvent = (input) => { events.push(input); };
    pm.onUndoLifecycleEvent = () => {};

    pm.advanceFrame();
    pm.receiveServerTick(1, [
        { seq: 1, clientId: '5', data: { type: 'join' } },
    ]);

    pm.reset();
    events.length = 0;

    // After reset, advance and receive same frame — should still work
    pm.enable();
    pm.advanceFrame();
    pm.receiveServerTick(1, [
        { seq: 1, clientId: '6', data: { type: 'join' } },
    ]);

    return events.length >= 1;
});

// ============================================
// addClient / removeClient
// ============================================

console.log('\nTest 13: addClient / removeClient');

test('addClient makes client appear in predicted inputs', () => {
    const { pm, world } = createPM({ inputDelayFrames: 0 });
    pm.enable();
    pm.addClient(5);

    pm.advanceFrame();
    // Client 5 should have a predicted input (empty, from repeat-last)
    const inputs = world.tickCalls[0].inputs;
    return inputs.some((i: any) => i.clientId === 5);
});

test('removeClient stops predicting for that client', () => {
    const { pm, world } = createPM({ inputDelayFrames: 0 });
    pm.enable();
    pm.addClient(5);
    pm.removeClient(5);

    pm.advanceFrame();
    const inputs = world.tickCalls[0].inputs;
    return !inputs.some((i: any) => i.clientId === 5);
});

// ============================================
// resolveId error
// ============================================

console.log('\nTest 14: resolveId error');

test('receiveServerTick throws without resolver for game inputs', () => {
    const world = createMockWorld();
    const pm = new PredictionManager(world);
    pm.enable();
    pm.advanceFrame();

    try {
        pm.receiveServerTick(1, [
            { seq: 1, clientId: '2', data: { moveX: 100 } }
        ]);
        return false;
    } catch (e: any) {
        return e.message.includes('No client ID resolver');
    }
});

// ============================================
// Summary
// ============================================

console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

if (failed > 0) {
    console.log('\nPredictionManager tests FAILED!');
    process.exit(1);
} else {
    console.log('\nAll PredictionManager tests passed!');
    process.exit(0);
}
