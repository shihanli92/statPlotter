// The app's stylesheet, a side effect: package.json's `sideEffects` names this index and CSS
// files so a bundle keeps it (audit 2 P2; apps/web/test/build.test.ts).
import './styles.css'

export { METHOD_EXTENSION } from '@ps/engine'
export { App } from './App.tsx'
export {
  isMacPlatform,
  type MenuModel,
  type NativeItem,
  type NativeMenu,
  nativeCommandItems,
  nativeMenuSpec,
  nativeStructureKey,
} from './commands/index.ts'
export type { ClipboardFormat } from './graph/copyGraph.ts'
export { pageLeaving } from './pageLeaving.ts'
export { addRecent, MAX_RECENT, parseRecentPaths, type RecentFile } from './recent.ts'
export {
  folderRecoveryStorage,
  parseRecoveryRecord,
  type RecoveryFolder,
  type RecoveryRecord,
  type RecoverySlot,
  type RecoveryStorage,
} from './recovery.ts'
export {
  folderLibrary,
  type LibraryFolder,
  memoryLibrary,
  resilientLibrary,
} from './reuse/library.ts'
export {
  type AppServices,
  createServices,
  type ExportData,
  type ExportFolder,
  type Library,
  type LibraryEntry,
  type OpenedFiles,
  type Platform,
  type RecentFiles,
} from './services.ts'
export { applyColorScheme, initialColorScheme } from './theme/colorScheme.ts'
export type { AvailableUpdate, Updates } from './updates/updates.ts'
export { createWorkerRunner } from './worker/runner.ts'
