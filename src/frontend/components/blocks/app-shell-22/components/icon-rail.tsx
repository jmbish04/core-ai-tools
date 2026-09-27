import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import {
  RAIL_FLEET,
  RAIL_OPERATIONS,
  RAIL_UTILITY,
  type RailRecord,
} from "./data"
import {
  GLASS_MENU,
  GLASS_MENU_GROUP,
  GLASS_MENU_ITEM,
  GLASS_MENU_ITEM_CURRENT,
  GLASS_MENU_SEPARATOR,
} from "./glass-menu"
// The demo's operator/avatar menu is gone — this app has no users. The rail's
// foot carries the theme toggle instead (~/AGENTS-frontend.md).
import { ThemeToggle } from "@/components/ThemeToggle"
import { ReuiMarkLink } from "./reui-mark"

// Committed dark ink. The design's own drop and inset, plus a blur that
// stands in for the glass refraction CSS cannot reproduce.
export const RAIL_SURFACE =
  "bg-black/40 backdrop-blur-xl shadow-[0_24px_64px_0_rgb(0_0_0/0.04),inset_0_2px_2px_0_rgb(255_255_255/0.1)]"

// Hover and the open-menu state reuse the current-item values, and only colors
// transition, so the radius snaps to a circle instead of flashing a square.
const RAIL_ACTIVE =
  "transition-colors rounded-full shadow-[inset_1px_1px_0_0_rgb(255_255_255/0.45),inset_-1px_-1px_0_0_rgb(255_255_255/0.3)] bg-white/10 text-white hover:bg-white/10 hover:text-white aria-expanded:bg-white/10 aria-expanded:text-white"
// The design lights the current item's rim from the top-left and again,
// more faintly, from the bottom-right; the other two arcs stay dark.
// Held at rounded-full: with no rest fill the radius is invisible either way,
// and animating it would flash a square as the hover fill fades out.
const RAIL_IDLE =
  "transition-colors rounded-full text-white/90 hover:shadow-[inset_1px_1px_0_0_rgb(255_255_255/0.45),inset_-1px_-1px_0_0_rgb(255_255_255/0.3)] hover:bg-white/10 hover:text-white aria-expanded:shadow-[inset_1px_1px_0_0_rgb(255_255_255/0.45),inset_-1px_-1px_0_0_rgb(255_255_255/0.3)] aria-expanded:bg-white/10 aria-expanded:text-white"

/** Any record with an `href` navigates, so it renders as a real anchor. */
function RailLink({ item, active }: { item: RailRecord; active?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            nativeButton={false}
            render={<a href={item.href ?? "#"} />}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            className={active ? RAIL_ACTIVE : RAIL_IDLE}
          />
        }
      >
        {item.icon}
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

/** Section button: sets the rail's active id and carries aria-current. */
function RailSection({
  item,
  active,
  onSelect,
}: {
  item: RailRecord
  active: boolean
  onSelect: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={item.label}
            aria-current={active ? "true" : undefined}
            onClick={onSelect}
            className={active ? RAIL_ACTIVE : RAIL_IDLE}
          />
        }
      >
        {item.icon}
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The one section that answers a click with the rail's own list instead of a
 * tooltip: the rail is a column of glyphs, so the menu names them. Set
 * `menu` on a record in data.tsx to move it to any other section.
 */
function RailSectionMenu({
  item,
  section,
  onSelect,
}: {
  item: RailRecord
  section: string
  onSelect: (id: string) => void
}) {
  // The rail already carries the glyphs, so the menu it opens only names them.
  const row = (entry: RailRecord) => (
    <DropdownMenuItem
      key={entry.id}
      aria-current={entry.id === section ? "true" : undefined}
      onClick={() => onSelect(entry.id)}
      className={
        entry.id === section ? GLASS_MENU_ITEM_CURRENT : GLASS_MENU_ITEM
      }
    >
      {entry.label}
    </DropdownMenuItem>
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={item.label}
            aria-current={item.id === section ? "true" : undefined}
            className={item.id === section ? RAIL_ACTIVE : RAIL_IDLE}
          />
        }
      >
        {item.icon}
      </DropdownMenuTrigger>
      {/* The glyph sits 8px inside the rail, so the panel clears that much to
          open on the rail's edge rather than over it. The two groups are the
          rail's own, kept apart by the rule the rail draws between them. */}
      <DropdownMenuContent
        side="right"
        align="start"
        sideOffset={8}
        className={`w-44 ${GLASS_MENU}`}
      >
        <DropdownMenuGroup className={GLASS_MENU_GROUP}>
          {RAIL_FLEET.map(row)}
        </DropdownMenuGroup>
        <DropdownMenuSeparator className={GLASS_MENU_SEPARATOR} />
        <DropdownMenuGroup className={GLASS_MENU_GROUP}>
          {RAIL_OPERATIONS.map(row)}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function IconRail({
  section,
  onSelectSection,
}: {
  section: string
  onSelectSection: (id: string) => void
}) {
  return (
    <Sidebar
      collapsible="none"
      role="navigation"
      aria-label="Workspace"
      className={`h-full w-12 shrink-0 items-center rounded-full ${RAIL_SURFACE}`}
    >
      <SidebarHeader className="w-full items-center px-2 py-3">
        <ReuiMarkLink />
      </SidebarHeader>
      {/* SidebarContent hides its scrollbar; this rail is tall enough to
          need one, so the thin bar comes back in the rail's own ink. */}
      <SidebarContent className="w-full [scrollbar-width:thin] [scrollbar-color:rgb(255_255_255/0.35)_transparent] items-center">
        <div className="flex w-full flex-col items-center gap-1.5 rounded-[calc(var(--radius-xl)+4px)] border border-white/15 py-[9px]">
          {RAIL_FLEET.map((item) =>
            item.href ? (
              <RailLink key={item.id} item={item} active={item.id === section} />
            ) : item.menu ? (
              <RailSectionMenu
                key={item.id}
                item={item}
                section={section}
                onSelect={onSelectSection}
              />
            ) : (
              <RailSection
                key={item.id}
                item={item}
                active={item.id === section}
                onSelect={() => onSelectSection(item.id)}
              />
            )
          )}
        </div>
        <div className="flex w-full flex-col items-center gap-1.5 py-2.5">
          {RAIL_OPERATIONS.map((item) => item.href ? (
            <RailLink key={item.id} item={item} active={item.id === section} />
          ) : (
            <RailSection
              key={item.id}
              item={item}
              active={item.id === section}
              onSelect={() => onSelectSection(item.id)}
            />
          ))}
        </div>
      </SidebarContent>

      <SidebarFooter className="w-full items-center gap-0 p-0">
        {/* Over the page rather than the photograph, so in dark the hairline
            drops and a faint lift keeps it the same glass as the group above. */}
        <div className="flex w-full flex-col items-center gap-1.5 rounded-[calc(var(--radius-xl)+4px)] border border-white/15 py-[9px] dark:border-white/8 dark:bg-white/2.5">
          {RAIL_UTILITY.map((item) => (
            <RailLink key={item.id} item={item} />
          ))}
        </div>
        <div className="flex w-full flex-col items-center gap-1 py-2.5">
          <ThemeToggle />
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}