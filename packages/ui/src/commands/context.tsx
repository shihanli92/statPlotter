import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useSyncExternalStore,
} from 'react'
import { type Command, CommandRegistry, type CommandScope } from './registry.ts'

export const CommandsContext = createContext<CommandRegistry | null>(null)

/** The app's command registry (provided by the shell). */
export function useCommandRegistry(): CommandRegistry {
  const r = useContext(CommandsContext)
  if (!r) throw new Error('CommandsContext missing')
  return r
}

/**
 * Offers `commands` while the calling component is mounted, replacing them whenever the array
 * changes (build it with useMemo, or every render: unchanged state doesn't notify the menus).
 * The run functions registered last are the ones called.
 */
export function useCommands(scope: CommandScope, commands: readonly Command[]): void {
  const registry = useCommandRegistry()
  const owner = useId()
  useLayoutEffect(() => {
    registry.set(owner, scope, commands)
  })
  useLayoutEffect(() => () => registry.remove(owner), [registry, owner])
}

/** Re-renders when the commands on offer change; returns the registry's version. */
export function useCommandsVersion(): number {
  const registry = useCommandRegistry()
  const subscribe = useCallback((fn: () => void) => registry.subscribe(fn), [registry])
  return useSyncExternalStore(subscribe, () => registry.version)
}

/** A fresh registry for an app instance (and for tests). */
export const createCommandRegistry = () => new CommandRegistry()
