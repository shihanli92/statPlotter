import { z } from 'zod'

// Code audit 2 (decision 657): zod parses without compiling (`jitless`). The deployed app's
// Content-Security-Policy (decisions 653, 654) has no 'unsafe-eval', so zod's `new Function`
// probe fails anyway and it parses the same way; skipping the probe keeps the browser from
// reporting a policy violation (Firefox logs it as a console error) on every page and worker.
// Every package that parses with zod depends on @ps/model, so its index sets this first.
z.config({ jitless: true })
