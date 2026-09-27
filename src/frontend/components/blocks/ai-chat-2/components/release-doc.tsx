import { type RefObject } from "react"
import { cn } from "@/lib/utils"

import { Skeleton } from "@/components/ui/skeleton"

import { DOC_SECTIONS, DRAFT_SECTION_ID, type DraftPayload } from "./data"

/** Line widths per section, ragged the way prose is. No copy, only shape. */
const SECTION_LINES: Record<string, string[]> = {
  highlights: ["w-full", "w-11/12", "w-2/3"],
  scim: ["w-full", "w-10/12", "w-full", "w-1/2"],
  fixes: ["w-11/12", "w-full", "w-3/4", "w-5/12"],
}

/** Fallback shape for a section the map does not name. */
const DEFAULT_LINES = ["w-full", "w-10/12", "w-2/3"]

// customize: swap this whole document for your own page. Only the section
// named by DRAFT_SECTION_ID is real, because that is the one Insert writes to.
function SectionSkeleton({ id }: { id: string }) {
  const lines = SECTION_LINES[id] ?? DEFAULT_LINES

  return (
    <div aria-hidden="true" className="flex flex-col gap-2.5 px-3 py-2">
      <Skeleton className="h-4 w-40 animate-none" />
      {lines.map((width, index) => (
        <Skeleton key={index} className={`h-3 animate-none ${width}`} />
      ))}
    </div>
  )
}

export function ReleaseDoc({
  draft,
  flash,
  draftRef,
}: {
  /** The accepted draft for the empty section, or null while it is unwritten. */
  draft: DraftPayload | null
  /** Tints the filled section for one beat so the change is impossible to miss. */
  flash: boolean
  draftRef: RefObject<HTMLElement | null>
}) {
  return (
    <article className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      {/* The page around the gap is shape only, so the one section the
          assistant is filling is the only real text on it. */}
      <header aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-5 w-28 animate-none" />
        <Skeleton className="h-7 w-72 max-w-full animate-none" />
        <Skeleton className="h-3 w-56 max-w-full animate-none" />
      </header>

      <div className="mt-8 flex flex-col gap-8">
        {DOC_SECTIONS.map((section) => {
          const isDraftTarget = section.id === DRAFT_SECTION_ID

          if (!isDraftTarget) {
            return <SectionSkeleton key={section.id} id={section.id} />
          }

          const paragraphs = draft ? draft.paragraphs : section.body
          const bullets = draft ? draft.bullets : section.bullets

          return (
            <section
              key={section.id}
              ref={draftRef}
              aria-labelledby={`${section.id}-heading`}
              className={cn(
                "-mx-3 flex scroll-mt-6 flex-col gap-2.5 px-3 py-2 transition-colors duration-300 motion-reduce:transition-none",
                flash ? "bg-primary/6" : "bg-transparent"
              )}
            >
              <h2
                id={`${section.id}-heading`}
                className="text-base font-semibold tracking-tight"
              >
                {section.heading}
              </h2>

              {paragraphs.map((paragraph, index) => (
                <p key={index} className="text-muted-foreground text-sm/6">
                  {paragraph}
                </p>
              ))}

              {bullets ? (
                <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 ps-5 text-sm/6">
                  {bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}

              {/* An unwritten section keeps its slot in the outline so the
                  document still reads as finished apart from this one gap. */}
              {section.placeholder && paragraphs.length === 0 ? (
                <p className="text-muted-foreground text-sm/6 italic">
                  {section.placeholder}
                </p>
              ) : null}
            </section>
          )
        })}
      </div>
    </article>
  )
}