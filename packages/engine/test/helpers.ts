import type { Project } from '@ps/model'
import {
  type AnalysisRegistry,
  ComputeEngine,
  DocumentStore,
  inlineRunner,
  type JobRunner,
} from '../src/index.ts'

// Shared by the engine and ui tests (ui imports this file by path; check-deps scans src only).

/** A compute engine on `doc` (a store, or a project to wrap in one), started and idle. */
export async function startedEngine(
  doc: DocumentStore | Project,
  registry: AnalysisRegistry,
  runner: JobRunner = inlineRunner(registry),
): Promise<ComputeEngine> {
  const store = 'getState' in doc ? doc : new DocumentStore(doc)
  const engine = new ComputeEngine(store, registry, runner)
  engine.start()
  await engine.idle()
  return engine
}
