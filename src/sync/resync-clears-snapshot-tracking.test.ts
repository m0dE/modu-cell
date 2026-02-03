/**
 * Test: clientsWithEntitiesFromSnapshot is cleared after resync
 *
 * Bug: loadNetworkSnapshot() populates clientsWithEntitiesFromSnapshot, but
 * handleResyncSnapshot() didn't clear it afterward. This caused future join
 * events to incorrectly skip onConnect for clients whose entities were in
 * the resync snapshot.
 *
 * Expected behavior: After resync, clientsWithEntitiesFromSnapshot should be
 * empty so that future join events correctly call onConnect.
 */
import { describe, test, expect, vi } from 'vitest';
import { Game } from '../game';
import { Transform2D, Player } from '../components';
import { encode, decode } from '../codec';

function createMockConnection(clientId: string) {
    return {
        clientId,
        send: vi.fn(),
        sendSnapshot: vi.fn(),
        sendStateHash: vi.fn(),
        sendPartitionData: vi.fn(),
        requestResync: vi.fn(),
        leaveRoom: vi.fn(),
        totalBytesIn: 0,
        totalBytesOut: 0,
        bandwidthIn: 0,
        bandwidthOut: 0,
    };
}

describe('Resync clears snapshot tracking', () => {
    test('clientsWithEntitiesFromSnapshot is cleared after handleResyncSnapshot', () => {
        console.log('\n=== Test: clientsWithEntitiesFromSnapshot cleared after resync ===\n');

        // Create a game
        const conn = createMockConnection('client-a');
        const game = new Game();
        (game as any).connection = conn;
        (game as any).localClientIdStr = 'client-a';

        // Define entity types
        game.defineEntity('food').with(Transform2D);
        game.defineEntity('cell').with(Transform2D).with(Player);

        // Track onConnect calls
        let onConnectCalls: string[] = [];
        (game as any).callbacks = {
            onConnect: (clientId: string) => {
                console.log(`  onConnect called for: ${clientId}`);
                onConnectCalls.push(clientId);
                const cell = game.spawn('cell', { x: 100, y: 100 });
                cell.get(Player).clientId = (game as any).internClientId(clientId);
            }
        };

        // Simulate initial setup
        for (let i = 0; i < 10; i++) {
            game.spawn('food', { x: i * 10, y: i * 10 });
        }

        // Simulate authority joining
        (game as any).processInput({
            seq: 1,
            clientId: 'client-a',
            data: { type: 'join', clientId: 'client-a' }
        });
        console.log(`After client-a join: entities=${(game as any).world.entityCount}`);

        // Simulate second client joining
        (game as any).processInput({
            seq: 2,
            clientId: 'client-b',
            data: { type: 'join', clientId: 'client-b' }
        });
        console.log(`After client-b join: entities=${(game as any).world.entityCount}`);

        // Run a tick
        (game as any).world.tick(0);

        // Take a snapshot
        const snapshot = (game as any).getNetworkSnapshot();
        const encoded = encode({ snapshot, hash: (game as any).world.getStateHash() });

        console.log(`\nSnapshot has ${snapshot.entities.length} entities`);
        console.log(`onConnect calls before resync: [${onConnectCalls.join(', ')}]`);

        // Clear onConnect tracking
        onConnectCalls = [];

        // Simulate a resync (this would normally happen when desync is detected)
        console.log('\n--- Simulating resync ---');

        const decoded = decode(encoded) as any;

        // Set up desync state (normally set by handleMajorityHash)
        (game as any).isDesynced = true;
        (game as any).resyncPending = true;
        (game as any).desyncFrame = 0;
        (game as any).desyncLocalHash = 12345;
        (game as any).desyncMajorityHash = 67890;

        // Call handleResyncSnapshot directly
        (game as any).handleResyncSnapshot(encoded, 0);

        // Verify clientsWithEntitiesFromSnapshot is empty
        const snapshotTracking = (game as any).clientsWithEntitiesFromSnapshot;
        console.log(`\nclientsWithEntitiesFromSnapshot after resync: [${[...snapshotTracking].join(', ')}]`);
        console.log(`Size: ${snapshotTracking.size}`);

        expect(snapshotTracking.size).toBe(0);

        // Verify that a new client joining after resync correctly triggers onConnect
        console.log('\n--- New client joins after resync ---');
        (game as any).processInput({
            seq: 3,
            clientId: 'client-c',
            data: { type: 'join', clientId: 'client-c' }
        });

        console.log(`onConnect calls after client-c join: [${onConnectCalls.join(', ')}]`);

        // client-c should have triggered onConnect
        expect(onConnectCalls).toContain('client-c');
        expect(onConnectCalls.length).toBe(1);

        console.log('\n=== PASS: clientsWithEntitiesFromSnapshot correctly cleared after resync ===');
    });

    test('duplicate join after resync correctly skips onConnect (client still active)', () => {
        console.log('\n=== Test: Duplicate join after resync ===\n');

        // After resync, clients from the snapshot are still in activeClients.
        // A duplicate join for an already-active client should NOT call onConnect.
        // This is correct behavior - onConnect is for NEW connections.

        const conn = createMockConnection('client-a');
        const game = new Game();
        (game as any).connection = conn;
        (game as any).localClientIdStr = 'client-a';

        game.defineEntity('cell').with(Transform2D).with(Player);

        let onConnectCalls: string[] = [];
        (game as any).callbacks = {
            onConnect: (clientId: string) => {
                onConnectCalls.push(clientId);
                const cell = game.spawn('cell', { x: 100, y: 100 });
                cell.get(Player).clientId = (game as any).internClientId(clientId);
            }
        };

        // Setup: Two clients join
        (game as any).processInput({ seq: 1, clientId: 'client-a', data: { type: 'join', clientId: 'client-a' } });
        (game as any).processInput({ seq: 2, clientId: 'client-b', data: { type: 'join', clientId: 'client-b' } });
        (game as any).world.tick(0);

        const snapshot = (game as any).getNetworkSnapshot();
        const encoded = encode({ snapshot, hash: (game as any).world.getStateHash() });

        const entitiesBeforeResync = (game as any).world.entityCount;
        console.log(`Entities before resync: ${entitiesBeforeResync}`);

        onConnectCalls = [];

        // Simulate resync
        (game as any).isDesynced = true;
        (game as any).resyncPending = true;
        (game as any).desyncFrame = 0;
        (game as any).desyncLocalHash = 1;
        (game as any).desyncMajorityHash = 2;
        (game as any).handleResyncSnapshot(encoded, 0);

        // After resync, entities should be same as before
        const entitiesAfterResync = (game as any).world.entityCount;
        console.log(`Entities after resync: ${entitiesAfterResync}`);
        expect(entitiesAfterResync).toBe(entitiesBeforeResync);

        // client-b is still in activeClients after resync (from snapshot)
        const activeClients = (game as any).activeClients;
        expect(activeClients).toContain('client-b');
        console.log(`activeClients after resync: [${activeClients.join(', ')}]`);

        // A duplicate join for client-b should NOT trigger onConnect
        // (client-b is already active, no disconnect happened)
        (game as any).processInput({ seq: 3, clientId: 'client-b', data: { type: 'join', clientId: 'client-b' } });

        // onConnect should NOT be called - client-b was already active
        expect(onConnectCalls).not.toContain('client-b');
        expect(onConnectCalls.length).toBe(0);

        console.log(`onConnect calls after duplicate join: [${onConnectCalls.join(', ')}]`);
        console.log('(Correct: onConnect NOT called for already-active client)');
    });
});
