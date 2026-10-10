/** A file could not be imported; the message is meant for the user. */
export class ImportError extends Error {
  override name = 'ImportError'
}
