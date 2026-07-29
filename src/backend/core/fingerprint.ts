/**
 * @fileoverview Edit fingerprinting. The `edit_fingerprint` is the stable hash
 * that groups retries: a retry is "same parent + same fingerprint, attempt++".
 * It MUST be deterministic across surfaces and across time — the same logical
 * edit issued from the UI and from MCP has to hash identically — so it is
 * computed from a CANONICAL serialization (recursively sorted object keys),
 * never from raw `JSON.stringify` (whose key order follows insertion order).
 */

/**
 * Canonical JSON: object keys sorted recursively so equal values serialize to
 * identical strings regardless of construction order. Arrays keep their order
 * (order is semantically meaningful in an edit payload). Primitives pass through.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

/** Canonical string form used as the hash input. */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Stable SHA-256 (hex) fingerprint of a normalized edit. The provider override
 * is intentionally EXCLUDED — retrying the same edit against a different model
 * is still "the same edit" for grouping purposes; the served model is recorded
 * per-revision separately.
 *
 * @param editPayload the structured edit (instruction and/or field changes)
 * @param maskId optional mask the edit is scoped to — a masked and unmasked
 *   version of the same instruction are genuinely different edits, so the mask
 *   identity is folded into the fingerprint.
 * @param maskMode how the mask is applied; likewise part of edit identity.
 */
export async function editFingerprint(
  editPayload: unknown,
  maskId?: string | null,
  maskMode?: string | null,
): Promise<string> {
  const input = canonicalStringify({
    payload: editPayload ?? null,
    mask_id: maskId ?? null,
    mask_mode: maskMode ?? "none",
  });
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
