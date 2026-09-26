export type BillingStepId = "plan" | "seats" | "payment" | "review"
export type BillingPlanId = "team" | "business" | "enterprise"
export type BillingCycle = "monthly" | "annual"
export type PaymentTerm = "card" | "net-30" | "invoice"
export type SeatReason = "team-growth" | "contractors" | "coverage"

export interface BillingStep {
  id: BillingStepId
  step: number
  title: string
  description: string
}

export interface BillingOption<TValue extends string = string> {
  value: TValue
  label: string
  description?: string
}

export interface BillingPlan {
  id: BillingPlanId
  label: string
  description: string
  price: number
  badge?: string
}

export interface BillingValues {
  plan: BillingPlanId
  currentSeats: number
  seats: number
  requestOwner: string
  seatReason: SeatReason
  billingCycle: BillingCycle
  paymentTerm: PaymentTerm
  invoiceEmail: string
  purchaseOrder: string
  renewalDate: string
}

export const MAX_BILLING_SEATS = 120

export const WIZARD_STEPS: BillingStep[] = [
  {
    id: "plan",
    step: 1,
    title: "Plan",
    description: "Select tier",
  },
  {
    id: "seats",
    step: 2,
    title: "Seats",
    description: "Set seats",
  },
  {
    id: "payment",
    step: 3,
    title: "Payment",
    description: "Choose terms",
  },
  {
    id: "review",
    step: 4,
    title: "Review",
    description: "Approve",
  },
]

export const PLAN_OPTIONS: BillingPlan[] = [
  {
    id: "team",
    label: "Team",
    description: "Workspace controls for growing product teams.",
    price: 49,
  },
  {
    id: "business",
    label: "Business",
    description: "SAML, audit exports, and priority support.",
    price: 72,
    badge: "Recommended",
  },
  {
    id: "enterprise",
    label: "Enterprise",
    description: "Procurement review and account governance.",
    price: 96,
  },
]

// Discount applied to the annual seat subtotal in the invoice summary.
export const ANNUAL_DISCOUNT_RATE = 0.15

// Derived from ANNUAL_DISCOUNT_RATE so rendered copy cannot drift from the math.
export const ANNUAL_DISCOUNT_LABEL = `${ANNUAL_DISCOUNT_RATE * 100}%`

// Flat support fee per plan, added to every invoice draft.
export const SUPPORT_FEES: Record<BillingPlanId, number> = {
  team: 390,
  business: 390,
  enterprise: 1200,
}

export const BILLING_CYCLE_OPTIONS: BillingOption<BillingCycle>[] = [
  {
    value: "monthly",
    label: "Monthly",
    description: "Flexible changes before each invoice.",
  },
  {
    value: "annual",
    label: "Annual",
    description: `${ANNUAL_DISCOUNT_LABEL} discount with one renewal date.`,
  },
]

export const PAYMENT_TERM_OPTIONS: BillingOption<PaymentTerm>[] = [
  {
    value: "card",
    label: "Corporate card",
    description: "Charge immediately after approval.",
  },
  {
    value: "net-30",
    label: "Net 30 invoice",
    description: "Send invoice to finance after upgrade.",
  },
  {
    value: "invoice",
    label: "Manual invoice",
    description: "Hold for procurement review.",
  },
]

export const SEAT_REASON_OPTIONS: BillingOption<SeatReason>[] = [
  {
    value: "team-growth",
    label: "Team growth",
    description: "New full-time seats for active teams.",
  },
  {
    value: "contractors",
    label: "Contractors",
    description: "Temporary access for external collaborators.",
  },
  {
    value: "coverage",
    label: "Coverage change",
    description: "Seats needed for support or operating coverage.",
  },
]

export const DEFAULT_BILLING_VALUES: BillingValues = {
  plan: "business",
  currentSeats: 30,
  seats: 42,
  requestOwner: "maya@kepler.works",
  seatReason: "team-growth",
  billingCycle: "annual",
  paymentTerm: "net-30",
  invoiceEmail: "billing@kepler.works",
  purchaseOrder: "PO-2026-184",
  renewalDate: "2026-05-31",
}