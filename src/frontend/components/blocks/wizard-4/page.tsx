import { BillingUpgradeWizard } from "./components/billing-upgrade-wizard"

export function Page() {
  return (
    <main
      className="mx-auto flex min-h-svh w-full items-center justify-center p-4 sm:p-6 lg:p-10"
      aria-labelledby="page-heading"
    >
      <h1 id="page-heading" className="sr-only">
        Billing upgrade wizard layout
      </h1>
      <BillingUpgradeWizard />
    </main>
  )
}