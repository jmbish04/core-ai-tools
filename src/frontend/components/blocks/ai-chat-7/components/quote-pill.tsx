import { useEffect, useRef, useState, type RefObject } from "react"

import { Button } from "@/components/ui/button"
import { MessageSquareTextIcon } from "lucide-react"

/** Below this much room above the selection the pill would sit outside the
    pane, so it flips under the line instead. */
const HEADROOM = 40
/** Keeps the pill's own width inside the pane at either end of a line. */
const INSET = 56
/** A one word selection is almost always an accident, not a quote. */
const MIN_QUOTE = 8

/** Static icon node: the shadcn CLI cannot resolve icon names from props. */
const ICON_QUOTE = (
  <MessageSquareTextIcon className="size-3.5 shrink-0" aria-hidden="true" />
)

type Anchor = { x: number; y: number; below: boolean; text: string }

/**
 * Select a sentence in either answer and ask both models about that line. The
 * quote carries the model that made the claim, so the follow up is unambiguous.
 */
export function QuoteReplyPill({
  host,
  modelName,
  onQuote,
}: {
  /** The pane's own positioned box, so the pill is measured inside one column. */
  host: RefObject<HTMLDivElement | null>
  modelName: string
  onQuote: (quote: string, from: string) => void
}) {
  const rangeRef = useRef<Range | null>(null)
  const [anchor, setAnchor] = useState<Anchor | null>(null)

  useEffect(() => {
    const box = host.current
    if (!box) return

    function measure(range: Range) {
      if (!box) return null
      const rect = range.getBoundingClientRect()
      const frame = box.getBoundingClientRect()
      if (!rect.width && !rect.height) return null
      if (rect.bottom < frame.top || rect.top > frame.bottom) return null
      const below = rect.top - frame.top < HEADROOM
      const limit = Math.max(INSET, frame.width - INSET)
      return {
        x: Math.min(
          Math.max(rect.left + rect.width / 2 - frame.left, INSET),
          limit
        ),
        y: (below ? rect.bottom : rect.top) - frame.top,
        below,
      }
    }

    function clear() {
      rangeRef.current = null
      setAnchor(null)
    }

    function onSelectionChange() {
      const selection = document.getSelection()
      if (!box || !selection || selection.isCollapsed) return clear()
      const node = selection.anchorNode
      const element =
        node?.nodeType === 1 ? (node as Element) : node?.parentElement
      const body = element?.closest("[data-answer-body]")
      const text = selection.toString().trim()
      // Scoped to this pane: a selection in the other column belongs to its
      // own pill, not to this one.
      if (!body || !box.contains(body) || text.length < MIN_QUOTE)
        return clear()
      rangeRef.current = selection.getRangeAt(0)
      const spot = measure(rangeRef.current)
      setAnchor(spot ? { ...spot, text } : null)
    }

    function reposition() {
      const range = rangeRef.current
      if (!range) return
      const spot = measure(range)
      setAnchor((current) => (current && spot ? { ...current, ...spot } : null))
    }

    // Scroll fires on the element that scrolled and does not bubble, so the
    // listener goes on the viewport itself, not on the wrapper around it.
    const viewport = box.querySelector("[data-slot=message-scroller-viewport]")
    document.addEventListener("selectionchange", onSelectionChange)
    viewport?.addEventListener("scroll", reposition, { passive: true })
    window.addEventListener("resize", clear)
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange)
      viewport?.removeEventListener("scroll", reposition)
      window.removeEventListener("resize", clear)
    }
  }, [host])

  if (!anchor) return null

  return (
    <Button
      size="sm"
      aria-label={`Ask both models about this line from ${modelName}`}
      onClick={() => {
        onQuote(anchor.text, modelName)
        document.getSelection()?.removeAllRanges()
      }}
      style={{ left: anchor.x, top: anchor.y }}
      className={`absolute z-10 h-7 -translate-x-1/2 gap-1.5 rounded-full px-2.5 text-xs shadow-md ${
        anchor.below ? "translate-y-2" : "-translate-y-[calc(100%+0.5rem)]"
      }`}
    >
      {ICON_QUOTE}
      Ask about this
    </Button>
  )
}