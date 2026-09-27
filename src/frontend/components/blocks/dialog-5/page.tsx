import { TemplateLibraryDialog } from "./components/template-library-dialog"

export function Page() {
  return (
    <main
      className="flex min-h-svh w-full items-center justify-center p-6 sm:p-10 md:p-12"
      aria-labelledby="page-heading"
    >
      <h1 id="page-heading" className="sr-only">
        Starter library dialog
      </h1>
      <TemplateLibraryDialog />
    </main>
  )
}