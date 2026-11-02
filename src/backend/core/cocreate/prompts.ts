/**
 * @fileoverview Pure instruction builders for the co-creator, ported from the
 * "Proactive Co-Creator" demo (`docs/proactive-co-creator/services/geminiService.ts`)
 * and narrowed to image mode — this product makes and edits images.
 *
 * The demo enforced output shape with Gemini `responseSchema`. Our understand
 * path returns text (parsed to JSON when it is JSON), so each builder states the
 * exact JSON shape in the instruction and `ai.ts` validates it with zod.
 *
 * Everything here is pure: no env, no I/O, so it is unit-testable.
 */

import type { GraphUpdate } from "@/backend/db/schema";

export type Proactiveness = "low" | "medium" | "high";

const GRAPH_RULES: Record<Proactiveness, { stance: string; implicit: string; infer: string; relations: string }> = {
  low: {
    stance: "STRICT MODE: Only extract entities and attributes explicitly mentioned. Do not invent details.",
    implicit: "Do NOT add implicit entities.",
    infer: "Do NOT infer values for unmentioned attributes; use 'unspecified' when required.",
    relations: "Only include relationships explicitly stated.",
  },
  medium: {
    stance: "BALANCED MODE: Extract explicit entities and attributes, and infer reasonable defaults for missing critical attributes (lighting, camera angle).",
    implicit: "You may add 1-2 implicit entities that obviously belong in the scene.",
    infer: "If a mandatory attribute is not mentioned, infer a reasonable default. Reflect global diversity; do not default to Western norms.",
    relations: "Infer obvious missing connections (basic spatial relationships).",
  },
  high: {
    stance: "CREATIVE MODE: Be highly proactive. Invent specific, creative attributes and atmospheric detail.",
    implicit: "Add at least 3 creative implicit entities worth considering.",
    infer: "You MUST infer a plausible, specific value for every mandatory attribute. Do not default to Western norms.",
    relations: "Imagine spatial, emotional and functional relationships when none are stated.",
  },
};

const GRAPH_SHAPE = `{"entities":[{"name":string,"presence_in_prompt":boolean,"description":string,"attributes":[{"name":string,"presence_in_prompt":boolean,"value":[string,...]}]}],"relationships":[{"source":string,"target":string,"label":string,"presence_in_prompt":boolean,"alternatives":[string,...]}]}`;

/**
 * Instruction that maps a prompt (and optional reference image) to a belief graph.
 *
 * @param prompt The user's current prompt.
 * @param proactiveness How much the model may infer.
 * @param hasReference Whether a reference image is attached.
 * @returns The full instruction text.
 */
export function beliefGraphInstruction(prompt: string, proactiveness: Proactiveness, hasReference: boolean): string {
  const r = GRAPH_RULES[proactiveness];
  return `Analyze the prompt${hasReference ? " and the attached reference image" : ""} and produce a Belief Graph: every entity in the image, its detailed attributes, and the relationships between entities.
${hasReference ? "TREAT THE IMAGE AS THE SOURCE OF TRUTH for the current scene; use the text to identify intended changes." : ""}
${r.stance}

ENTITY RULES
1. Identify core entities (objects, characters, setting).
2. Do NOT extract entities the prompt says are absent ("no tables", "without sunlight").
3. ${r.implicit}
4. presence_in_prompt = true when the prompt states the entity, false when you inferred it.
5. Always include an entity named "The Image" with attributes: weather, location, time of day, atmosphere, camera angle, image style.

ATTRIBUTE RULES
1. Every entity has an attribute "existence" with value ["true"].
2. No meta-attributes (presence, explicit, implicit, mentioned).
3. Humans: race/ethnicity, skin_tone, gender, age, hair_style, clothing_style, facial_expression.
   Animals: specific_breed, coat_color/pattern, age_stage, size, temperament.
   Objects: material, primary_color, condition, size, texture, cultural_origin.
   Locations: lighting_type, architectural_style, geographic_region.
4. ${r.infer}
5. "value" lists 2-3 candidates; the FIRST is the current/most likely one. Keep values short.

RELATIONSHIP RULES
1. ${r.relations}
2. presence_in_prompt = true when stated, false when inferred.
3. Do not leave interacting entities unconnected.

Return ONLY JSON, no prose, exactly this shape:
${GRAPH_SHAPE}

Prompt: "${prompt}"`;
}

const QUESTION_STANCE: Record<Proactiveness, string> = {
  low: "STRICT MODE: only ask about attributes of entities the prompt mentions, or of the image itself. Do not suggest creative additions.",
  medium: "BALANCED MODE: ask about missing technical details and offer a few creative options that stay close to the intent.",
  high: "CREATIVE MODE: be proactive; suggest bold additions, unexpected twists and distinctive styles.",
};

/**
 * Instruction that asks for exactly three clarifying questions.
 *
 * @param prompt The user's current prompt.
 * @param asked Questions already asked in this session (never repeated).
 * @param proactiveness How adventurous the options may be.
 * @param hasReference Whether a reference image is attached.
 * @returns The full instruction text.
 */
export function clarificationInstruction(
  prompt: string,
  asked: string[],
  proactiveness: Proactiveness,
  hasReference: boolean,
): string {
  return `You are an expert in text-to-image prompting. Help the user refine their prompt by asking clarifying questions.
${hasReference ? "A reference image is attached: do NOT ask about details clearly visible in it; ask about the INTENT behind changes the text implies." : "Find the ambiguities in the prompt."}

1. Ask the 3 questions that will most change the final image — what an image model would otherwise guess (hallucinate).
2. ONE topic per question, short and easy to read. Never "the lighting and the background".
3. Users are global; do not assume Western norms. Ask about cultural context when ambiguous.
4. Mix topics (subject, mood, style) — not three about lighting.
5. NEVER ask about aspect ratio or resolution.
6. Give 3-5 diverse options per question.
${QUESTION_STANCE[proactiveness]}

Do NOT ask any of these again:
${asked.map((q) => `- "${q}"`).join("\n") || "N/A"}

Return ONLY JSON, no prose: [{"question":string,"options":[string,...]}, ...] with EXACTLY 3 items.

User prompt: "${prompt}"`;
}

const REFINE_STANCE: Record<Proactiveness, string> = {
  low: "STRICT MODE: apply only the exact edits requested; change nothing else.",
  medium: "BALANCED MODE: apply the edits smoothly; adjust wording for flow but add no unrequested details.",
  high: "CREATIVE MODE: apply every edit and you may enrich the language, but never drop a requested edit.",
};

/**
 * Describe one graph edit as an instruction line.
 *
 * @param u The edit.
 * @returns One "- ..." line.
 */
export function describeGraphUpdate(u: GraphUpdate): string {
  if (u.type === "relationship") {
    return `- Change the relationship between "${u.source}" and "${u.target}" from "${u.oldLabel}" to "${u.newLabel}".`;
  }
  if (u.attribute.toLowerCase().startsWith("existence")) {
    return u.value === "false"
      ? `- REMOVE "${u.entity}" from the prompt entirely, or state it is not present.`
      : `- ENSURE "${u.entity}" is explicitly mentioned.`;
  }
  return `- For "${u.entity}", set "${u.attribute}" to "${u.value}".`;
}

/**
 * Instruction that rewrites the prompt to absorb answers and graph edits.
 *
 * @param original The current prompt.
 * @param qa Answered questions to fold in.
 * @param updates Belief-graph edits to fold in.
 * @param proactiveness How freely the wording may change.
 * @returns The full instruction text.
 */
export function refineInstruction(
  original: string,
  qa: Array<{ question: string; answer: string }>,
  updates: GraphUpdate[],
  proactiveness: Proactiveness,
): string {
  const edits = updates.length ? `\nSPECIFIC EDITS TO APPLY:\n${updates.map(describeGraphUpdate).join("\n")}\n` : "";
  const answers = qa.length
    ? `\nNEW INFORMATION FROM Q&A:\n${qa.map((c) => `- Answer to "${c.question}": "${c.answer}"`).join("\n")}\n`
    : "";
  return `Rewrite the image prompt to incorporate the user's edits while strictly preserving every other existing detail.

Original prompt: "${original}"
${edits}${answers}
RULES
1. Produce one cohesive, descriptive prompt.
2. Preserve every detail of the original that the edits do not change.
3. Add no unrequested details, unless an answer says "[YOU DECIDE]".
4. If an edit removes an entity, remove every reference to it.
5. An answer of "[NOT RELEVANT]" means leave that topic out.
6. Output ONLY the prompt text: no labels like "Refined Prompt:", no intro, no markdown.
${REFINE_STANCE[proactiveness]}`;
}

/** Strip the labels models add despite being told not to. */
export function cleanRefinedPrompt(text: string): string {
  return text
    .trim()
    .replace(/^```[a-z]*\n?|\n?```$/g, "")
    .replace(/^[\s*_]*(updated|refined|final|new)?\s*prompt\s*[:-]+[\s*_]*/i, "")
    .replace(/^"(.*)"$/s, "$1")
    .trim();
}

export interface ConsultCandidate {
  id: string;
  sessionTitle: string;
  question: string;
  answer: string;
}

/**
 * Instruction for the consultant: pick past answers relevant to a goal and
 * explain how to use them.
 *
 * @param goal What the user wants to make.
 * @param currentPrompt Their current prompt, if a session exists.
 * @param candidates Answered questions from other sessions.
 * @returns The full instruction text.
 */
export function consultInstruction(goal: string, currentPrompt: string | null, candidates: ConsultCandidate[]): string {
  const list = candidates
    .map((c) => `${c.id} | session "${c.sessionTitle}" | Q: ${c.question} | A: ${c.answer}`)
    .join("\n");
  return `You are an image-prompt consultant. A user is trying to get an AI image model to produce what they actually want, not what the model guesses or hallucinates.

User goal: "${goal}"
${currentPrompt ? `Their current prompt: "${currentPrompt}"` : "They have not written a prompt yet."}

Below are clarifying questions they answered in OTHER sessions (id | session | question | answer). These are decisions they already made about their taste and intent.
${list || "(none)"}

1. Pick the answers that are genuinely relevant to this goal (0-8). Prefer decisions that remove ambiguity an image model would otherwise fill in: style, lighting, materials, camera, cultural context, what must NOT appear.
2. For each, say why it is relevant and exactly how to use it (the phrase to add to the prompt, or the question to answer the same way).
3. Then give concise advice (markdown, at most 8 bullets) on how to steer the model: what to state explicitly, what to exclude, which details are still ambiguous and worth answering, and how to use a reference image if they have one.
Only cite ids from the list. Never invent ids.

Return ONLY JSON, no prose: {"advice":string,"matches":[{"answerId":string,"reason":string,"howToUse":string}]}`;
}
