/**
 * Domain event log utilities (MET-006/MET-008 support).
 *
 * The event stream itself is the append-only `SimEvent[]` on the sim state;
 * this module provides the pure, headless-friendly accessors the pipeline,
 * metrics, and UI share. Events are deterministic (NFR-006): no wall-clock
 * values, ordering is the log order.
 */

import type { ParcelResult, SimEvent } from './types';

export type { SimEvent };

/** True if the event names the given parcel (all parcel-scoped events do). */
export function eventMentionsParcel(event: SimEvent, parcelId: string): boolean {
  return 'parcelId' in event && event.parcelId === parcelId;
}

/** All parcel-scoped events for one parcel, in log order. */
export function eventsForParcel(
  log: readonly SimEvent[],
  parcelId: string,
): SimEvent[] {
  return log.filter((e) => eventMentionsParcel(e, parcelId));
}

/** First event of a type in log order (undefined if none). */
export function firstEventOfType<T extends SimEvent['type']>(
  log: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }> | undefined {
  return log.find((e) => e.type === type) as
    | Extract<SimEvent, { type: T }>
    | undefined;
}

/** Last event of a type in log order (undefined if none). */
export function lastEventOfType<T extends SimEvent['type']>(
  log: readonly SimEvent[],
  type: T,
): Extract<SimEvent, { type: T }> | undefined {
  let last: Extract<SimEvent, { type: T }> | undefined;
  for (const e of log) {
    if (e.type === type) last = e as Extract<SimEvent, { type: T }>;
  }
  return last;
}

/** Exit → ACK latency in ms (MET-006); undefined until the ACK arrives. */
export function exitToAckMs(result: ParcelResult): number | undefined {
  if (result.ackSimTimeMs === undefined) return undefined;
  return result.ackSimTimeMs - result.exitSimTimeMs;
}

/** Finalize → ACK latency in ms; undefined until the ACK arrives. */
export function finalizeToAckMs(result: ParcelResult): number | undefined {
  if (result.ackSimTimeMs === undefined) return undefined;
  return result.ackSimTimeMs - result.finalizedSimTimeMs;
}
