import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react"

type PaneId = "a" | "b"

type ScrollSyncValue = {
  /** Callback ref: each pane's viewport registers itself as it mounts. */
  register: (id: PaneId, node: HTMLElement | null) => void
  /** Mirrors one pane onto the other by fraction, never by pixel: two answers
      of different lengths still line up at the same point in the read. */
  broadcast: (id: PaneId, node: HTMLElement) => void
}

const ScrollSyncContext = createContext<ScrollSyncValue | null>(null)

/**
 * Locks the two transcripts together. Comparing two answers means reading them
 * at the same depth, and two independent scrollbars make that manual work.
 */
export function ScrollSyncProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const panes = useRef<Record<PaneId, HTMLElement | null>>({ a: null, b: null })
  /** Set while a mirrored scroll is being written, so the echo cannot bounce. */
  const echoing = useRef(false)
  /** Read inside the scroll callback, so flipping the lock never rebuilds it
      and re-registers both viewports. */
  const on = useRef(enabled)
  useEffect(() => {
    on.current = enabled
  }, [enabled])

  const register = useCallback((id: PaneId, node: HTMLElement | null) => {
    panes.current[id] = node
  }, [])

  const broadcast = useCallback((id: PaneId, node: HTMLElement) => {
    if (!on.current || echoing.current) return
    const other = panes.current[id === "a" ? "b" : "a"]
    if (!other || other === node) return

    const room = node.scrollHeight - node.clientHeight
    const otherRoom = other.scrollHeight - other.clientHeight
    if (room <= 0 || otherRoom <= 0) return

    echoing.current = true
    other.scrollTop = (node.scrollTop / room) * otherRoom
    // The mirrored write fires its own scroll event; clearing on the next task
    // lets that one through and stops the two panes driving each other.
    window.setTimeout(() => {
      echoing.current = false
    }, 0)
  }, [])

  const value = useMemo(() => ({ register, broadcast }), [register, broadcast])

  return (
    <ScrollSyncContext.Provider value={value}>
      {children}
    </ScrollSyncContext.Provider>
  )
}

export function useScrollSync() {
  return useContext(ScrollSyncContext)
}