import { DriveExplorer } from "./components/drive-explorer"

export function Page() {
  return (
    <main className="h-svh w-full p-4 md:p-6">
      <h1 className="sr-only">Drive Explorer</h1>
      <DriveExplorer />
    </main>
  )
}