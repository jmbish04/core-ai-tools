/**
 * @fileoverview Client-side shapes for the co-creator API (`/api/cocreate/*`).
 * Dates arrive as ISO strings (JSON-serialised Drizzle timestamps).
 */

export type Proactiveness = "low" | "medium" | "high";

export interface BeliefGraph {
  entities: Array<{
    name: string;
    presence_in_prompt: boolean;
    description: string;
    attributes: Array<{ name: string; presence_in_prompt: boolean; value: string[] }>;
  }>;
  relationships: Array<{ source: string; target: string; label: string; presence_in_prompt: boolean; alternatives?: string[] }>;
}

export type GraphUpdate =
  | { type: "attribute"; entity: string; attribute: string; value: string }
  | { type: "relationship"; source: string; target: string; oldLabel: string; newLabel: string };

export interface CocreateSession {
  id: string;
  title: string;
  goal: string | null;
  currentPrompt: string;
  currentVersionId: string | null;
  beliefGraph: BeliefGraph | null;
  proactiveness: Proactiveness;
  aspectRatio: string;
  imageModel: string | null;
  referenceImageId: string | null;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface SessionListItem extends CocreateSession {
  versionCount: number;
  answeredCount: number;
  imageCount: number;
  latestImageUrl: string | null;
}

export interface PromptVersion {
  id: string;
  version: number;
  parentVersionId: string | null;
  promptText: string;
  source: "initial" | "manual" | "refine" | "consultant" | "restore";
  graphUpdates: GraphUpdate[] | null;
  note: string | null;
  createdAt: string;
}

export interface Answer {
  id: string;
  sessionId: string;
  askedInVersionId: string | null;
  appliedInVersionId: string | null;
  question: string;
  options: string[];
  answer: string | null;
  status: "pending" | "answered" | "skipped";
  sourceAnswerId: string | null;
  createdAt: string;
  answeredAt: string | null;
}

export interface Generation {
  id: string;
  promptVersionId: string;
  batchId: string;
  model: string;
  aspectRatio: string | null;
  error: string | null;
  createdAt: string;
  libraryImageId: string | null;
  deliveryUrl: string | null;
}

export interface ConsultMatch {
  consultationId: string;
  answerId: string;
  reason: string;
  howToUse: string;
  question: string;
  answer: string | null;
  fromSessionId: string;
  fromSessionTitle: string;
}

export interface Consultation {
  id: string;
  sessionId: string | null;
  goal: string;
  advice: string;
  model: string;
  candidateCount: number;
  createdAt: string;
  matches: ConsultMatch[];
}

export interface SessionDetail {
  session: CocreateSession;
  versions: PromptVersion[];
  answers: Answer[];
  generations: Generation[];
  consultations: Consultation[];
  referenceImage: { id: string; deliveryUrl: string } | null;
}

export interface Proposal {
  promptText: string;
  basePrompt: string;
  baseVersionId: string | null;
  answerIds: string[];
  graphUpdates: GraphUpdate[];
}

/** A Cloudflare Images delivery URL with its trailing variant swapped (never appended). */
export function variantOf(deliveryUrl: string, variant: "thumb" | "preview" | "full"): string {
  return deliveryUrl.replace(/\/[^/]+$/, `/${variant}`);
}

export const SOURCE_LABEL: Record<PromptVersion["source"], string> = {
  initial: "Initial",
  manual: "Manual edit",
  refine: "Refined",
  consultant: "Consultant",
  restore: "Restored",
};
