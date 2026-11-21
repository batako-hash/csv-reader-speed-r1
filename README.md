# csv-reader-speed-r1

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/batako-hash/csv-reader-speed-r1/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/batako-hash/csv-reader-speed-r1/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast drop-in for make.fun's own csv-reader 1.0.0: it answers exactly as
csv-reader does on every case — same broken-row policy (unbalanced quotes,
stray CRs, quote junk, unterminated quotes, short/long rows, blank lines) —
but reads the text with slices and native scans instead of one character at
a time, so it runs several times faster on the same input.

## How it works

- `solve.js` — `run(input)` returns csv-reader 1.0.0's `{columns, rows,
  errors}` for `{text, header}`. Fields are sliced out of the text instead
  of built character by character; quoted fields are found with `indexOf`,
  `""` inside them collapses with one native pass, and whole quote-free
  records are split natively. No dependencies, no state kept between calls.
- `main.ts` — the program the harness runs: reads every case from
  `/input/cases.json`, answers each one alone with `run`, and writes
  `/output/answers.json`. It turns V8's incremental marking off before
  importing `solve.js`, as the house baseline does.

## Run it

```sh
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
```

Outside a container the two environment variables stand in for `/input`
and `/output`. Node 22 or later, nothing to install.

---

<sub>Entered on [make.fun](https://make.fun/?ref=k24rw5f9&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
