/**
 * @fileoverview MCP tool catalog — the declarative list of tools the `/mcp`
 * server exposes over the shared core, with the §4 semantics. Tool names are
 * snake_case. Every description states that the operation is SESSION-SCOPED and
 * that results are visible in the web UI in realtime (the model must know it is
 * participating in a shared session).
 *
 * Image-producing tools return the §4.2 compact payload (`buildMcpEditPayload`),
 * never inline bytes unless `include_image: true`. Tools that create revisions
 * accept an `idempotency_key` (a resent key returns the existing revision).
 *
 * TRANSPORT (follow-up): mount at `/mcp` via the Agents SDK `McpAgent` pattern
 * with Durable Object backing + Streamable HTTP. Use a class DISTINCT from the
 * template's existing showcase `McpAgent` (e.g. `ImageToolsMcp`) to avoid the
 * name clash. Each handler is thin: parse → core → (payload builder) → serialize.
 */

/** A tool the MCP server exposes. `core` names the backing core function(s). */
export interface McpToolSpec {
  name: string;
  summary: string;
  core: string;
  /** True for image-producing tools that return the §4.2 compact payload. */
  producesImage?: boolean;
  /** True for revision-creating tools that accept `idempotency_key`. */
  idempotent?: boolean;
}

const SESSION_NOTE =
  "Session-scoped; results appear in the web UI in realtime (you are participating in a shared session).";

export const MCP_TOOLS: McpToolSpec[] = [
  { name: "create_session", summary: `Start a session from a library image or inline upload. ${SESSION_NOTE}`, core: "createSession" },
  { name: "resume_session", summary: `Resume a session by uuid; returns full state + tree. ${SESSION_NOTE}`, core: "resumeSession" },
  { name: "list_sessions", summary: "List sessions (filter/sort/paginate).", core: "listSessions" },
  { name: "list_sessions_for_image", summary: "Every session descended from one library image.", core: "listSessionsForImage" },
  { name: "get_session_tree", summary: `Full revision tree, attempts grouped, thumb URLs. ${SESSION_NOTE}`, core: "getSessionTree" },
  { name: "submit_edit", summary: `Create a revision (queued/awaiting_approval); streams progress via the session DO. ${SESSION_NOTE}`, core: "submitEdit → executeRevision", producesImage: true, idempotent: true },
  { name: "retry_revision", summary: "New attempt: same parent + fingerprint, attempt++.", core: "retryRevision", producesImage: true, idempotent: true },
  { name: "fork_revision", summary: "Branch a new edit from any node (incl. failed).", core: "forkRevision", producesImage: true, idempotent: true },
  { name: "decompose_image", summary: "Image → structured JSON blueprint, cached on the revision.", core: "decomposeImage" },
  { name: "pin_revision", summary: "Mark the accepted result (protects a video output from TTL).", core: "pinRevision" },
  { name: "cancel_revision", summary: "Cancel in-flight work.", core: "cancelRevision" },
  { name: "upload_library_image", summary: "Mint a direct upload URL; register the row on completion.", core: "createUploadIntent + completeUpload" },
  { name: "list_library", summary: "List library images (folder scope, paging).", core: "listLibrary" },
  { name: "create_folder", summary: "Create a library folder.", core: "createFolder" },
  { name: "move_image", summary: "Move an image to a folder.", core: "moveImage" },
  { name: "list_available_models", summary: "Registry ids, capabilities, cost — drives selection.", core: "listModels" },
  { name: "create_mask", summary: `Create a mask (bbox/polygon/raster/semantic). Semantic resolves NL → region. ${SESSION_NOTE}`, core: "createMask / createSemanticMask" },
  { name: "list_masks", summary: "List masks for a session (or library-scoped).", core: "listMasks" },
  { name: "describe_mask", summary: "Return a mask + a preview composited over the source (confirm before an expensive edit).", core: "describeMask" },
  { name: "approve_revision", summary: `Approve a gated revision (HITL). Available from all surfaces. ${SESSION_NOTE}`, core: "approveRevision" },
  { name: "reject_revision", summary: "Reject a gated revision (stays in the tree).", core: "rejectRevision" },
  { name: "get_prompt_templates", summary: "Retrieve relevant best-practice templates BEFORE composing a prompt.", core: "listTemplates" },
  { name: "promote_prompt", summary: "Promote a successful revision's prompt into a template.", core: "promoteFromRevision" },
  { name: "grade_revision", summary: "Record a grade + failure mode + suggested prompt (grade after a visibly poor result).", core: "gradeRevision" },
  { name: "set_task_default", summary: "Update the authoritative task->model mapping.", core: "PUT task_model_defaults" },
  { name: "set_asset_ttl", summary: "Set/clear a video asset's TTL (null = never).", core: "setAssetTtl" },
];
