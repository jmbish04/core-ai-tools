/**
 * @fileoverview Core service-layer error taxonomy. Every surface (Hono, MCP,
 * future internal callers) maps these to its own transport: Hono → HTTP status,
 * MCP → tool error. The core NEVER throws bare `Error` for an expected failure —
 * it throws one of these so callers can branch on `.code` without string-matching.
 */

/** Machine-readable error codes, stable across surfaces. */
export type CoreErrorCode =
  | "not_found"
  | "conflict"
  | "validation"
  | "capability"
  | "invariant"
  | "not_implemented"
  | "provider";

/**
 * Base class for all expected core failures. `status` is an HTTP-shaped hint the
 * Hono layer can use directly; other surfaces ignore it.
 */
export class CoreError extends Error {
  readonly code: CoreErrorCode;
  readonly status: number;
  /** Optional structured detail (e.g. the models that DO support a capability). */
  readonly detail?: unknown;

  constructor(code: CoreErrorCode, message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "CoreError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** A referenced row does not exist (or is soft-deleted). */
export class NotFoundError extends CoreError {
  constructor(message: string, detail?: unknown) {
    super("not_found", message, 404, detail);
    this.name = "NotFoundError";
  }
}

/** A concurrent-safe operation lost a race and the caller should not blindly retry. */
export class ConflictError extends CoreError {
  constructor(message: string, detail?: unknown) {
    super("conflict", message, 409, detail);
    this.name = "ConflictError";
  }
}

/** Input failed a semantic rule the type system could not express. */
export class ValidationError extends CoreError {
  constructor(message: string, detail?: unknown) {
    super("validation", message, 422, detail);
    this.name = "ValidationError";
  }
}

/**
 * A model/provider cannot satisfy a requested capability (e.g. masked inpainting
 * on a model whose `mask_inpainting` flag is false). `detail` should name the
 * models that CAN, per the spec's "reject with a clear error" requirement.
 */
export class CapabilityError extends CoreError {
  constructor(message: string, detail?: unknown) {
    super("capability", message, 422, detail);
    this.name = "CapabilityError";
  }
}

/**
 * A load-bearing invariant was violated (e.g. more than one seed node per
 * session). These mirror DB constraints so the caller gets a readable message
 * instead of a raw SQLite constraint string.
 */
export class InvariantError extends CoreError {
  constructor(message: string, detail?: unknown) {
    super("invariant", message, 500, detail);
    this.name = "InvariantError";
  }
}

/**
 * A required piece of configuration (a secret, an account hash, a binding value)
 * did not resolve. Thrown to FAIL LOUD rather than emit a broken artifact — e.g.
 * refusing to build `imagedelivery.net/undefined/...`, which 404s in a way that
 * looks like a missing image instead of missing config.
 */
export class ConfigError extends CoreError {
  constructor(message: string, detail?: unknown) {
    super("invariant", message, 500, detail);
    this.name = "ConfigError";
  }
}

/** An upstream provider (Gemini/OpenAI) call failed — 502-shaped, not our bug. */
export class ProviderError extends CoreError {
  constructor(message: string, detail?: unknown) {
    super("provider", message, 502, detail);
    this.name = "ProviderError";
  }
}

/** A seam that a later build phase fills in (CF Images, model dispatch, SessionDO). */
export class NotImplementedError extends CoreError {
  constructor(message: string, detail?: unknown) {
    super("not_implemented", message, 501, detail);
    this.name = "NotImplementedError";
  }
}

/**
 * True when a thrown error is a SQLite UNIQUE/PRIMARY-KEY constraint violation.
 * Used by the optimistic-retry loops (attempt_number, event seq) to distinguish
 * a losable race from a real failure.
 *
 * Drizzle WRAPS the D1 error: the outer message is "Failed query: insert ..."
 * and the real "UNIQUE constraint failed" text lives on `err.cause` (sometimes
 * nested further). So we walk the whole cause chain, not just the top message.
 */
export function isUniqueViolation(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && !seen.has(current)) {
    seen.add(current);
    const msg = current instanceof Error ? current.message : String(current);
    if (
      msg.includes("UNIQUE constraint failed") ||
      msg.includes("SQLITE_CONSTRAINT_PRIMARYKEY") ||
      msg.includes("SQLITE_CONSTRAINT_UNIQUE")
    ) {
      return true;
    }
    current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}
