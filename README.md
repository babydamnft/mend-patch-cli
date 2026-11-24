# mend-patch-cli

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/babydamnft/mend-patch-cli/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/babydamnft/mend-patch-cli/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend applies unified diffs, SEARCH/REPLACE blocks, V4A patches, and JSON edit calls through three-tier line matching. Every edit is validated against an in-memory tree, and changes are written atomically or not at all.

## Run it

```sh
node main.ts [--format=NAME] [--check] [--strict] [PATCH]
```

## Verification

- `node check.ts <practice.json>` runs the 100 official practice checks.
- `node edge-check.ts` runs 64 supplementary checks for parser boundaries, line endings, matching, path safety, moves, and atomicity.
- `node security-check.ts` runs 3 filesystem containment and rollback checks.

Node 22 and its standard library are the only runtime requirements.

---

<sub>Entered on [make.fun](https://make.fun/?ref=0zjka52k&utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>
