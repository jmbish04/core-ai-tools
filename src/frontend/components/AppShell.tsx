/**
 * @fileoverview The application shell — ReUI `app-shell-22`, adapted.
 *
 * Adapted, not rebuilt: the rail, the glass pill nav, the mobile drawer and the
 * hero band are the block's own components and keep the block's styling. What
 * changed is what they are fed — this product's routes instead of the shipped
 * robot-fleet demo — and that the block's page body is now `children`, so every
 * Astro route renders inside it.
 *
 * Removed from the demo, per `~/AGENTS-frontend.md`: the access-request toast
 * (a canned demo event) and the operator/avatar menu (this app has no users).
 *
 * Navigation is URL-driven. The rail marks the current section from `section`,
 * and `subnav` fills the pill with the section's own sub-views; a page that
 * declares none renders no pill at all.
 */

import { useState } from "react"

import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

import { HeroBand } from "./blocks/app-shell-22/components/hero-band"
import { IconRail } from "./blocks/app-shell-22/components/icon-rail"
import { MobileHeader } from "./blocks/app-shell-22/components/mobile-header"
import { PillNav } from "./blocks/app-shell-22/components/pill-nav"
import type {
  HeroSlide,
  NavRecord,
} from "./blocks/app-shell-22/components/data"

export interface AppShellProps {
  /** Rail section id for the current route — `folders`, `assets`, `compare`, … */
  section?: string
  /** The current section's sub-views, rendered in the pill nav. */
  subnav?: NavRecord[]
  /** Active sub-view id within `subnav`. */
  subnavCurrent?: string
  /**
   * Pictures for the hero band. Pass the user's own images (Cloudflare Images
   * variant URLs with `exact: true`); omit for the stock backdrop.
   */
  hero?: HeroSlide[]
  /** Accessible page title. Rendered for screen readers, not drawn. */
  title?: string
  children?: React.ReactNode
}

/**
 * Render a page inside the shell.
 *
 * @param props.section Rail section to mark current.
 * @param props.subnav  Sub-views for the pill nav (optional).
 * @param props.hero    Hero band pictures (optional).
 * @param props.title   Accessible page title.
 * @returns The shell with `children` as the page body.
 * @example <AppShell section="folders" title="Folders">{page}</AppShell>
 */
export function AppShell({
  section = "folders",
  subnav = [],
  subnavCurrent = "",
  hero,
  title = "Workspace",
  children,
}: AppShellProps) {
  const hasHero = (hero?.length ?? 0) > 0;

  // The rail and pill are anchors, so the current section comes from the route.
  // These remain only for the mobile drawer, which closes on selection.
  const [railSection, setRailSection] = useState(section)
  const [navSection, setNavSection] = useState(subnavCurrent)

  return (
    <TooltipProvider>
      <SidebarProvider className="bg-muted text-foreground relative overflow-clip">
        <HeroBand slides={hero} />

        <h1 className="sr-only">{title}</h1>

        <div className="relative flex w-full gap-3 p-3">
          {/* The rail holds the viewport while the page body scrolls past it,
              and below lg it hands over to the header's drawer. */}
          <div className="sticky top-3 hidden h-[calc(100svh-24px)] shrink-0 self-start lg:block">
            <IconRail section={railSection} onSelectSection={setRailSection} />
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <MobileHeader
              railSection={railSection}
              onSelectRail={setRailSection}
              navSection={navSection}
              onSelectNav={setNavSection}
              items={subnav}
            />

            {/* Centred on the span that starts where the rail ends, which is
                half the rail's own gap left of the column's centre. */}
            <div className="hidden -translate-x-1.5 flex-col items-center lg:flex">
              <PillNav
                current={navSection}
                onSelect={setNavSection}
                items={subnav}
              />
            </div>

            {/* With a band, each margin is its hero-band.tsx height minus 184, so
                the body lands on the dissolve. With no band there is nothing to
                clear, and that clearance would just be a hole at the top. */}
            <main
              className={
                hasHero
                  ? "mt-[196px] min-w-0 sm:mt-[236px] lg:mt-[260px]"
                  : "mt-3 min-w-0"
              }
            >
              {children}
            </main>
          </div>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  )
}
