import { Fragment } from "react"
import { cn } from "@/lib/utils"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export interface Option<T extends string> {
  value: T
  label: string
  /** One muted line under the label, popup only. */
  description?: string
  /** Reads as a removal rather than a grant, and is ruled off from the grants. */
  destructive?: boolean
  /** Shown as the current value but not choosable. */
  disabled?: boolean
}

export function OptionSelect<T extends string>({
  value,
  options,
  ariaLabel,
  size = "sm",
  className,
  contentClassName,
  onChange,
}: {
  value: T
  options: Option<T>[]
  ariaLabel: string
  size?: "sm" | "default"
  className?: string
  /** Widen the popup past the trigger when the options carry descriptions. */
  contentClassName?: string
  onChange: (next: T) => void
}) {
  const selected = options.find((option) => option.value === value)
  const rich = options.some((option) => option.description)

  return (
    <Select
      value={value}
      onValueChange={(next) => next && onChange(next as T)}
      items={options}
    >
      <SelectTrigger
        size={size}
        aria-label={ariaLabel}
        className={cn("w-[132px] shrink-0", className)}
      >
        <SelectValue>{selected?.label ?? value}</SelectValue>
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        // The select popup ships a floor of its own (min-w-36, min-w-32 in
        // mira), which would overhang a narrower trigger, so the anchor width
        // governs both.
        className={cn("min-w-(--anchor-width)!", contentClassName)}
      >
        <SelectGroup>
          {options.map((option, index) => (
            <Fragment key={option.value}>
              {/* One rule between the grants and the taking-away */}
              {option.destructive && !options[index - 1]?.destructive ? (
                <SelectSeparator />
              ) : null}
              <SelectItem
                value={option.value}
                disabled={option.disabled}
                // The select item repaints every descendant to
                // accent-foreground on focus, guarded by
                // not-data-[variant=destructive], so the marker is what keeps a
                // destructive row red while hovered.
                data-variant={option.destructive ? "destructive" : undefined}
                className={cn(rich && "items-start")}
              >
                {/* SelectItem wraps children in an ItemText that is nowrap, and
                  the popup clips overflow-x, so the body sets its own wrap.
                  pe-6 keeps the description clear of the absolute check. */}
                <span
                  className={cn(
                    "flex min-w-0 flex-col gap-px pe-6 text-start",
                    option.destructive && "text-destructive"
                  )}
                >
                  <span className="font-medium">{option.label}</span>
                  {option.description ? (
                    <small
                      className={cn(
                        "text-xs whitespace-normal",
                        option.destructive
                          ? "text-destructive/80"
                          : "text-muted-foreground"
                      )}
                    >
                      {option.description}
                    </small>
                  ) : null}
                </span>
              </SelectItem>
            </Fragment>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}