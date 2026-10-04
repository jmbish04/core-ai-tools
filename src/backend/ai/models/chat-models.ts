/**
 * @fileoverview Chat-model picker registry — guardian ROUTING ALIASES.
 *
 * Every LLM call in this Worker goes through core-guardian, so the picker
 * offers guardian's routing INTENTS, not provider model ids. Guardian chooses
 * the actual model behind each alias, which is what lets it enforce budget and
 * breaker checks and keeps model selection in one place instead of in every
 * caller.
 *
 * ## This list used to be pinned Workers AI ids, and could not stay that way
 *
 * It held `@cf/openai/gpt-oss-120b` and two Llama ids, passed straight to
 * `createWorkersAI({ binding: env.AI })`. There is no `ai` binding any more and
 * there must not be one — `env.AI.run` is account-implicit, always bills the
 * paid account, and cannot be metered per-account. With that binding gone those
 * ids addressed nothing, so the picker had to be re-expressed in the only
 * vocabulary the remaining door understands.
 *
 * Single source of truth shared by:
 *  - the backend (`getChatModel(env, modelId)` validates against it), and
 *  - the frontend model `<Select>` in the Thread header (a plain data array —
 *    no server code is pulled into the bundle).
 */

/** A single selectable guardian routing alias. */
export interface ChatModelOption {
  /** Guardian routing alias (e.g. "auto"). NOT a provider model id. */
  id: string;
  /** Short human label for the dropdown. */
  label: string;
  /** One-line hint shown under the label. */
  hint: string;
}

/**
 * The guardian routing aliases offered in the model picker.
 *
 * The FIRST entry is the default when a thread has no explicit `model` set and
 * `MODEL_CHAT` is unset. `auto` leads deliberately: letting guardian route is
 * the behaviour that stays correct as its catalog and pricing change, whereas
 * anything more specific is a standing bet on today's line-up.
 */
export const CHAT_MODEL_OPTIONS: readonly ChatModelOption[] = [
  {
    id: "auto",
    label: "Auto",
    hint: "Guardian routes by task · recommended",
  },
  {
    id: "best",
    label: "Best",
    hint: "Highest capability available",
  },
  {
    id: "budget",
    label: "Budget",
    hint: "Capable, cheaper tier",
  },
  {
    id: "cheapest",
    label: "Cheapest",
    hint: "Lowest cost per call",
  },
] as const;

/** Default chat alias (first option). */
export const DEFAULT_CHAT_MODEL_ID = CHAT_MODEL_OPTIONS[0]!.id;

/** Set of valid aliases for O(1) validation. */
const VALID_MODEL_IDS = new Set(CHAT_MODEL_OPTIONS.map((m) => m.id));

/**
 * Narrow an arbitrary string to a known chat model id, or `undefined` if it is
 * not one of the offered models.
 *
 * @param id - Candidate model id (e.g. from a thread row or query param).
 */
export function asChatModelId(id: string | null | undefined): string | undefined {
  return id && VALID_MODEL_IDS.has(id) ? id : undefined;
}
