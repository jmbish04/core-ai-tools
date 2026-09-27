"use client"

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { Badge } from "@/components/reui/badge"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  ASSISTANT_NAME,
  CONTEXT_SOURCES,
  MODELS,
  type ContextSource,
} from "./data"
import { FileTextIcon, MessageSquareIcon, XIcon, PlusIcon, ChevronDownIcon, ArrowUpIcon } from "lucide-react"

/** Static icon nodes: the shadcn CLI cannot resolve icon names from props. */
const ICON_SECTION = (
  <FileTextIcon aria-hidden="true" />
)

const ICON_THREAD = (
  <MessageSquareIcon aria-hidden="true" />
)

const ICON_REMOVE = (
  <XIcon aria-hidden="true" />
)

export function Composer({
  streaming,
  modelId,
  onModelChange,
  onSend,
  onStop,
}: {
  streaming: boolean
  modelId: string
  onModelChange: (id: string) => void
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [value, setValue] = useState("")
  /** Context rides with the message it was attached to, then clears. */
  const [attached, setAttached] = useState<ContextSource[]>([])
  const canSend = value.trim().length > 0
  const box = useRef<HTMLTextAreaElement>(null)
  const activeModel = MODELS.find((model) => model.id === modelId) ?? MODELS[0]

  function send() {
    // The send control never disables, so an empty press puts the caret back
    // in the box rather than doing nothing at all.
    if (!canSend) {
      box.current?.focus()
      return
    }
    const text = value.trim()
    setValue("")
    setAttached([])
    onSend(text)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    send()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter breaks the line. An IME candidate window also
    // fires Enter, and committing a word there must not post the message.
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
    <div className="flex shrink-0 flex-col gap-2 px-3 pt-1 pb-3">
      <form onSubmit={submit}>
        <FieldLabel className="sr-only" htmlFor="ai-chat-2-composer">
          Message {ASSISTANT_NAME}
        </FieldLabel>

        <InputGroup>
          {/* Attached context rides above the text, where an editor copilot
              puts it, so the reader sees the scope before they type. */}
          {attached.length ? (
            <InputGroupAddon align="block-start" className="flex-wrap gap-1">
              {/* Outline, not filled: attached context is scope, not a status,
                  and a tint here competes with the send button. */}
              {attached.map((source) => (
                <Badge
                  key={source.id}
                  variant="outline"
                  className="text-muted-foreground min-w-0 gap-1 pe-0.5"
                >
                  {source.kind === "section" ? ICON_SECTION : ICON_THREAD}
                  <span className="max-w-40 min-w-0 truncate">
                    {source.label}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${source.label}`}
                    onClick={() =>
                      setAttached((current) =>
                        current.filter((item) => item.id !== source.id)
                      )
                    }
                    className="size-4 rounded-full [&_svg]:size-3"
                  >
                    {ICON_REMOVE}
                  </Button>
                </Badge>
              ))}
            </InputGroupAddon>
          ) : null}

          <InputGroupTextarea
            id="ai-chat-2-composer"
            ref={box}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this draft..."
            // Starts one line and grows with the text, capped so the transcript
            // never loses the panel.
            className="field-sizing-content max-h-32 min-h-10"
          />

          <InputGroupAddon align="block-end" className="gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <InputGroupButton size="icon-sm" aria-label="Add context" />
                }
              >
                <PlusIcon aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-60 [&_[data-slot=dropdown-menu-item]]:gap-3 [&_[data-slot=dropdown-menu-item]]:py-2"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Add context</DropdownMenuLabel>
                  {/* Attaching disables the source rather than listing it
                      twice; the chip above the text is the receipt. */}
                  {CONTEXT_SOURCES.map((source) => (
                    <DropdownMenuItem
                      key={source.id}
                      disabled={attached.some((item) => item.id === source.id)}
                      onClick={() =>
                        setAttached((current) => [...current, source])
                      }
                    >
                      {source.kind === "section" ? ICON_SECTION : ICON_THREAD}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{source.label}</span>
                        <span className="text-muted-foreground text-xs">
                          {source.hint}
                        </span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* The panel has no header room for a picker, so the model sits
                where the message is written, the way an editor copilot does. */}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <InputGroupButton
                    size="sm"
                    className="min-w-0 font-normal"
                    aria-label={`Model, ${activeModel.name}`}
                  />
                }
              >
                <span className="truncate">{activeModel.name}</span>
                <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64 p-0">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-muted-foreground px-2.5 pt-2.5 pb-1 text-xs font-normal">
                    Model
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuRadioGroup
                  value={modelId}
                  onValueChange={(next) => next && onModelChange(next)}
                  className="px-1.5 pb-1.5"
                >
                  {MODELS.map((model) => (
                    // Base UI defaults a radio item to closeOnClick false, so
                    // without this the menu hangs open over the composer.
                    <DropdownMenuRadioItem
                      key={model.id}
                      value={model.id}
                      closeOnClick
                      className="items-start gap-2 py-1.5"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-sm/5 font-medium">
                            {model.name}
                          </span>
                          {model.recommended ? (
                            <Badge variant="primary-light" size="sm">
                              Default
                            </Badge>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground truncate text-[11px]/4">
                          {model.provider}
                          <span
                            aria-hidden="true"
                            className="bg-muted-foreground/40 mx-1.5 inline-block size-1 rounded-full align-middle"
                          />
                          <span className="tabular-nums">{model.context}</span>{" "}
                          context
                        </span>
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Stop replaces send while a reply streams, so one slot always
                holds the primary action. */}
            <div className="ms-auto flex items-center gap-1">
              {streaming ? (
                <InputGroupButton size="sm" variant="outline" onClick={onStop}>
                  Stop
                </InputGroupButton>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton
                        type="submit"
                        size="icon-sm"
                        variant="default"
                        aria-label="Send message"
                      />
                    }
                  >
                    <ArrowUpIcon aria-hidden="true" />
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

      <p className="text-muted-foreground text-center text-[11px]">
        {ASSISTANT_NAME} can make mistakes. Check important info.
      </p>
    </div>
  )
}