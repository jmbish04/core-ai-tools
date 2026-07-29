/**
 * @fileoverview `core/events` barrel. Consumers import the emitter interface and
 * whichever implementation the composition root wires in (DirectD1Emitter now,
 * SessionDoEmitter from Phase 6).
 */

export * from "./emitter";
export * from "./direct-d1-emitter";
export * from "./session-do-emitter";
