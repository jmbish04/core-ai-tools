"use client"

import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_LIBRARY_SURFACE,
  TEMPLATE_RECORDS,
} from "./data"
import { TemplateCardList } from "./template-card-list"
import { TemplateCategoryRail } from "./template-category-rail"

export function TemplateLibraryDialog() {
  const [open, setOpen] = useState(true)
  const [activeCategoryId, setActiveCategoryId] = useState("all")
  const [searchValue, setSearchValue] = useState("")
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    TEMPLATE_RECORDS[0]?.id ?? ""
  )

  const searchQuery = searchValue.trim().toLowerCase()

  const visibleTemplates = useMemo(() => {
    return TEMPLATE_RECORDS.filter((template) => {
      const matchesCategory =
        activeCategoryId === "all" || template.categoryId === activeCategoryId

      if (!matchesCategory) return false
      if (!searchQuery) return true

      const haystack = [
        template.title,
        template.description,
        template.audienceLabel,
        ...template.tags.map((tag) => tag.label),
      ]
        .join(" ")
        .toLowerCase()

      return haystack.includes(searchQuery)
    })
  }, [activeCategoryId, searchQuery])

  const resolvedSelectedTemplate =
    visibleTemplates.find((template) => template.id === selectedTemplateId) ??
    visibleTemplates[0] ??
    null

  const summaryCountLabel = `${visibleTemplates.length} ready`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Actions */}
      <div className="flex min-h-[360px] items-center justify-center">
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => setOpen(true)}
        >
          {TEMPLATE_LIBRARY_SURFACE.launchLabel}
        </Button>
      </div>

      {/* Content */}
      <DialogContent className="flex h-[min(86vh,48rem)] max-w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl lg:max-w-[64rem]">
        <DialogHeader className="shrink-0 gap-1 px-5 pt-4 pb-3 text-left">
          <DialogTitle>{TEMPLATE_LIBRARY_SURFACE.title}</DialogTitle>
          <DialogDescription>
            {TEMPLATE_LIBRARY_SURFACE.description}
          </DialogDescription>
        </DialogHeader>

        <Separator className="shrink-0" />

        <div className="grid min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <TemplateCategoryRail
              categories={TEMPLATE_CATEGORIES}
              activeCategoryId={activeCategoryId}
              onCategoryChange={setActiveCategoryId}
            />

            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
              <div className="shrink-0 px-5 pt-5">
                <Input
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder={TEMPLATE_LIBRARY_SURFACE.searchPlaceholder}
                  autoComplete="off"
                />
              </div>

              <ScrollArea
                className={cn(
                  "min-h-0 flex-1",
                  "[&_[data-slot=scroll-area-scrollbar]]:opacity-0 [&_[data-slot=scroll-area-scrollbar]]:transition-opacity [&_[data-slot=scroll-area-scrollbar]]:duration-150 hover:[&_[data-slot=scroll-area-scrollbar]]:opacity-100"
                )}
              >
                <TemplateCardList
                  templates={visibleTemplates}
                  selectedTemplateId={resolvedSelectedTemplate?.id ?? null}
                  onSelectTemplate={setSelectedTemplateId}
                />
              </ScrollArea>
            </div>
          </div>
        </div>

        <DialogFooter className="my-auto flex-row items-center justify-between border-t px-9 py-4">
          <span className="text-muted-foreground flex min-w-0 flex-1 items-center gap-2 text-sm">
            <span className="shrink-0 whitespace-nowrap">
              {summaryCountLabel}
            </span>
            {resolvedSelectedTemplate ? (
              <>
                <span
                  aria-hidden
                  className="size-1 shrink-0 rounded-full bg-gray-300"
                />
                <span className="min-w-0 truncate">
                  {resolvedSelectedTemplate.title}
                </span>
              </>
            ) : null}
          </span>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline">
              {TEMPLATE_LIBRARY_SURFACE.secondaryActionLabel}
            </Button>
            <Button type="button" disabled={!resolvedSelectedTemplate}>
              {TEMPLATE_LIBRARY_SURFACE.primaryActionLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}