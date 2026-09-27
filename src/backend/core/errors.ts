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

/**
 * An upstream provider (Gemini/OpenAI) call failed — 502-shaped, not our bug.
 * `retryable` marks a TRANSPORT failure (rate limit, 5xx, network) that
 * `executeRevision` may route to a fallback model; policy/auth/validation
 * failures stay non-retryable (a different model would not fix them).
 */
export class ProviderError extends CoreError {
  readonly retryable: boolean;
  constructor(message: string, detail?: unknown, retryable = false) {
    super("provider", message, 502, detail);
    this.name = "ProviderError";
    this.retryable = retryable;
  }
}

/**
 * Classify a raw SDK error into an actionable, correctly-flagged ProviderError
 * (pattern from gemini-cli-extensions/nanobanana's `handleApiError`: map status
 * and message text to a message that says what to fix). Reads `status` from the
 * error (both `@google/genai` and `openai` SDKs expose it) and falls back to
 * message sniffing for errors that only carry text.
 *
 * @param label  Provider call name for the message, e.g. "Gemini Interactions".
 * @param err    The thrown SDK error.
 * @returns A ProviderError whose `retryable` is true only for transport failures.
 * @example throw classifyProviderError("OpenAI Images", err);
 */
export function classifyProviderError(label: string, err: unknown): ProviderError {
  const raw = (err as Error | undefined)?.message ?? String(err);
  const msg = raw.toLowerCase();
  const status = Number((err as { status?: unknown } | null)?.status) || 0;
  const fail = (hint: string, retryable: boolean) =>
    new ProviderError(`${label} failed: ${hint} (${raw})`, err, retryable);

  if (status === 401 || status === 403 || msg.includes("api key not valid") || msg.includes("permission denied")) {
    return fail("authentication — the API key is invalid or lacks access; check the provider secret", false);
  }
  if (status === 429 || msg.includes("quota") || msg.includes("rate limit") || msg.includes("resource_exhausted")) {
    return fail("rate limit / quota exceeded", true);
  }
  if (msg.includes("safety") || msg.includes("content policy") || msg.includes("moderation") || msg.includes("blocked")) {
    return fail("the prompt or image was blocked by the provider's content policy — rephrase it", false);
  }
  if (status >= 500 || /timeout|timed out|econnreset|network|fetch failed|unavailable|overloaded/.test(msg)) {
    return fail("provider transport error", true);
  }
  if (status === 400) return fail("request rejected as malformed — check prompt, image, and parameters", false);
  return fail("unexpected error", false);
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
