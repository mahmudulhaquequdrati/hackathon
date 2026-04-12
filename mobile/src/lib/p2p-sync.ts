/**
 * M2.4: Peer-to-peer CRDT sync over local network (Wi-Fi Direct).
 *
 * Each device can act as both sender and receiver.
 * Delta-sync: only transmit records changed since the peer's last known clock.
 * Target: sub-10 KB per sync cycle under normal operation.
 */

import { log } from './debug';
import * as db from './database';
import {
  mergeMaps,
  materialize,
  VC,
  type CrdtSupplyState,
  type VectorClock,
  type ConflictEntry,
} from './crdt';

export interface P2PSyncPayload {
  deviceId: string;
  vectorClock: VectorClock;
  changes: Array<{ id: string; crdtState: string }>;
}

export interface P2PSyncResult {
  merged: number;
  conflicts: ConflictEntry[];
  bytesTransferred: number;
}

/**
 * Build the outgoing delta-sync payload.
 * Only includes records that are newer than the peer's clock.
 */
export async function buildSyncPayload(
  deviceId: string,
  peerClock: VectorClock,
): Promise<P2PSyncPayload> {
  const localClock = await db.getVectorClock();
  const allRows = await db.getAllSupplies();
  const hasPeerClock = Object.keys(peerClock).length > 0;

  const changes: Array<{ id: string; crdtState: string }> = [];

  for (const row of allRows) {
    if (!row.crdt_state) continue;

    if (!hasPeerClock) {
      // Full sync — peer has no clock
      changes.push({ id: row.id, crdtState: row.crdt_state });
    } else {
      // Delta sync — only send if record is newer
      const crdt: CrdtSupplyState = JSON.parse(row.crdt_state);
      const recordClock = crdt.vectorClock || {};
      const relation = VC.compare(recordClock, peerClock);
      if (relation === 'after' || relation === 'concurrent') {
        changes.push({ id: row.id, crdtState: row.crdt_state });
      }
    }
  }

  return { deviceId, vectorClock: localClock, changes };
}

/**
 * Apply an incoming sync payload from a peer.
 * Merges each received CRDT state with local copy.
 */
export async function applySyncPayload(
  payload: P2PSyncPayload,
): Promise<P2PSyncResult> {
  const conflicts: ConflictEntry[] = [];
  let merged = 0;

  for (const change of payload.changes) {
    const remoteCrdt: CrdtSupplyState =
      typeof change.crdtState === 'string'
        ? JSON.parse(change.crdtState)
        : change.crdtState;

    const existingRow = await db.getSupplyById(change.id);

    if (existingRow && existingRow.crdt_state) {
      const localCrdt: CrdtSupplyState = JSON.parse(existingRow.crdt_state);
      const result = mergeMaps(localCrdt, remoteCrdt);
      const plain = materialize(result.merged);
      await db.upsertSupply(change.id, plain, JSON.stringify(result.merged), false);
      if (result.conflicts.length > 0) conflicts.push(...result.conflicts);
    } else {
      const plain = materialize(remoteCrdt);
      await db.upsertSupply(change.id, plain, JSON.stringify(remoteCrdt), false);
    }
    merged++;
  }

  // Merge vector clocks
  const localClock = await db.getVectorClock();
  const mergedClock = VC.merge(localClock, payload.vectorClock);
  await db.saveVectorClock(mergedClock);

  const bytesTransferred = JSON.stringify(payload).length;
  log('info', `P2P sync applied: ${merged} records, ${bytesTransferred} bytes, ${conflicts.length} conflicts`);

  return { merged, conflicts, bytesTransferred };
}

/**
 * Execute a full peer-to-peer sync with another device via direct HTTP.
 * 1. Send our delta payload to the peer
 * 2. Receive their delta payload
 * 3. Apply their payload locally
 */
export async function syncWithPeer(
  deviceId: string,
  peerUrl: string,
): Promise<P2PSyncResult> {
  log('info', `Starting P2P sync with ${peerUrl}`);

  // Step 1: Get peer's clock first
  const peerStateRes = await fetch(`${peerUrl}/p2p/state`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  const peerState = await peerStateRes.json();
  const peerClock: VectorClock = peerState.vectorClock || {};

  // Step 2: Build our delta payload (only records peer hasn't seen)
  const outgoing = await buildSyncPayload(deviceId, peerClock);
  const outgoingBytes = JSON.stringify(outgoing).length;
  log('info', `P2P outgoing: ${outgoing.changes.length} records, ${outgoingBytes} bytes`);

  // Step 3: Exchange — send ours, get theirs back
  const exchangeRes = await fetch(`${peerUrl}/p2p/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(outgoing),
  });
  const incoming: P2PSyncPayload = await exchangeRes.json();
  const incomingBytes = JSON.stringify(incoming).length;

  // Step 4: Apply their payload locally
  const result = await applySyncPayload(incoming);
  result.bytesTransferred = outgoingBytes + incomingBytes;

  log('info', `P2P sync complete: ${result.bytesTransferred} bytes total (target <10KB)`);
  return result;
}
