import { useEffect, useState } from "react"

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
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export type NamePrompt =
  | { mode: "create"; parentId: string; parentLabel: string }
  | { mode: "rename"; targetId: string; currentName: string }

export function NameDialog({
  prompt,
  onSubmit,
  onOpenChange,
}: {
  prompt: NamePrompt | null
  onSubmit: (name: string) => void
  onOpenChange: (open: boolean) => void
}) {
  const seed = prompt?.mode === "rename" ? prompt.currentName : ""
  const [name, setName] = useState(seed)

  // Re-seed whenever a different target opens the dialog.
  useEffect(() => setName(seed), [seed, prompt])

  const trimmed = name.trim()
  const isRename = prompt?.mode === "rename"

  function submit() {
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <Dialog open={prompt !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isRename ? "Rename" : "New Folder"}</DialogTitle>
          <DialogDescription>
            {prompt?.mode === "create"
              ? `Creates a folder inside ${prompt.parentLabel}.`
              : "Choose a new name for this item."}
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="drive-name">Name</FieldLabel>
          <Input
            id="drive-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit()
            }}
            placeholder="Untitled folder"
            autoComplete="off"
          />
        </Field>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={!trimmed} onClick={submit}>
            {isRename ? "Rename" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteDialog({
  targetLabel,
  open,
  onConfirm,
  onOpenChange,
}: {
  targetLabel: string
  open: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Move To Trash</AlertDialogTitle>
          <AlertDialogDescription>
            {targetLabel} and everything inside it moves to trash. You can
            restore it for 30 days.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Move To Trash
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}