/**
 * Resync Fresh Snapshot Test
 *
 * Tests that REQUEST_RESYNC triggers authority to upload a FRESH snapshot,
 * not the stale stored one. This is critical for games with system-driven
 * entity spawning (like cell-eater) where entities spawn every tick.
 *
 * Scenario:
 * 1. Authority + Client B are running, synced
 * 2. Game spawns entities via system (simulating food spawning)
 * 3. Client B refreshes - gets new clientId
 * 4. Client B detects desync (stale snapshot vs fresh state)
 * 5. Client B requests resync
 * 6. Server should request FRESH snapshot from authority
 * 7. Client B should receive current entity count, not stale
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Game } from '../game';
import { Transform2D, Player } from '../components';
import { encode, decode } from '../codec';

// Track entity spawns
let foodCount = 0;

function createMockConnection(clientId: string) {
    return {
        clientId,
        send: vi.fn(),
        sendSnapshot: vi.fn(),
        sendStateHash: vi.fn(),
        sendPartitionData: vi.fn(),
        requestResync: vi.fn(),
        onMessage: vi.fn(),
        onInput: vi.fn(),
        close: vi.fn()
    };
}

describe('Resync Gets Fresh Snapshot', () => {
    beforeEach(() => {
        foodCount = 0;
    });

    test('resync_request input should trigger authority to upload fresh snapshot', () => {
        const authorityConn = createMockConnection('authority-id');
        const authority = new Game({ tickRate: 60 });
        (authority as any).connection = authorityConn;
        (authority as any).localClientIdStr = 'authority-id';
        (authority as any).authorityClientId = 'authority-id';

        authority.defineEntity('player')
            .with(Transform2D)
            .with(Player);

        authority.defineEntity('food')
            .with(Transform2D);

        // No callbacks needed for this test - we're testing the input handling
        (authority as any).callbacks = {};

        // Authority is alone, set up activeClients
        (authority as any).activeClients = ['authority-id'];
        (authority as any).activeClients.sort();

        // Run a tick
        (authority as any).world.tick(0);

        // Check initial pendingSnapshotUpload
        expect((authority as any).pendingSnapshotUpload).toBe(false);

        // Process a resync_request input
        (authority as any).processInput({
            seq: 1,
            clientId: 'client-b',
            data: { type: 'resync_request', clientId: 'client-b' }
        });

        // Authority should now have pendingSnapshotUpload = true
        expect((authority as any).pendingSnapshotUpload).toBe(true);

        console.log('resync_request correctly triggers pendingSnapshotUpload');
    });

    test('fresh snapshot should have current entity count after system spawns', () => {
        const authorityConn = createMockConnection('authority-id');
        const authority = new Game({ tickRate: 60 });
        (authority as any).connection = authorityConn;
        (authority as any).localClientIdStr = 'authority-id';
        (authority as any).authorityClientId = 'authority-id';

        authority.defineEntity('player')
            .with(Transform2D)
            .with(Player);

        authority.defineEntity('food')
            .with(Transform2D);

        // Spawn food system - spawns one food per tick
        authority.addSystem(() => {
            if (foodCount < 10) {
                authority.spawn('food', { x: foodCount * 10, y: 0 });
                foodCount++;
            }
        });

        (authority as any).callbacks = {
            onConnect: (clientId: string) => {
                const cell = authority.spawn('player', { x: 100, y: 100 });
                cell.get(Player).clientId = (authority as any).internClientId(clientId);
            }
        };

        // Authority joins
        (authority as any).activeClients = ['authority-id'];
        (authority as any).processInput({
            seq: 1,
            clientId: 'authority-id',
            data: { type: 'join', clientId: 'authority-id' }
        });
        (authority as any).world.tick(0);

        // First snapshot sent on join
        let snapshotCall = 0;
        authorityConn.sendSnapshot.mockImplementation((data: any) => {
            snapshotCall++;
            console.log(`Snapshot ${snapshotCall} sent`);
        });

        // Client B joins - triggers first snapshot
        (authority as any).processInput({
            seq: 2,
            clientId: 'client-b',
            data: { type: 'join', clientId: 'client-b' }
        });
        (authority as any).world.tick(1);  // This triggers snapshot upload
        (authority as any).pendingSnapshotUpload = false;  // Clear it

        const entityCountAtJoin = authority.world.entityCount;
        console.log(`Entity count at join: ${entityCountAtJoin}`);

        // Simulate game running for 5 more ticks - food spawns each tick
        for (let i = 0; i < 5; i++) {
            (authority as any).world.tick(2 + i);
        }

        const entityCountAfter5Ticks = authority.world.entityCount;
        console.log(`Entity count after 5 more ticks: ${entityCountAfter5Ticks}`);

        // Now Client B requests resync
        (authority as any).processInput({
            seq: 3,
            clientId: 'client-b',
            data: { type: 'resync_request', clientId: 'client-b' }
        });

        // Authority should have pendingSnapshotUpload = true
        expect((authority as any).pendingSnapshotUpload).toBe(true);

        // Run one more tick to trigger snapshot upload
        (authority as any).world.tick(7);

        // Get the snapshot that would be sent
        const snapshot = (authority as any).getNetworkSnapshot();
        console.log(`Fresh snapshot entity count: ${snapshot.entities.length}`);

        // The fresh snapshot should have the CURRENT entity count
        // Not the stale count from when Client B first joined
        // Note: snapshot is taken AFTER the tick runs, so it includes one more entity
        expect(snapshot.entities.length).toBe(authority.world.entityCount);
        expect(snapshot.entities.length).toBeGreaterThan(entityCountAtJoin);
    });

    test('simulated full resync flow', () => {
        // This test simulates the full resync flow:
        // 1. Authority has entities
        // 2. "Stale" snapshot is taken
        // 3. More entities spawn
        // 4. Client requests resync with resync_request input
        // 5. Authority uploads fresh snapshot
        // 6. Client loads fresh snapshot and matches

        const authorityConn = createMockConnection('authority-id');
        const authority = new Game({ tickRate: 60 });
        (authority as any).connection = authorityConn;
        (authority as any).localClientIdStr = 'authority-id';
        (authority as any).authorityClientId = 'authority-id';

        authority.defineEntity('food')
            .with(Transform2D);

        authority.addSystem(() => {
            if (foodCount < 20) {
                authority.spawn('food', { x: foodCount * 10, y: 0 });
                foodCount++;
            }
        });

        (authority as any).callbacks = {};
        (authority as any).activeClients = ['authority-id'];

        // Run 5 ticks - 5 food entities
        for (let i = 0; i < 5; i++) {
            (authority as any).world.tick(i);
        }
        console.log(`After 5 ticks: ${authority.world.entityCount} entities`);

        // Take "stale" snapshot (simulating what server has stored)
        const staleSnapshot = (authority as any).getNetworkSnapshot();
        const staleEntityCount = staleSnapshot.entities.length;
        console.log(`Stale snapshot: ${staleEntityCount} entities`);

        // Run 5 more ticks - 5 more food entities
        for (let i = 5; i < 10; i++) {
            (authority as any).world.tick(i);
        }
        console.log(`After 10 ticks: ${authority.world.entityCount} entities`);

        // Now simulate resync_request
        (authority as any).processInput({
            seq: 1,
            clientId: 'client-b',
            data: { type: 'resync_request', clientId: 'client-b' }
        });
        expect((authority as any).pendingSnapshotUpload).toBe(true);

        // Run tick to trigger snapshot
        (authority as any).world.tick(10);

        // Get fresh snapshot
        const freshSnapshot = (authority as any).getNetworkSnapshot();
        const freshEntityCount = freshSnapshot.entities.length;
        console.log(`Fresh snapshot: ${freshEntityCount} entities`);

        // Fresh should have more entities than stale
        expect(freshEntityCount).toBeGreaterThan(staleEntityCount);
        // Note: snapshot is taken AFTER tick runs, so it's 11 (tick 10 spawns entity 11)
        expect(freshEntityCount).toBe(authority.world.entityCount);

        // Now simulate late joiner loading the FRESH snapshot
        const lateJoinerConn = createMockConnection('client-b');
        const lateJoiner = new Game({ tickRate: 60 });
        (lateJoiner as any).connection = lateJoinerConn;
        (lateJoiner as any).localClientIdStr = 'client-b';

        lateJoiner.defineEntity('food')
            .with(Transform2D);

        // Encode/decode to simulate network
        const encoded = encode({ snapshot: freshSnapshot, hash: 0 });
        const decoded = decode(encoded) as any;

        (lateJoiner as any).loadNetworkSnapshot(decoded.snapshot);

        const lateJoinerEntityCount = lateJoiner.world.entityCount;
        console.log(`Late joiner after loading fresh snapshot: ${lateJoinerEntityCount} entities`);

        // Late joiner should match authority
        expect(lateJoinerEntityCount).toBe(authority.world.entityCount);

        // Hashes should match
        const authorityHash = authority.world.getStateHash();
        const lateJoinerHash = lateJoiner.world.getStateHash();
        console.log(`Authority hash: ${authorityHash}`);
        console.log(`Late joiner hash: ${lateJoinerHash}`);
        expect(lateJoinerHash).toBe(authorityHash);
    });
});
