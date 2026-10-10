# Contributing to statPlotter

Thank you for helping. Bug reports, ideas and code are all welcome.

## Reporting a bug

Open an issue at <https://github.com/shihanli92/statPlotter/issues> and include:

- what you did, what you expected and what happened instead;
- the version (Help › About) and whether you used the web app or the desktop app, with your
  browser or operating system;
- if you can, a small project or data file that shows the problem. Please remove anything private
  first: issues are public.

For a wrong statistical result, say which analysis and options you used and, if you have it, the
value another program (R, for example) gives for the same data.

Security problems should not go in a public issue: see [SECURITY.md](SECURITY.md).

## Proposing a change

For anything more than a small fix, open an issue first to describe what you have in mind, so we
can agree on the approach before you spend time on it.

Pull requests are reviewed here as usual. This public repository is a published copy of the
maintainers' working repository, so an accepted pull request is not merged on GitHub: the change
is applied in the working repository and appears here with the next published version. The pull
request is then closed with a note saying so. You keep the credit: the commit carries a
`Co-authored-by:` line with your name and email as they appear on your commits.

## Before you send a pull request

You need Node.js 24 and pnpm (see the [README](README.md#building-and-running)). Then run:

```bash
pnpm check   # dependency rules, lint and format, type checks, unit tests
pnpm e2e     # end-to-end tests in Chromium, WebKit and Firefox
```

Both must pass. Install the end-to-end test browsers once with
`pnpm --filter @ps/e2e exec playwright install`.

Please also:

- **Add tests** for what you change. A fix comes with a test that fails without it.
- **Check statistics against R.** Every statistical method is compared with results computed by
  R. A new or changed statistic needs R reference cases: an R script in `tools/oracle` (run with
  `pnpm oracle`, which needs R) writes the expected results into fixtures that are committed with
  the change. Results normally agree to a relative tolerance of about 10⁻¹⁰.
- **Never loosen a tolerance to make a test pass.** If statPlotter's result disagrees with R or
  with the NIST reference values, the difference is the bug to find. Don't widen a comparison's
  tolerance or remove it; if a case genuinely can't agree that closely (an iterative method, for
  example), explain why in the test case.
- **Keep code translated from GPL sources apart.** Code translated from R's sources or other
  GPL-licensed code goes only in `packages/stats/src/gpl/`, with the source cited in the file's
  header.
- **Keep graph changes intentional.** Snapshot tests pin how every graph is drawn. Update them
  only when the drawing is meant to change, and say in the pull request which ones changed and
  why.

The design is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the document format
in [docs/DATA_MODEL.md](docs/DATA_MODEL.md).

## Code style

TypeScript in strict mode, formatted and linted by [Biome](https://biomejs.dev): single quotes,
no semicolons, lines of at most 100 characters. `pnpm format` fixes most of it; `pnpm check` tells
you about the rest. Keep comments short and about why the code is the way it is.

## Licence of contributions

statPlotter is licensed under the GNU General Public License, version 3 or later
(GPL-3.0-or-later). By contributing, you agree that your contribution is licensed under the same
licence (inbound = outbound), and you confirm that you have the right to contribute it. Code
copied or translated from elsewhere must have a licence compatible with GPL-3.0-or-later and say
where it came from.
