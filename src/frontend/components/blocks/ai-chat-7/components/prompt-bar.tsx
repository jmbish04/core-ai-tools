"use client"

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react"
import { Badge } from "@/components/reui/badge"

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  CONTEXT_FILE,
  CONTEXT_ROWS,
  EXTRA_FILES,
  RECENT_PROMPTS,
  type AttachmentRecord,
  type TurnRecord,
} from "./data"
import { Dot } from "./dot"
import { FileTextIcon, RefreshCwIcon, ArrowUpIcon, PaperclipIcon, XIcon } from "lucide-react"

/** Static icon nodes: the shadcn CLI cannot resolve icon names from props. */
const ICON_FILE = (
  <FileTextIcon className="size-3.5 shrink-0" aria-hidden="true" />
)

const ICON_RERUN = (
  <RefreshCwIcon aria-hidden="true" />
)

const ICON_SEND = (
  <ArrowUpIcon aria-hidden="true" />
)

const ICON_ATTACH = (
  <PaperclipIcon aria-hidden="true" />
)

const ICON_CANCEL = (
  <XIcon aria-hidden="true" />
)

export function PromptBar({
  busy,
  canRerun,
  showSaved,
  quote,
  onClearQuote,
  onSend,
  onRerun,
  onStop,
}: {
  busy: boolean
  /** False before the first prompt, when there is nothing to run again. */
  canRerun: boolean
  /** True on the zero state, where the recent prompts are the only way in. */
  showSaved: boolean
  /** A line pulled out of one answer; the next prompt asks about it. */
  quote: TurnRecord["quote"]
  onClearQuote: () => void
  onSend: (text: string, files: AttachmentRecord[]) => void
  onRerun: () => void
  onStop: () => void
}) {
  const [value, setValue] = useState("")
  /** Rides with the next prompt, then clears: a turn records what it read. */
  const [files, setFiles] = useState<AttachmentRecord[]>([])
  /** A prompt sent while answers stream waits its turn instead of vanishing.
      It carries its own files: they belong to that prompt, not to the box. */
  const [queued, setQueued] = useState<{
    text: string
    files: AttachmentRecord[]
  } | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  // Quoting is a request to type, so the caret follows the pill.
  useEffect(() => {
    if (quote) box.current?.focus()
  }, [quote])

  // The queue drains itself the moment both panes go quiet.
  useEffect(() => {
    if (busy || queued === null) return
    const pending = queued
    setQueued(null)
    onSend(pending.text, pending.files)
  }, [busy, queued, onSend])

  function send() {
    // The send control never disables, so an empty press puts the caret back
    // in the box rather than doing nothing at all.
    const text = value.trim()
    if (text.length === 0) {
      box.current?.focus()
      return
    }
    setValue("")
    // While answers stream the slot holds Stop, so Enter queues rather than
    // starting a second pair of runs underneath it or getting swallowed.
    if (busy) {
      setQueued({ text, files })
      setFiles([])
      return
    }
    onSend(text, files)
    setFiles([])
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    send()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter breaks the line. An IME candidate window also
    // fires Enter, and committing a word there must not post the prompt.
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    )
      return
    event.preventDefault()
    send()
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t px-3 py-3 sm:px-4">
      {/* Above the box, the way a starter list sits above a composer. Row
          grammar is ai-chat-3's: outline, full width, grows with its text. */}
      {showSaved ? (
        <div className="flex flex-col gap-1.5">
          <h2 className="text-muted-foreground text-xs font-medium">
            Recent prompts
          </h2>
          <ul className="flex flex-col gap-2">
            {RECENT_PROMPTS.map((prompt) => (
              <li key={prompt}>
                <Button
                  variant="outline"
                  onClick={() => onSend(prompt, [])}
                  className="group/prompt h-auto w-full justify-start gap-3 px-3 py-2.5 text-start font-normal whitespace-normal"
                >
                  <span className="min-w-0 flex-1 text-sm">{prompt}</span>
                  <ArrowUpIcon className="text-muted-foreground group-hover/prompt:text-foreground size-4 shrink-0 rotate-45 transition-colors" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {queued !== null ? (
        <div
          role="status"
          className="text-muted-foreground flex items-center gap-1.5 text-xs"
        >
          <Badge variant="info-light">Queued</Badge>
          <span className="min-w-0 flex-1 truncate">{queued.text}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Cancel the queued prompt"
            onClick={() => setQueued(null)}
          >
            {ICON_CANCEL}
          </Button>
        </div>
      ) : null}
      <form onSubmit={submit}>
        <FieldLabel className="sr-only" htmlFor="ai-chat-7-prompt">
          Prompt both models
        </FieldLabel>

        <InputGroup>
          {quote ? (
            <div className="flex w-full items-start gap-2 px-3 pt-3">
              <blockquote className="border-border text-muted-foreground line-clamp-2 min-w-0 flex-1 border-s-2 ps-2 text-xs italic">
                {quote.text}
              </blockquote>
              <span className="text-muted-foreground/70 shrink-0 text-[11px]">
                {quote.from}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Drop the quoted line"
                onClick={onClearQuote}
              >
                {ICON_CANCEL}
              </Button>
            </div>
          ) : null}

          {files.length ? (
            <AttachmentGroup
              aria-label="Attached files"
              // The group centres its chips otherwise: the column layout the
              // block-end addon switches on inherits items-center.
              className="w-full gap-2 px-3 pt-3"
            >
              {files.map((file) => (
                <Attachment key={file.id} size="xs" className="max-w-56">
                  <AttachmentContent>
                    <AttachmentTitle>{file.name}</AttachmentTitle>
                  </AttachmentContent>
                  <AttachmentActions>
                    <AttachmentAction
                      aria-label={`Remove ${file.name}`}
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((item) => item.id !== file.id)
                        )
                      }
                    >
                      {ICON_CANCEL}
                    </AttachmentAction>
                  </AttachmentActions>
                </Attachment>
              ))}
            </AttachmentGroup>
          ) : null}

          <InputGroupTextarea
            id="ai-chat-7-prompt"
            ref={box}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask both models about this file..."
            // Starts one line and grows with the text, capped so the panes
            // keep the screen.
            className="field-sizing-content max-h-32 min-h-10"
          />

          <InputGroupAddon align="block-end" className="gap-1">
            {/* Both panes read the same file, so the context belongs to the
                prompt rather than to either model. */}
            <span className="border-border flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
              {ICON_FILE}
              <span className="text-foreground truncate font-mono">
                {CONTEXT_FILE}
              </span>
              <Dot className="max-sm:hidden" />
              <span className="text-muted-foreground tabular-nums max-sm:hidden">
                {CONTEXT_ROWS}
              </span>
            </span>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <InputGroupButton
                    size="icon-sm"
                    className="rounded-full"
                    aria-label="Attach a file"
                  />
                }
              >
                {ICON_ATTACH}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Attach a file</DropdownMenuLabel>
                  {EXTRA_FILES.map((file) => (
                    <DropdownMenuItem
                      key={file.id}
                      // Attaching the same file twice would send it twice.
                      disabled={files.some((item) => item.id === file.id)}
                      onClick={() =>
                        setFiles((current) =>
                          current.some((item) => item.id === file.id)
                            ? current
                            : [...current, file]
                        )
                      }
                      className="items-start gap-2 py-1.5"
                    >
                      <span className="flex flex-1 flex-col">
                        <span className="truncate">{file.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {file.meta}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="ms-auto flex items-center gap-1">
              {/* Hidden rather than disabled while busy: a disabled trigger
                  also kills its tooltip. */}
              {canRerun && !busy ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton
                        size="icon-sm"
                        aria-label="Run the last prompt again"
                        onClick={onRerun}
                      />
                    }
                  >
                    {ICON_RERUN}
                  </TooltipTrigger>
                  <TooltipContent>Run again</TooltipContent>
                </Tooltip>
              ) : null}

              {/* Stop replaces send while answers arrive, so one slot always
                  holds the primary action, at primary weight. */}
              {busy ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton
                        size="icon-sm"
                        variant="default"
                        onClick={onStop}
                        aria-label="Stop generating"
                      />
                    }
                  >
                    {/* A filled square is the stop glyph everywhere, and it
                        costs no icon mapping to draw. */}
                    <span
                      aria-hidden="true"
                      className="bg-primary-foreground size-2.5 rounded-xs"
                    />
                  </TooltipTrigger>
                  <TooltipContent>Stop generating</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton
                        type="submit"
                        size="icon-sm"
                        variant="default"
                        aria-label="Send to both models"
                      />
                    }
                  >
                    {ICON_SEND}
                  </TooltipTrigger>
                  <TooltipContent className="flex items-center gap-1.5">
                    Send
                    <Kbd>Enter</Kbd>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  )
}