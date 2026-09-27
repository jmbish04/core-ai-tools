"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { OnBeforeDelete } from "@xyflow/react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

import type { AgentEdgeType, AgentNodeType } from "./data"

type Prompt = { open: boolean; title: string; steps: number; links: number }

const EMPTY: Prompt = { open: false, title: "", steps: 0, links: 0 }

/**
 * Every removal reaches the engine through one call, so gating that call gates
 * the toolbar, the context menu and the Backspace key together.
 */
export function useDeleteConfirmation() {
  const [prompt, setPrompt] = useState<Prompt>(EMPTY)
  const settleRef = useRef<((confirmed: boolean) => void) | null>(null)

  // Only clears `open`, so the copy survives the closing transition instead of
  // blanking mid fade. The latch makes a second call a no op.
  const settle = useCallback((confirmed: boolean) => {
    const resolve = settleRef.current

    if (!resolve) {
      return
    }

    settleRef.current = null
    setPrompt((current) => ({ ...current, open: false }))
    resolve(confirmed)
  }, [])

  useEffect(() => () => settle(false), [settle])

  const onBeforeDelete = useCallback<
    OnBeforeDelete<AgentNodeType, AgentEdgeType>
  >(
    ({ nodes, edges }) =>
      new Promise((resolve) => {
        // Wiring is redrawn by dragging a handle, so an edge goes without asking.
        if (nodes.length === 0) {
          resolve(true)
          return
        }

        settleRef.current?.(false)
        settleRef.current = resolve
        setPrompt({
          open: true,
          title: nodes[0].data.title,
          steps: nodes.length,
          links: edges.length,
        })
      }),
    []
  )

  const many = prompt.steps > 1
  const subject = many ? `${prompt.steps} steps` : prompt.title || "This step"
  const dialog = (
    <AlertDialog
      open={prompt.open}
      onOpenChange={(open) => !open && settle(false)}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {many ? "Delete Steps?" : "Delete Step?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {subject} and {prompt.links}{" "}
            {prompt.links === 1 ? "connection" : "connections"} are removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => settle(true)}>
            {many ? "Delete Steps" : "Delete Step"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { onBeforeDelete, dialog }
}