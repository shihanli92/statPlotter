/**
 * Delimited text files from this size on (roadmap 34e) are streamed into a table by the large
 * import dialog, never read whole. Apart from the dialog, which loads when first shown (P8).
 */
export const LARGE_CSV_BYTES = 8 * 2 ** 20
