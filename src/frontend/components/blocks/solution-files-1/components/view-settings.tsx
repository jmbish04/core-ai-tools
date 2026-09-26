import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { OptionSelect } from "./option-select"
import { Settings2Icon, CheckIcon } from "lucide-react"

export type DriveDensity = "comfortable" | "compact"
export type DriveSortKey =
  "name-asc" | "name-desc" | "size-desc" | "modified-desc" | "type-asc"

/** Optional columns. `name` is always on, so it is not listed here. */
export type DriveProperty = "owner" | "type" | "size" | "modified"

export const DRIVE_PROPERTIES: { key: DriveProperty; label: string }[] = [
  { key: "owner", label: "Owner" },
  { key: "type", label: "Type" },
  { key: "size", label: "Size" },
  { key: "modified", label: "Modified" },
]

export const DENSITY_OPTIONS: { value: DriveDensity; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
]

export const SORT_OPTIONS: { value: DriveSortKey; label: string }[] = [
  { value: "name-asc", label: "Name A to Z" },
  { value: "name-desc", label: "Name Z to A" },
  { value: "size-desc", label: "Largest First" },
  { value: "modified-desc", label: "Recently Modified" },
  { value: "type-asc", label: "Type" },
]

export function ViewSettings({
  density,
  sortKey,
  visibleProperties,
  onDensityChange,
  onSortChange,
  onToggleProperty,
}: {
  density: DriveDensity
  /** "custom" appears only when a column header sorted outside the presets. */
  sortKey: DriveSortKey | "custom"
  visibleProperties: Record<DriveProperty, boolean>
  onDensityChange: (next: DriveDensity) => void
  onSortChange: (next: DriveSortKey) => void
  onToggleProperty: (property: DriveProperty) => void
}) {
  const sortItems: { value: DriveSortKey | "custom"; label: string }[] =
    sortKey === "custom"
      ? [...SORT_OPTIONS, { value: "custom", label: "Custom" }]
      : SORT_OPTIONS
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button type="button" variant="outline">
            {/* prettier-ignore */}
            <Settings2Icon className="size-4" aria-hidden="true" />
            View
          </Button>
        }
      />
      <PopoverContent align="end" className="w-[300px] p-0">
        <FieldGroup className="gap-3 px-3.5 py-3">
          <div className="flex flex-col gap-2">
            <div className="text-muted-foreground text-xs font-medium">
              Layout
            </div>
            <div className="flex flex-col gap-0">
              <Field
                orientation="horizontal"
                className="min-h-9 items-center justify-between gap-3"
              >
                <FieldLabel className="text-sm font-normal">Density</FieldLabel>
                <OptionSelect
                  value={density}
                  options={DENSITY_OPTIONS}
                  ariaLabel="Row density"
                  className="w-[140px]"
                  onChange={onDensityChange}
                />
              </Field>

              <Field
                orientation="horizontal"
                className="min-h-9 items-center justify-between gap-3"
              >
                <FieldLabel className="text-sm font-normal">Sort by</FieldLabel>
                <OptionSelect
                  value={sortKey}
                  options={sortItems}
                  ariaLabel="Sort by"
                  className="w-[140px]"
                  onChange={(next) => onSortChange(next as DriveSortKey)}
                />
              </Field>
            </div>
          </div>

          <FieldSeparator className="-mx-3.5" />

          <div className="flex flex-col gap-2.5">
            <div className="text-muted-foreground text-xs font-medium">
              Display properties
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DRIVE_PROPERTIES.map((property) => {
                const active = visibleProperties[property.key]

                return (
                  <Button
                    key={property.key}
                    type="button"
                    size="sm"
                    variant={active ? "secondary" : "outline"}
                    className={cn(
                      "rounded-full",
                      active && "border-foreground/10"
                    )}
                    aria-pressed={active}
                    onClick={() => onToggleProperty(property.key)}
                  >
                    {active ? (
                      <CheckIcon className="size-4" aria-hidden="true" />
                    ) : null}
                    {property.label}
                  </Button>
                )
              })}
            </div>
          </div>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  )
}