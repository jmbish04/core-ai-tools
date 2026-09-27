import { createContext, useContext, useRef, useSyncExternalStore } from "react"

/** The block clock as an external store: the root advances it but never
    subscribes, so a tick re-renders only the leaves that draw live values. */
export type ClockStore = {
  read: () => number
  set: (value: number) => void
  subscribe: (listener: () => void) => () => void
}

export function useClockStore(): ClockStore {
  const ref = useRef<ClockStore | null>(null)
  if (!ref.current) {
    let current = 0
    const listeners = new Set<() => void>()
    ref.current = {
      read: () => current,
      set: (value) => {
        current = value
        listeners.forEach((listener) => listener())
      },
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
  }
  return ref.current
}

const ClockContext = createContext<ClockStore | null>(null)

export const ClockProvider = ClockContext.Provider

function useStore(): ClockStore {
  const store = useContext(ClockContext)
  if (!store) throw new Error("useClock needs a ClockProvider ancestor")
  return store
}

/** Full subscription: the component re-renders on every tick. */
export function useClock(): number {
  const store = useStore()
  return useSyncExternalStore(store.subscribe, store.read, store.read)
}

/** Store-direct selector for the component that OWNS the store (it sits above
    the provider): re-renders only when the selected primitive changes. */
export function useStoreSelector<T extends boolean | number | string>(
  store: ClockStore,
  select: (clock: number) => T
): T {
  const snapshot = () => select(store.read())
  return useSyncExternalStore(store.subscribe, snapshot, snapshot)
}

/** Derived subscription for primitives: re-renders only when the selected
    value changes, which is how leaves watch one fact without ticking. */
export function useClockSelector<T extends boolean | number | string>(
  select: (clock: number) => T
): T {
  return useStoreSelector(useStore(), select)
}