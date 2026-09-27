import { cn } from "@/lib/utils"

import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Label } from "@/components/ui/label"
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"

import { TEMPLATE_LIBRARY_SURFACE, type TemplateCategory } from "./data"

const scrollAreaScrollbarAutohide =
  "[&_[data-slot=scroll-area-scrollbar]]:opacity-0 [&_[data-slot=scroll-area-scrollbar]]:transition-opacity [&_[data-slot=scroll-area-scrollbar]]:duration-150 hover:[&_[data-slot=scroll-area-scrollbar]]:opacity-100"

const RAIL_TONE_BOX: Record<TemplateCategory["tone"], string> = {
  violet:
    "bg-violet-500/15 text-violet-600 dark:bg-violet-500/20 dark:text-violet-400",
  rose: "bg-rose-500/15 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400",
  amber:
    "bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  emerald:
    "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
  sky: "bg-sky-500/15 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
  orange:
    "bg-orange-500/15 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
  cyan: "bg-cyan-500/15 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300",
  indigo:
    "bg-indigo-500/15 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
}

interface TemplateCategoryRailProps {
  categories: TemplateCategory[]
  activeCategoryId: string
  onCategoryChange: (categoryId: string) => void
}

export function TemplateCategoryRail({
  categories,
  activeCategoryId,
  onCategoryChange,
}: TemplateCategoryRailProps) {
  return (
    <aside className="flex max-h-[min(42svh,22rem)] min-h-0 flex-col overflow-hidden border-b lg:max-h-none lg:w-72 lg:shrink-0 lg:border-r lg:border-b-0">
      <div className="px-5 pt-4 pb-3">
        <p className="text-muted-foreground text-xs font-medium">
          {TEMPLATE_LIBRARY_SURFACE.sidebarLabel}
        </p>
      </div>

      <ScrollArea
        className={cn(
          "h-full min-h-0 w-full flex-1",
          scrollAreaScrollbarAutohide
        )}
      >
        <RadioGroup
          value={activeCategoryId}
          onValueChange={onCategoryChange}
          aria-label={TEMPLATE_LIBRARY_SURFACE.sidebarLabel}
          className="flex flex-col gap-0.5 px-5 pb-3"
        >
          {categories.map((category) => {
            const isActive = category.id === activeCategoryId

            return (
              <Item
                key={category.id}
                render={<Label />}
                className={cn(
                  "w-full min-w-0 cursor-pointer flex-nowrap items-center px-0.5 py-1.5 text-left",
                  isActive ? "bg-muted/70" : "hover:bg-muted/70"
                )}
              >
                <RadioGroupItem value={category.id} className="sr-only" />

                {/* Item drops media to the top when a description is present; this rail centers the tile against both lines instead. */}
                <ItemMedia className="translate-y-0 self-center">
                  <Item
                    className={cn(
                      "size-9 items-center justify-center p-0",
                      RAIL_TONE_BOX[category.tone]
                    )}
                  >
                    {category.icon}
                  </Item>
                </ItemMedia>

                <ItemContent className="min-w-0 flex-1 gap-0.5">
                  <ItemTitle className="text-sm leading-tight font-medium">
                    {category.label}
                  </ItemTitle>
                  <ItemDescription className="text-muted-foreground mt-0.5 text-xs">
                    {category.note}
                  </ItemDescription>
                </ItemContent>
              </Item>
            )
          })}
        </RadioGroup>
      </ScrollArea>
    </aside>
  )
}