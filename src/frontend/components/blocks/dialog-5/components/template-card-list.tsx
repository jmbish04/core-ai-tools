"use client"

import { Badge } from "@/components/reui/badge"
import { cn } from "@/lib/utils"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"

import { TEMPLATE_LIBRARY_SURFACE, type TemplateRecord } from "./data"

interface TemplateCardListProps {
  templates: TemplateRecord[]
  selectedTemplateId: string | null
  onSelectTemplate: (templateId: string) => void
}

export function TemplateCardList({
  templates,
  selectedTemplateId,
  onSelectTemplate,
}: TemplateCardListProps) {
  return (
    <div className="flex flex-col gap-2 px-5 pb-5">
      {templates.length === 0 ? (
        <div className="flex min-h-[320px] items-center justify-center">
          <Empty className="max-w-sm gap-2 rounded-none border-0 bg-transparent p-0 text-left md:p-0">
            <EmptyHeader className="items-start gap-2 text-left">
              <EmptyTitle className="text-lg font-semibold tracking-tight">
                {TEMPLATE_LIBRARY_SURFACE.emptyTitle}
              </EmptyTitle>
              <EmptyDescription className="text-sm/relaxed">
                {TEMPLATE_LIBRARY_SURFACE.emptyDescription}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        templates.map((template) => {
          const isSelected = template.id === selectedTemplateId

          return (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelectTemplate(template.id)}
              className={cn(
                "bg-card flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                isSelected ? "bg-accent/50" : "hover:bg-accent/50"
              )}
            >
              <div className="bg-muted relative aspect-16/10 w-28 shrink-0 overflow-hidden rounded-lg border sm:w-32">
                <img
                  src={template.imageUrl}
                  alt={`${template.title} preview`}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="truncate font-bold">{template.title}</h3>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {template.description}
                    </p>
                  </div>

                  <Badge
                    size="default"
                    variant={isSelected ? "primary-light" : "outline"}
                  >
                    {template.audienceLabel}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-2">
                  {template.tags.map((tag) => (
                    <Badge
                      key={`${template.id}-${tag.label}`}
                      variant={tag.tone}
                    >
                      {tag.label}
                    </Badge>
                  ))}
                </div>
              </div>
            </button>
          )
        })
      )}
    </div>
  )
}