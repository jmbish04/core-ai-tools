/**
 * @fileoverview `sessions/` domain barrel — the editing core: sessions, the
 * revision tree, masks, and the append-only event log. Consumers import from
 * this folder path, never the individual table files.
 *
 * Export order respects FK dependency (sessions -> masks -> revisions ->
 * revision_events) purely for readability; Drizzle resolves references lazily
 * so order is not load-bearing.
 */

export * from "./sessions";
export * from "./masks";
export * from "./revisions";
export * from "./revision-events";
export * from "./revision-artifacts";
