import type { ReactNode } from "react"
import { LayoutGridIcon, RocketIcon, BriefcaseBusinessIcon, TrendingUp, SearchIcon, UsersIcon, LifeBuoyIcon, LinkIcon } from "lucide-react"

export type CategoryRailTone =
  | "violet"
  | "rose"
  | "amber"
  | "emerald"
  | "sky"
  | "orange"
  | "cyan"
  | "indigo"

export interface TemplateCategory {
  id: string
  label: string
  note: string
  tone: CategoryRailTone
  icon: ReactNode
}

export interface TemplateTag {
  label: string
  tone:
    | "primary-light"
    | "success-light"
    | "warning-light"
    | "info-light"
    | "invert-light"
}

export interface TemplateRecord {
  id: string
  categoryId: string
  title: string
  description: string
  audienceLabel: string
  imageUrl: string
  tags: TemplateTag[]
}

export const TEMPLATE_LIBRARY_SURFACE = {
  launchLabel: "Browse starter library",
  title: "Starter library",
  description: "Choose a ready operating shape, then tailor it to your team.",
  sidebarLabel: "Use cases",
  searchPlaceholder: "Search templates, workflows, or teams...",
  emptyTitle: "No templates match",
  emptyDescription:
    "Try a broader search or switch to another collection to keep exploring.",
  secondaryActionLabel: "Build from blank",
  primaryActionLabel: "Open template",
} as const

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  {
    id: "all",
    label: "All templates",
    note: "Every starter flow",
    tone: "violet",
    icon: (
      <LayoutGridIcon className="size-4" aria-hidden="true" />
    ),
  },
  {
    id: "launch-ops",
    label: "Launch ops",
    note: "Releases and rollouts",
    tone: "rose",
    icon: (
      <RocketIcon className="size-4" aria-hidden="true" />
    ),
  },
  {
    id: "client-delivery",
    label: "Client delivery",
    note: "Projects and approvals",
    tone: "amber",
    icon: (
      <BriefcaseBusinessIcon className="size-4" aria-hidden="true" />
    ),
  },
  {
    id: "revenue-rhythm",
    label: "Revenue rhythm",
    note: "Pipeline and forecasting",
    tone: "emerald",
    icon: (
      <TrendingUp className="size-4" aria-hidden="true" />
    ),
  },
  {
    id: "research",
    label: "Research loops",
    note: "Interviews and synthesis",
    tone: "sky",
    icon: (
      <SearchIcon className="size-4" aria-hidden="true" />
    ),
  },
  {
    id: "people-programs",
    label: "People programs",
    note: "Hiring and onboarding",
    tone: "orange",
    icon: (
      <UsersIcon className="size-4" aria-hidden="true" />
    ),
  },
  {
    id: "support-systems",
    label: "Support systems",
    note: "Queues and handoffs",
    tone: "cyan",
    icon: (
      <LifeBuoyIcon className="size-4" aria-hidden="true" />
    ),
  },
  {
    id: "partner-motion",
    label: "Partner motion",
    note: "Enablement and co-sell",
    tone: "indigo",
    icon: (
      <LinkIcon className="size-4" aria-hidden="true" />
    ),
  },
]

export const TEMPLATE_RECORDS: TemplateRecord[] = [
  {
    id: "release-radar",
    categoryId: "launch-ops",
    title: "Release radar",
    description:
      "Track launch readiness, blockers, and final sign-off across one weekly control room.",
    audienceLabel: "Product teams",
    imageUrl: "https://picsum.photos/seed/release-radar/360/220",
    tags: [
      { label: "Launch", tone: "primary-light" },
      { label: "Weekly", tone: "info-light" },
      { label: "Approvals", tone: "warning-light" },
    ],
  },
  {
    id: "client-pulse-board",
    categoryId: "client-delivery",
    title: "Client pulse board",
    description:
      "Keep active engagements aligned with milestones, owners, and risk check-ins.",
    audienceLabel: "Service teams",
    imageUrl: "https://picsum.photos/seed/client-pulse-board/360/220",
    tags: [
      { label: "Delivery", tone: "success-light" },
      { label: "Milestones", tone: "info-light" },
      { label: "Risk", tone: "warning-light" },
    ],
  },
  {
    id: "forecast-bridge",
    categoryId: "revenue-rhythm",
    title: "Forecast bridge",
    description:
      "Review commit movement, late-stage changes, and coverage gaps before the number locks.",
    audienceLabel: "Revenue leaders",
    imageUrl: "https://picsum.photos/seed/forecast-bridge/360/220",
    tags: [
      { label: "Forecast", tone: "primary-light" },
      { label: "Pipeline", tone: "success-light" },
      { label: "Exec", tone: "invert-light" },
    ],
  },
  {
    id: "interview-signal-hub",
    categoryId: "research",
    title: "Interview signal hub",
    description:
      "Collect interview notes, confidence markers, and synthesis themes in one review lane.",
    audienceLabel: "Research squads",
    imageUrl: "https://picsum.photos/seed/interview-signal-hub/360/220",
    tags: [
      { label: "Research", tone: "info-light" },
      { label: "Notes", tone: "invert-light" },
      { label: "Themes", tone: "primary-light" },
    ],
  },
  {
    id: "first-30-plan",
    categoryId: "people-programs",
    title: "First 30 plan",
    description:
      "Guide new hires through setup, shadowing, and early outcome checkpoints.",
    audienceLabel: "People teams",
    imageUrl: "https://picsum.photos/seed/first-30-plan/360/220",
    tags: [
      { label: "Onboarding", tone: "success-light" },
      { label: "Tasks", tone: "info-light" },
      { label: "Manager", tone: "invert-light" },
    ],
  },
  {
    id: "escalation-watch",
    categoryId: "support-systems",
    title: "Escalation watch",
    description:
      "Surface hot customer issues, next actions, and cross-functional handoffs in one place.",
    audienceLabel: "Support leads",
    imageUrl: "https://picsum.photos/seed/escalation-watch/360/220",
    tags: [
      { label: "Support", tone: "success-light" },
      { label: "Urgent", tone: "warning-light" },
      { label: "Handoff", tone: "primary-light" },
    ],
  },
  {
    id: "partner-sprint-room",
    categoryId: "partner-motion",
    title: "Partner sprint room",
    description:
      "Coordinate shared launches, enablement tasks, and materials reviews with external partners.",
    audienceLabel: "Partnership teams",
    imageUrl: "https://picsum.photos/seed/partner-sprint-room/360/220",
    tags: [
      { label: "Partners", tone: "primary-light" },
      { label: "Assets", tone: "info-light" },
      { label: "Review", tone: "warning-light" },
    ],
  },
]