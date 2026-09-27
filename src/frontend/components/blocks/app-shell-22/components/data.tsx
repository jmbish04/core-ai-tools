/**
 * @fileoverview Navigation + hero data for the app shell (ReUI `app-shell-22`,
 * adapted for core-ai-tools). The block shipped with a robot-fleet demo; this is
 * the same shape filled with this product's real routes.
 *
 * Navigation is URL-driven, not state-driven: every record carries an `href`, so
 * the rail and the pill nav render real anchors and a hard reload lands on the
 * same screen. The block's `onSelect` state machinery is kept for the mobile
 * drawer, which closes on selection.
 */

import type { ReactNode } from "react"
import {
  FolderTreeIcon,
  ImageIcon,
  ImagesIcon,
  GitBranchIcon,
  GitCompareArrowsIcon,
  MessageSquareIcon,
  SparklesIcon,
  CpuIcon,
  BookOpenIcon,
  SettingsIcon,
} from "lucide-react"

export type RailRecord = {
  id: string
  /** Doubles as the tooltip and the accessible name for the icon button. */
  label: string
  icon: ReactNode
  /** Route this record navigates to. Present on every record in this product. */
  href?: string
  /** Opens the rail's own sections as a menu instead of raising a tooltip. */
  menu?: boolean
}

/** Primary sections — the work itself. */
export const RAIL_FLEET: RailRecord[] = [
  {
    id: "folders",
    label: "Folders",
    href: "/folders",
    icon: <FolderTreeIcon className="size-4" aria-hidden="true" />,
  },
  {
    id: "library",
    label: "Images",
    href: "/library",
    icon: <ImageIcon className="size-4" aria-hidden="true" />,
  },
  {
    id: "assets",
    label: "Assets",
    href: "/assets",
    icon: <ImagesIcon className="size-4" aria-hidden="true" />,
  },
  {
    id: "sessions",
    label: "Sessions",
    href: "/sessions",
    icon: <GitBranchIcon className="size-4" aria-hidden="true" />,
  },
  {
    id: "compare",
    label: "Compare models",
    href: "/compare",
    icon: <GitCompareArrowsIcon className="size-4" aria-hidden="true" />,
  },
  {
    id: "new",
    label: "New project",
    href: "/projects/new",
    icon: <SparklesIcon className="size-4" aria-hidden="true" />,
  },
]

/** Secondary sections — the machinery behind the work. */
export const RAIL_OPERATIONS: RailRecord[] = [
  {
    id: "models",
    label: "Models",
    href: "/models",
    icon: <CpuIcon className="size-4" aria-hidden="true" />,
  },
  {
    id: "assistant",
    label: "Assistant",
    href: "/chat",
    icon: <MessageSquareIcon className="size-4" aria-hidden="true" />,
  },
  {
    id: "docs",
    label: "Docs",
    href: "/docs",
    icon: <BookOpenIcon className="size-4" aria-hidden="true" />,
  },
]

/** Foot of the rail. No user menu — this app has no users (see ~/AGENTS-frontend.md). */
export const RAIL_UTILITY: RailRecord[] = [
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    icon: <SettingsIcon className="size-4" aria-hidden="true" />,
  },
]

export type NavRecord = { id: string; label: string; href?: string }

/**
 * The pill nav carries the ACTIVE section's sub-views, so it is passed in per
 * page rather than fixed here. This is the fallback for a page that declares none.
 */
export const NAV_ITEMS: NavRecord[] = []

export type HeroSlide = {
  /** The file stem: each width ships as `${base}-${width}.webp`, OR a full image URL. */
  base: string
  /** The widths it ships at, smallest first; the largest is the src fallback. */
  widths: readonly number[]
  /** Where the crop holds, so content clears the nav above it. */
  position: string
  /** Set when `base` is already a complete URL (a Cloudflare Images variant). */
  exact?: boolean
}

/**
 * The band rests on the first slide and crosses through the rest. In this product
 * the caller passes the user's OWN recent images; these remain as the empty-state
 * backdrop for a workspace with nothing in it yet.
 */
export const HERO_SLIDES: HeroSlide[] = [
  {
    base: "https://reui.io/blocks/app-shell-22/hero",
    widths: [768, 1152, 1670],
    position: "center 30%",
  },
  {
    base: "https://reui.io/blocks/app-shell-22/hero-whiteboard",
    widths: [768, 1152, 1670],
    position: "center 30%",
  },
]

/** The band's design box; the img attributes follow it. */
export const HERO_VIEWBOX = { width: 1440, height: 444 }
