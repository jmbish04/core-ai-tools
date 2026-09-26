/**
 * @fileoverview `backend/core` — the entire domain service layer, one core behind
 * three thin surfaces (Hono, MCP, frontend-via-REST). Every capability lives here
 * exactly once; surfaces parse → validate → call core → serialize, and never hold
 * business logic.
 *
 * Import from this barrel:
 *   import { createSession, submitEdit, getSessionTree, createCoreContext } from "@/backend/core";
 */

export * from "./context";
export * from "./errors";
export * from "./fingerprint";
export * from "./invariants";
export * from "./factory";
export * from "./events";
export * from "./images";
export * from "./library";
export * from "./folders";
export * from "./assets";
export * from "./prompts";
export * from "./understanding";
export * from "./sessions";
export * from "./revisions";
export * from "./masks";
export * from "./logs";
export * from "./generate";
