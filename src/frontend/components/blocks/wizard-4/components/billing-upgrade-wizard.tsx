"use client"

import { useState, type ReactNode } from "react"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/reui/alert"
import { Badge } from "@/components/reui/badge"
import {
  Stepper,
  StepperContent,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@/components/reui/stepper"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ANNUAL_DISCOUNT_LABEL,
  ANNUAL_DISCOUNT_RATE,
  BILLING_CYCLE_OPTIONS,
  DEFAULT_BILLING_VALUES,
  MAX_BILLING_SEATS,
  PAYMENT_TERM_OPTIONS,
  PLAN_OPTIONS,
  SEAT_REASON_OPTIONS,
  SUPPORT_FEES,
  WIZARD_STEPS,
  type BillingCycle,
  type BillingOption,
  type BillingPlanId,
  type BillingValues,
  type PaymentTerm,
  type SeatReason,
} from "./data"
import { HelpCircleIcon, CalendarIcon, TriangleAlertIcon, ArrowLeftIcon, SendIcon, ArrowRightIcon } from "lucide-react"

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatBillingDate(value: string) {
  const date = new Date(`${value}T00:00:00`)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function parseBillingDate(value: string) {
  const date = new Date(`${value}T00:00:00`)

  return Number.isNaN(date.getTime()) ? undefined : date
}

function formatBillingDateValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${year}-${month}-${day}`
}

function formatDiscount(value: number) {
  if (value <= 0) {
    return formatCurrency(0)
  }

  return `-${formatCurrency(value)}`
}

function clampSeatCount(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) {
    return minimum
  }

  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}

function getOptionLabel<TValue extends string>(
  options: BillingOption<TValue>[],
  value: TValue
) {
  return options.find((option) => option.value === value)?.label ?? value
}

function BillingSelectField<TValue extends string>({
  id,
  value,
  options,
  onValueChange,
}: {
  id: string
  value: TValue
  options: BillingOption<TValue>[]
  onValueChange: (value: TValue) => void
}) {
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue) {
          onValueChange(nextValue as TValue)
        }
      }}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue>{getOptionLabel(options, value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function BillingSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby={id}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={id} className="text-base leading-6 font-semibold">
            {title}
          </h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {children}
    </section>
  )
}

function BillingSettingGroup({
  legend,
  children,
}: {
  legend: string
  children: ReactNode
}) {
  return (
    <FieldSet className="gap-0">
      <FieldLegend className="sr-only">{legend}</FieldLegend>
      <FieldGroup className="gap-0">{children}</FieldGroup>
    </FieldSet>
  )
}

function BillingSettingRow({
  title,
  description,
  children,
  labelFor,
  align = "center",
  contentClassName,
}: {
  title: string
  description?: string
  children: ReactNode
  labelFor?: string
  align?: "center" | "start"
  contentClassName?: string
}) {
  return (
    <Field
      orientation="responsive"
      className={cn(
        "gap-3 py-4 @md/field-group:gap-6",
        align === "start"
          ? "@md/field-group:has-[>[data-slot=field-content]]:items-start"
          : "@md/field-group:has-[>[data-slot=field-content]]:items-center"
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5 @md/field-group:w-[46%] @md/field-group:basis-[46%] @md/field-group:pr-5">
        {labelFor ? (
          <FieldLabel htmlFor={labelFor}>{title}</FieldLabel>
        ) : (
          <FieldTitle>{title}</FieldTitle>
        )}
        {description ? (
          <FieldDescription className="text-balance">
            {description}
          </FieldDescription>
        ) : null}
      </div>

      <FieldContent
        className={cn(
          "w-full min-w-0 @md/field-group:w-[54%] @md/field-group:basis-[54%]",
          contentClassName
        )}
      >
        {children}
      </FieldContent>
    </Field>
  )
}

function BillingSummaryRow({
  label,
  value,
  strong,
  hint,
  labelForeground,
}: {
  label: string
  value: ReactNode
  strong?: boolean
  hint?: string
  labelForeground?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <dt
        className={cn(
          "flex min-w-0 flex-col gap-0.5",
          strong || labelForeground
            ? "text-foreground"
            : "text-muted-foreground"
        )}
      >
        <span>{label}</span>
        {hint ? (
          <span className="text-muted-foreground text-xs leading-4">
            {hint}
          </span>
        ) : null}
      </dt>
      <dd
        className={cn(
          "text-foreground min-w-0 text-right break-words tabular-nums",
          strong ? "text-base font-semibold" : "font-medium"
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function BillingEmailLink({ email }: { email: string }) {
  return (
    <a
      href={`mailto:${email}`}
      className="hover:text-primary focus-visible:text-primary underline underline-offset-2 transition-colors focus-visible:outline-none"
    >
      {email}
    </a>
  )
}

function BillingAmountRow({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <Item
      variant="outline"
      className="border-foreground/20 bg-muted/35 flex-nowrap gap-3 border-dashed py-3"
    >
      <ItemContent className="gap-0.5">
        <ItemTitle className="text-foreground font-medium">{label}</ItemTitle>
        {hint ? (
          <ItemDescription className="line-clamp-none text-xs leading-4">
            {hint}
          </ItemDescription>
        ) : null}
      </ItemContent>
      <ItemActions>
        <span className="text-foreground min-w-0 text-right text-lg leading-6 font-semibold break-words tabular-nums">
          {value}
        </span>
      </ItemActions>
    </Item>
  )
}

function BillingSummarySection({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm leading-5 font-medium">{title}</h3>
        <TooltipProvider delay={180}>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex size-4 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                  aria-label={`${title} details`}
                />
              }
            >
              <HelpCircleIcon aria-hidden="true" className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="max-w-56 text-xs leading-relaxed"
            >
              {hint}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {children}
    </section>
  )
}

function BillingHeaderSummary({
  status,
  isIssued,
}: {
  status: string
  isIssued: boolean
}) {
  return (
    <Badge
      variant={isIssued ? "success-outline" : "warning-outline"}
      className="bg-background gap-1.5"
      aria-label={`Workflow status: ${status}`}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          isIssued ? "bg-success" : "bg-warning"
        )}
        aria-hidden="true"
      />
      {status}
    </Badge>
  )
}

function BillingSeatSlider({
  id,
  label,
  value,
  min,
  max,
  onValueChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  onValueChange: (value: number) => void
}) {
  return (
    <Slider
      id={id}
      aria-label={label}
      value={[value]}
      min={min}
      max={max}
      step={1}
      onValueChange={(nextValue) =>
        onValueChange(
          clampSeatCount(
            Array.isArray(nextValue) ? (nextValue[0] ?? min) : nextValue,
            min,
            max
          )
        )
      }
    />
  )
}

function BillingDatePicker({
  id,
  label,
  value,
  onValueChange,
}: {
  id: string
  label: string
  value: string
  onValueChange: (value: string) => void
}) {
  const selectedDate = parseBillingDate(value)

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            id={id}
            variant="outline"
            className="group/pick-date w-full justify-between font-normal"
            aria-label={label}
          >
            <span
              className={cn(
                "truncate",
                !selectedDate && "text-muted-foreground"
              )}
            >
              {selectedDate ? format(selectedDate, "LLL dd, y") : "Pick a date"}
            </span>
            <CalendarIcon data-icon="inline-end" aria-hidden="true" className="text-muted-foreground/80 opacity-70 transition-opacity group-hover/pick-date:opacity-100" />
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          defaultMonth={selectedDate}
          onSelect={(nextDate) => {
            if (nextDate) {
              onValueChange(formatBillingDateValue(nextDate))
            }
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function BillingCycleRadioGroup({
  value,
  onValueChange,
}: {
  value: BillingCycle
  onValueChange: (value: BillingCycle) => void
}) {
  return (
    <TooltipProvider delay={180}>
      <RadioGroup
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue) {
            onValueChange(nextValue as BillingCycle)
          }
        }}
        className="flex w-full flex-wrap gap-x-5 gap-y-3"
        aria-label="Billing cycle"
      >
        {BILLING_CYCLE_OPTIONS.map((option) => {
          const fieldId = `wizard-4-billing-cycle-${option.value}`

          return (
            <Field
              key={option.value}
              orientation="horizontal"
              className="w-auto flex-row items-center gap-2"
            >
              <RadioGroupItem value={option.value} id={fieldId} />
              <div className="flex items-center gap-1.5 leading-none">
                <FieldLabel htmlFor={fieldId} className="leading-none">
                  {option.label}
                </FieldLabel>
                {option.description ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex size-4 items-center justify-center rounded-sm p-0 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2"
                          aria-label={`${option.label} billing cycle details`}
                        />
                      }
                    >
                      <HelpCircleIcon aria-hidden="true" className="size-3.5" />
                    </TooltipTrigger>
                    <TooltipContent
                      side="right"
                      className="max-w-52 text-xs leading-relaxed"
                    >
                      {option.description}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            </Field>
          )
        })}
      </RadioGroup>
    </TooltipProvider>
  )
}

function PlanStep({
  values,
  onValueChange,
}: {
  values: BillingValues
  onValueChange: (
    field: keyof BillingValues,
    value: BillingValues[keyof BillingValues]
  ) => void
}) {
  return (
    <BillingSection
      id="billing-plan-title"
      title="Plan"
      description="Choose the tier for the seat increase."
    >
      <FieldSet className="gap-0">
        <FieldLegend className="sr-only">Available plans</FieldLegend>
        <RadioGroup
          value={values.plan}
          onValueChange={(value) =>
            onValueChange("plan", value as BillingPlanId)
          }
          aria-label="Select billing plan"
        >
          <ItemGroup className="gap-2">
            {PLAN_OPTIONS.map((plan) => {
              const fieldId = `wizard-4-plan-${plan.id}`
              const isSelected = values.plan === plan.id

              return (
                <Item
                  key={plan.id}
                  variant="outline"
                  size="sm"
                  className={cn(
                    "hover:bg-muted/50 gap-3 transition-colors",
                    isSelected && "border-primary bg-primary/5"
                  )}
                >
                  <Field
                    orientation="horizontal"
                    className="w-full flex-wrap gap-3 sm:flex-nowrap"
                  >
                    <RadioGroupItem id={fieldId} value={plan.id} />
                    <FieldLabel
                      htmlFor={fieldId}
                      className="min-w-0 flex-1 items-start"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="font-medium">{plan.label}</span>
                          {plan.badge ? (
                            <Badge variant="success-light" size="sm">
                              {plan.badge}
                            </Badge>
                          ) : null}
                        </span>
                        <span className="text-muted-foreground text-sm font-normal">
                          {plan.description}
                        </span>
                      </span>
                    </FieldLabel>
                    <span className="ml-auto shrink-0 text-right text-sm font-semibold tabular-nums">
                      {formatCurrency(plan.price)}
                      <span className="text-muted-foreground font-normal">
                        /seat/mo
                      </span>
                    </span>
                  </Field>
                </Item>
              )
            })}
          </ItemGroup>
        </RadioGroup>
      </FieldSet>
    </BillingSection>
  )
}

function SeatsStep({
  values,
  onValueChange,
}: {
  values: BillingValues
  onValueChange: (
    field: keyof BillingValues,
    value: BillingValues[keyof BillingValues]
  ) => void
}) {
  const addedSeats = Math.max(0, values.seats - values.currentSeats)

  return (
    <BillingSection
      id="billing-seats-title"
      title="Seats"
      description="Set capacity before finance review."
    >
      <BillingSettingGroup legend="Seat settings">
        <BillingSettingRow
          title="Seat count"
          description={`${values.currentSeats} current, ${addedSeats} added.`}
          contentClassName="flex flex-col gap-3"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground text-xs">
              {values.currentSeats} minimum
            </span>
            <output
              htmlFor="wizard-4-seat-count"
              className="text-sm font-semibold tabular-nums"
            >
              {values.seats} seats
            </output>
          </div>
          <BillingSeatSlider
            id="wizard-4-seat-count"
            label="Seat count"
            value={values.seats}
            min={values.currentSeats}
            max={MAX_BILLING_SEATS}
            onValueChange={(value) => onValueChange("seats", value)}
          />
        </BillingSettingRow>

        <BillingSettingRow
          title="Billing cycle"
          description="Annual keeps one approval window."
        >
          <BillingCycleRadioGroup
            value={values.billingCycle}
            onValueChange={(value) => onValueChange("billingCycle", value)}
          />
        </BillingSettingRow>
      </BillingSettingGroup>

      <div className="flex flex-col gap-3 pt-1">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Request details</h3>
          <Badge variant="outline" size="sm">
            Seat change
          </Badge>
        </div>

        <BillingSettingGroup legend="Seat request details">
          <BillingSettingRow
            title="Request owner"
            description="Receives finance follow-up."
            labelFor="wizard-4-request-owner"
          >
            <Input
              id="wizard-4-request-owner"
              type="email"
              value={values.requestOwner}
              onChange={(event) =>
                onValueChange("requestOwner", event.target.value)
              }
            />
          </BillingSettingRow>

          <BillingSettingRow
            title="Upgrade reason"
            description="Adds context for approval."
            labelFor="wizard-4-seat-reason"
          >
            <BillingSelectField<SeatReason>
              id="wizard-4-seat-reason"
              value={values.seatReason}
              options={SEAT_REASON_OPTIONS}
              onValueChange={(value) => onValueChange("seatReason", value)}
            />
          </BillingSettingRow>
        </BillingSettingGroup>
      </div>
    </BillingSection>
  )
}

function PaymentStep({
  values,
  onValueChange,
}: {
  values: BillingValues
  onValueChange: (
    field: keyof BillingValues,
    value: BillingValues[keyof BillingValues]
  ) => void
}) {
  return (
    <BillingSection
      id="billing-payment-title"
      title="Payment"
      description="Route the invoice to finance."
    >
      <BillingSettingGroup legend="Payment settings">
        <BillingSettingRow
          title="Payment method"
          description="Sets the approval path."
          labelFor="wizard-4-payment-term"
        >
          <BillingSelectField<PaymentTerm>
            id="wizard-4-payment-term"
            value={values.paymentTerm}
            options={PAYMENT_TERM_OPTIONS}
            onValueChange={(value) => onValueChange("paymentTerm", value)}
          />
        </BillingSettingRow>

        <BillingSettingRow
          title="Renewal date"
          description="Used for contract and invoice terms."
          labelFor="wizard-4-renewal-date"
        >
          <BillingDatePicker
            id="wizard-4-renewal-date"
            label="Renewal date"
            value={values.renewalDate}
            onValueChange={(value) => onValueChange("renewalDate", value)}
          />
        </BillingSettingRow>

        <BillingSettingRow
          title="Invoice email"
          description="Receives the draft invoice."
          labelFor="wizard-4-invoice-email"
        >
          <Input
            id="wizard-4-invoice-email"
            type="email"
            value={values.invoiceEmail}
            onChange={(event) =>
              onValueChange("invoiceEmail", event.target.value)
            }
          />
        </BillingSettingRow>

        <BillingSettingRow
          title="Purchase order"
          description="Shown on the invoice."
          labelFor="wizard-4-purchase-order"
        >
          <Input
            id="wizard-4-purchase-order"
            value={values.purchaseOrder}
            onChange={(event) =>
              onValueChange("purchaseOrder", event.target.value)
            }
          />
        </BillingSettingRow>
      </BillingSettingGroup>

      <Alert variant="warning">
        <TriangleAlertIcon aria-hidden="true" />
        <AlertTitle>Draft invoice</AlertTitle>
        <AlertDescription>
          One draft invoice includes the seat delta, renewal date, and PO.
        </AlertDescription>
      </Alert>
    </BillingSection>
  )
}

function ReviewStep({
  values,
  selectedPlanLabel,
}: {
  values: BillingValues
  selectedPlanLabel: string
}) {
  return (
    <BillingSection
      id="billing-review-title"
      title="Review"
      description="Check contract and finance routing."
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <dl className="flex flex-col gap-3">
          <BillingSummaryRow label="Plan" value={selectedPlanLabel} />
          <BillingSummaryRow label="Seats" value={`${values.seats} total`} />
          <BillingSummaryRow
            label="Cycle"
            value={getOptionLabel(BILLING_CYCLE_OPTIONS, values.billingCycle)}
          />
          <BillingSummaryRow
            label="Renewal"
            value={formatBillingDate(values.renewalDate)}
          />
        </dl>

        <dl className="flex flex-col gap-3">
          <BillingSummaryRow
            label="Approval"
            value={getOptionLabel(PAYMENT_TERM_OPTIONS, values.paymentTerm)}
          />
          <BillingSummaryRow
            label="Reason"
            value={getOptionLabel(SEAT_REASON_OPTIONS, values.seatReason)}
          />
          <BillingSummaryRow
            label="Owner"
            value={<BillingEmailLink email={values.requestOwner} />}
          />
          <BillingSummaryRow
            label="Invoice"
            value={<BillingEmailLink email={values.invoiceEmail} />}
          />
          <BillingSummaryRow label="PO" value={values.purchaseOrder} />
        </dl>
      </div>
    </BillingSection>
  )
}

function InvoiceSummary({
  values,
  selectedPlanLabel,
  seatSubtotal,
  annualDiscount,
  supportFee,
  dueToday,
}: {
  values: BillingValues
  selectedPlanLabel: string
  seatSubtotal: number
  annualDiscount: number
  supportFee: number
  dueToday: number
}) {
  return (
    <aside
      className="flex min-w-0 flex-col gap-5 border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
      aria-labelledby="wizard-4-summary-title"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 id="wizard-4-summary-title" className="text-sm font-semibold">
            Invoice preview
          </h2>
          <Badge variant="outline">
            {getOptionLabel(BILLING_CYCLE_OPTIONS, values.billingCycle)}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">Draft before approval.</p>
      </div>

      <BillingAmountRow
        label="Due today"
        value={formatCurrency(dueToday)}
        hint={`${selectedPlanLabel}, ${values.seats} seats, ${getOptionLabel(BILLING_CYCLE_OPTIONS, values.billingCycle).toLowerCase()}`}
      />

      <BillingSummarySection
        title="Cost breakdown"
        hint="Estimate before tax or proration."
      >
        <dl className="flex flex-col gap-2.5">
          <BillingSummaryRow
            label="Seats"
            value={formatCurrency(seatSubtotal)}
            hint={`${values.seats} seats, ${values.billingCycle === "annual" ? "annual" : "monthly"}`}
            labelForeground
          />
          <BillingSummaryRow
            label="Discount"
            value={formatDiscount(annualDiscount)}
            hint={
              values.billingCycle === "annual"
                ? `${ANNUAL_DISCOUNT_LABEL} term credit`
                : "None"
            }
            labelForeground
          />
          <BillingSummaryRow
            label="Support"
            value={formatCurrency(supportFee)}
            labelForeground
          />
        </dl>
      </BillingSummarySection>

      <BillingSummarySection
        title="Invoice routing"
        hint="Renewal and approval reference."
      >
        <dl className="flex flex-col gap-2.5">
          <BillingSummaryRow
            label="Renewal"
            value={formatBillingDate(values.renewalDate)}
            labelForeground
          />
          <BillingSummaryRow
            label="PO"
            value={values.purchaseOrder}
            labelForeground
          />
        </dl>
      </BillingSummarySection>
    </aside>
  )
}

export function BillingUpgradeWizard() {
  const [currentStep, setCurrentStep] = useState(1)
  const [isIssued, setIsIssued] = useState(false)
  const [values, setValues] = useState<BillingValues>(DEFAULT_BILLING_VALUES)

  const selectedPlan =
    PLAN_OPTIONS.find((plan) => plan.id === values.plan) ?? PLAN_OPTIONS[0]
  const monthlySubtotal = selectedPlan.price * values.seats
  const cycleMultiplier = values.billingCycle === "annual" ? 12 : 1
  const seatSubtotal = monthlySubtotal * cycleMultiplier
  const annualDiscount =
    values.billingCycle === "annual"
      ? Math.round(seatSubtotal * ANNUAL_DISCOUNT_RATE)
      : 0
  const supportFee = SUPPORT_FEES[values.plan]
  const dueToday = seatSubtotal - annualDiscount + supportFee
  const isLastStep = currentStep === WIZARD_STEPS.length
  const headerStatus = isIssued ? "Issued" : "Draft"

  const handleValueChange = (
    field: keyof BillingValues,
    value: BillingValues[keyof BillingValues]
  ) => {
    setIsIssued(false)
    setValues((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const handlePrimaryAction = () => {
    if (isLastStep) {
      setIsIssued(true)
      return
    }

    setCurrentStep((step) => Math.min(WIZARD_STEPS.length, step + 1))
  }

  return (
    <Card className="w-full max-w-4xl gap-0 p-0">
      <Stepper value={currentStep} onValueChange={setCurrentStep}>
        <CardHeader className="gap-x-4 gap-y-1 border-b px-5 py-4 sm:px-6">
          <CardTitle className="leading-5">Billing upgrade</CardTitle>
          <CardDescription className="max-w-[34rem] leading-5">
            Change plan, seats, and payment terms before renewal.
          </CardDescription>
          <CardAction className="self-center pl-3">
            <BillingHeaderSummary status={headerStatus} isIssued={isIssued} />
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-6 px-5 py-5 sm:px-6 sm:py-6">
          <div
            data-stepper-scroll
            className="overflow-x-auto overflow-y-hidden py-4"
          >
            <StepperNav
              aria-label="Billing progress"
              className="min-w-full items-start"
            >
              {WIZARD_STEPS.map((step, index) => (
                <StepperItem
                  key={step.id}
                  step={step.step}
                  className="relative min-w-0 flex-1 overflow-visible"
                >
                  <StepperTrigger
                    aria-label={step.title}
                    className="w-full min-w-0 flex-col items-center justify-start gap-2 px-0 text-center"
                  >
                    <StepperIndicator className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=completed]:border-primary data-[state=completed]:bg-primary data-[state=inactive]:border-border data-[state=inactive]:bg-background data-[state=inactive]:text-foreground data-[state=active]:before:border-primary relative isolate size-6 overflow-visible rounded-full border border-transparent before:pointer-events-none before:absolute before:inset-0 before:z-10 before:rounded-full before:border before:border-dashed before:border-transparent before:content-[''] data-[state=active]:border-0 data-[state=active]:before:animate-[spin_8s_linear_infinite] motion-reduce:data-[state=active]:before:animate-none">
                      {index + 1}
                    </StepperIndicator>
                    <span className="flex max-w-full min-w-0 flex-col items-center gap-1 text-center">
                      <StepperTitle className="max-w-full truncate">
                        {step.title}
                      </StepperTitle>
                      <span className="text-muted-foreground hidden text-xs leading-none sm:block">
                        {step.description}
                      </span>
                    </span>
                  </StepperTrigger>
                  {index < WIZARD_STEPS.length - 1 ? (
                    <StepperSeparator className="group-data-[state=completed]/step:bg-primary absolute top-3 left-[calc(50%+1.125rem)] m-0 w-[calc(100%-2.25rem)] flex-none" />
                  ) : null}
                </StepperItem>
              ))}
            </StepperNav>
          </div>

          <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <StepperPanel>
              {WIZARD_STEPS.map((step) => (
                <StepperContent
                  key={step.id}
                  value={step.step}
                  className="w-full"
                >
                  {step.id === "plan" ? (
                    <PlanStep
                      values={values}
                      onValueChange={handleValueChange}
                    />
                  ) : null}
                  {step.id === "seats" ? (
                    <SeatsStep
                      values={values}
                      onValueChange={handleValueChange}
                    />
                  ) : null}
                  {step.id === "payment" ? (
                    <PaymentStep
                      values={values}
                      onValueChange={handleValueChange}
                    />
                  ) : null}
                  {step.id === "review" ? (
                    <ReviewStep
                      values={values}
                      selectedPlanLabel={selectedPlan.label}
                    />
                  ) : null}
                </StepperContent>
              ))}
            </StepperPanel>

            <InvoiceSummary
              values={values}
              selectedPlanLabel={selectedPlan.label}
              seatSubtotal={seatSubtotal}
              annualDiscount={annualDiscount}
              supportFee={supportFee}
              dueToday={dueToday}
            />
          </div>
        </CardContent>

        <CardFooter className="justify-between gap-3 border-t px-5 py-4 sm:px-6">
          {currentStep > 1 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentStep((step) => Math.max(1, step - 1))}
            >
              <ArrowLeftIcon className="size-4" aria-hidden="true" />
              Previous
            </Button>
          ) : (
            <span className="hidden h-9 w-28 sm:block" aria-hidden="true" />
          )}

          <Button
            type="button"
            onClick={handlePrimaryAction}
            className="ml-auto"
            disabled={isLastStep && isIssued}
          >
            {isLastStep ? (isIssued ? "Issued" : "Issue draft") : "Next"}
            {isLastStep && !isIssued ? (
              <SendIcon className="size-4" aria-hidden="true" />
            ) : null}
            {!isLastStep ? (
              <ArrowRightIcon className="size-4" aria-hidden="true" />
            ) : null}
          </Button>
        </CardFooter>
      </Stepper>
    </Card>
  )
}