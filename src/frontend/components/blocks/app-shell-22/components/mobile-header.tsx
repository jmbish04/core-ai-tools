"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { NAV_ITEMS, type NavRecord } from "./data"
import {
  GLASS_MENU,
  GLASS_MENU_GROUP,
  GLASS_MENU_ITEM,
  GLASS_MENU_ITEM_CURRENT,
} from "./glass-menu"
import { IconRail, RAIL_SURFACE } from "./icon-rail"
import { ReuiMark } from "./reui-mark"
import { MenuIcon, ChevronDownIcon } from "lucide-react"

// The rail's own ink, laid on its side: below lg the shell leads with a bar
// instead of a column, and the two read as one surface.
const CONTROL =
  "rounded-full text-white/90 transition-colors hover:bg-white/10 hover:text-white aria-expanded:bg-white/10 aria-expanded:text-white"

export function MobileHeader({
  railSection,
  onSelectRail,
  navSection,
  onSelectNav,
  items,
}: {
  railSection: string
  onSelectRail: (id: string) => void
  navSection: string
  onSelectNav: (id: string) => void
  /** The active section's sub-views, mirroring the desktop pill nav. */
  items?: NavRecord[]
}) {
  const [railOpen, setRailOpen] = useState(false)

  // Picking a destination in the drawer has to close it.
  const selectInDrawer = (id: string) => {
    onSelectRail(id)
    setRailOpen(false)
  }

  return (
    <header
      // Holds the top of the viewport the way the rail holds its side. The
      // 6px all round; the trailing icon adds its own inset on that side.
      className={`sticky top-3 z-10 flex items-center gap-1 rounded-full p-1.5 lg:hidden ${RAIL_SURFACE}`}
    >
      <ReuiMark />

      <span className="flex-1" />

      <Sheet open={railOpen} onOpenChange={setRailOpen}>
        <SheetTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Open workspace navigation"
              className={CONTROL}
            />
          }
        >
          <MenuIcon className="size-4" aria-hidden="true" />
        </SheetTrigger>
        {/* The rail brings its own glass, so the panel stays out of its way. */}
        <SheetContent
          side="left"
          className="w-auto border-0 bg-transparent p-3 shadow-none [&>button]:hidden"
        >
          <SheetTitle className="sr-only">Workspace</SheetTitle>
          <SheetDescription className="sr-only">
            Fleet control sections.
          </SheetDescription>
          <IconRail section={railSection} onSelectSection={selectInDrawer} />
        </SheetContent>
      </Sheet>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Open sections menu"
              className={CONTROL}
            />
          }
        >
          <ChevronDownIcon className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          // Measured from the trigger, which sits inside the header's 6px
          // padding, so the panel clears the bar by the same hair as the pill.
          sideOffset={9}
          className={`w-44 ${GLASS_MENU}`}
        >
          <DropdownMenuGroup className={GLASS_MENU_GROUP}>
            {(items ?? NAV_ITEMS).map((item) => (
              <DropdownMenuItem
                key={item.id}
                aria-current={item.id === navSection ? "page" : undefined}
                {...(item.href
                  ? { render: <a href={item.href} /> }
                  : { onClick: () => onSelectNav(item.id) })}
                className={
                  item.id === navSection
                    ? GLASS_MENU_ITEM_CURRENT
                    : GLASS_MENU_ITEM
                }
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}