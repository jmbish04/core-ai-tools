import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { NAV_ITEMS, type NavRecord } from "./data"
import {
  GLASS_MENU,
  GLASS_MENU_GROUP,
  GLASS_MENU_ITEM,
  GLASS_MENU_ITEM_CURRENT,
} from "./glass-menu"
import { MoreHorizontalIcon } from "lucide-react"

export function PillNav({
  current,
  onSelect,
  items = NAV_ITEMS,
}: {
  current: string
  onSelect: (id: string) => void
  /** The active section's sub-views. A page with none renders no pill. */
  items?: NavRecord[]
}) {
  if (items.length === 0) return null
  return (
    // Blur plus the two inset lines stand in for the design's glass effect.
    <nav
      aria-label="Sections"
      className="flex items-center gap-0.5 rounded-full bg-black/40 py-1 pr-2.5 pl-1 shadow-[0_24px_64px_0_rgb(0_0_0/0.04),inset_0_2px_2px_0_rgb(255_255_255/0.1)] backdrop-blur-xl"
    >
      {items.map((item) => {
        const active = item.id === current
        return (
          <Button
            key={item.id}
            type="button"
            variant="ghost"
            aria-current={active ? "page" : undefined}
            {...(item.href
              ? { nativeButton: false, render: <a href={item.href} /> }
              : { onClick: () => onSelect(item.id) })}
            // Below md only the current section stays on the pill; the rest
            // stay reachable through the overflow menu beside it.
            className={`rounded-full px-3 text-xs transition-colors ${active ? "bg-white/10 text-white shadow-[inset_1px_1px_0_0_rgb(255_255_255/0.45),inset_-1px_-1px_0_0_rgb(255_255_255/0.3)] hover:bg-white/10 hover:text-white" : "hidden text-white/70 hover:bg-white/10 hover:text-white hover:shadow-[inset_1px_1px_0_0_rgb(255_255_255/0.45),inset_-1px_-1px_0_0_rgb(255_255_255/0.3)] md:inline-flex"}`}
          >
            {item.label}
          </Button>
        )
      })}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="More sections"
              // Carries the tabs' radius and lit rim, so the control that stands
              // in for them reads as one of them.
              className="rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white hover:shadow-[inset_1px_1px_0_0_rgb(255_255_255/0.45),inset_-1px_-1px_0_0_rgb(255_255_255/0.3)] aria-expanded:bg-white/10 aria-expanded:text-white aria-expanded:shadow-[inset_1px_1px_0_0_rgb(255_255_255/0.45),inset_-1px_-1px_0_0_rgb(255_255_255/0.3)]"
            />
          }
        >
          <MoreHorizontalIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          // Measured from the trigger, which sits inside the pill's 4px
          // padding, so the panel clears the pill's own edge by a hair.
          sideOffset={5}
          className={`w-40 ${GLASS_MENU}`}
        >
          <DropdownMenuGroup className={GLASS_MENU_GROUP}>
            {items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                aria-current={item.id === current ? "page" : undefined}
                {...(item.href
                  ? { render: <a href={item.href} /> }
                  : { onClick: () => onSelect(item.id) })}
                className={
                  item.id === current
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
    </nav>
  )
}