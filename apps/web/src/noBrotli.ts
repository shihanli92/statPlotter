// Stands in for `brotli/decompress.js` in the app's build (vite.config.ts, audit 2 P9): fontkit
// needs it only for WOFF2 fonts, and the bundled fonts are all TrueType (checked by
// test/build.test.ts), so its 88 KB decoder isn't shipped.
export default function decompress(): never {
  throw new Error('WOFF2 fonts are not supported: the bundled fonts are TrueType.')
}
