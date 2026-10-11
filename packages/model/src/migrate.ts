import { type MigrationNote, v1to2 } from './migrations/v1to2.ts'
import { v2to3 } from './migrations/v2to3.ts'
import { CURRENT_SCHEMA_VERSION, Project } from './project.ts'
import { repairProject } from './repairs.ts'

type RawProject = Record<string, unknown>
/** One step: the raw document of version n made version n + 1; notes on what changed. */
type Migration = (raw: RawProject, notes: MigrationNote[]) => RawProject

/**
 * Keyed by the version migrated *from*: MIGRATIONS[1] turns a v1 file into v2. Migrations operate
 * on raw JSON before validation, and must never be edited once released.
 */
const MIGRATIONS: Record<number, Migration> = {
  /** Roadmap 33b: graphs as a frame plus layers (`compileV1`). */
  1: v1to2,
  /** Roadmap 49c: a heat map's dendrograms as layers of their own (`treesAsLayers`). */
  2: v2to3,
}

export class UnsupportedVersionError extends Error {
  constructor(readonly version: unknown) {
    super(
      typeof version === 'number' && version > CURRENT_SCHEMA_VERSION
        ? `This project was saved by a newer version of the app (file format v${version}; this version reads up to v${CURRENT_SCHEMA_VERSION}). Open it in the newer version.`
        : `Unrecognized project format version: ${String(version)}`,
    )
  }
}

/**
 * The document brought to the current schema version (raw JSON, not yet validated). `notes`
 * collects what the migrations changed or could only approximate (shown once after opening).
 */
export function migrateProject(raw: unknown, notes: MigrationNote[] = []): RawProject {
  if (typeof raw !== 'object' || raw === null) throw new UnsupportedVersionError(undefined)
  let doc = raw as RawProject
  let version = doc.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new UnsupportedVersionError(version)
  }
  if (version > CURRENT_SCHEMA_VERSION) throw new UnsupportedVersionError(version)

  while (version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) throw new Error(`Missing migration from schema v${version}`)
    doc = step(doc, notes)
    version += 1
    doc = { ...doc, schemaVersion: version }
  }
  return doc
}

/**
 * Migrate then validate, then repair what earlier versions wrote wrongly (`repairs.ts`). Throws
 * ZodError on invalid content.
 */
export function parseProject(raw: unknown, notes?: MigrationNote[]): Project {
  return repairProject(Project.parse(migrateProject(raw, notes)))
}
