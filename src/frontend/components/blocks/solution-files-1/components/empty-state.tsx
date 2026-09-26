import { IconStack } from "@/components/reui/icon-stack"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { SearchIcon, FolderIcon, UploadIcon } from "lucide-react"

// Icon names must stay static literals; prettier-ignore keeps the table flat.
// prettier-ignore
const EMPTY_ICONS = {
  filtered: <SearchIcon strokeWidth="1.9" />,
  folder: <FolderIcon strokeWidth="1.9" />,
}

export function DriveEmptyState({
  filtered,
  onClearFilters,
  onUpload,
}: {
  filtered: boolean
  onClearFilters: () => void
  onUpload: () => void
}) {
  return (
    <div className="flex h-full w-full items-center justify-center px-4 py-10">
      {/* Chrome stripped: this sits inside the grid body, not on its own card. */}
      <Empty className="text-foreground max-w-md flex-none gap-6 border-0 bg-transparent p-0">
        <EmptyHeader className="items-center gap-5 text-center">
          <EmptyMedia className="mb-0">
            <IconStack aria-hidden="true">
              {filtered ? EMPTY_ICONS.filtered : EMPTY_ICONS.folder}
            </IconStack>
          </EmptyMedia>
          <EmptyTitle>{filtered ? "No Matches" : "Folder Is Empty"}</EmptyTitle>
          <EmptyDescription className="max-w-80">
            {filtered
              ? "Try a different name or clear the type filter."
              : "Upload files or move them here from another folder."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="max-w-none items-center gap-0">
          {filtered ? (
            <Button type="button" variant="outline" onClick={onClearFilters}>
              Clear Filters
            </Button>
          ) : (
            <Button type="button" onClick={onUpload}>
              {/* prettier-ignore */}
              <UploadIcon data-icon="inline-start" aria-hidden="true" />
              Upload Files
            </Button>
          )}
        </EmptyContent>
      </Empty>
    </div>
  )
}