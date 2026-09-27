/**
 * @fileoverview `core/runs` barrel — the multi-model run engine (W2.5): one
 * intent fanned out to N models, each sent a prompt phrased for its provider,
 * executed concurrently and compared side by side.
 */

export * from "./prompt";
export * from "./runs";
export * from "./query";
