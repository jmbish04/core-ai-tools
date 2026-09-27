import { useId } from "react"

import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useIsApplePlatform } from "./canvas-toolbar"
import { SHORTCUTS } from "./data"
import { HelpCircleIcon } from "lucide-react"

/** The canvas keys in one place, since the toolbar binds more than it shows. */
export function FlowKeys() {
  const apple = useIsApplePlatform()
  const titleId = useId()
  const glyph = (key: string) =>
    key === "mod"
      ? apple
        ? "⌘"
        : "Ctrl"
      : key === "shift"
        ? apple
          ? "⇧"
          : "Shift"
        : key

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Keyboard shortcuts"
            className="max-md:hidden"
          />
        }
      >
        <HelpCircleIcon aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" aria-labelledby={titleId}>
        <PopoverHeader>
          <PopoverTitle id={titleId}>Shortcuts</PopoverTitle>
        </PopoverHeader>
        <dl className="flex flex-col gap-2">
          {SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.label}
              className="flex items-center justify-between gap-4"
            >
              <dt className="text-muted-foreground">{shortcut.label}</dt>
              <dd>
                <KbdGroup>
                  {shortcut.keys.map((key) => (
                    <Kbd key={key}>{glyph(key)}</Kbd>
                  ))}
                </KbdGroup>
              </dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  )
}