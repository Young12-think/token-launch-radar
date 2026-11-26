# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Young12-think/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Young12-think/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for token launches that have not happened yet. It reads a sealed snapshot of every protocol DefiLlama tracks (758 protocols, 14 Nov 2026), finds the ones with no token, and ranks them by what a launch would be worth — priced off a size curve fitted to the snapshot's own 128 tokenised peers (log market cap on log TVL), not by raw TVL and not by one stamped median multiple.

The point the ranking turns on: the obvious giants are not launchable. Wrapped Bitcoin, the big bridges, the liquid-staking receipts and the centralised exchanges hold most of the pre-token TVL, and a "launch" for them is meaningless — so this entry sets 144 of them aside with the reason stated, and ranks the remaining 198. The top of the board is Sentora Curator ($91M implied), Steakhouse Financial ($90M) and Gauntlet ($68M) — risk curators, not the wrapped assets every TVL-sorted list returns. Every row shows the curve value, the category-median multiple as a cross-check, and a farm plan built from that protocol's own record (category, chains, TVL tier, gas cost, cadence, exit) — never a repeated generic step. Each row also carries a one-line note saying why that cross-check multiple was used (peer-set size, fallback level, 25th/75th percentiles), and the top rows' farm plans name the real vault, market or mechanism instead of a generic template.

## Why the size curve (v2)

v1 priced every row off a category-median multiple. v2 tested that against a fitted size curve on the snapshot itself — leave-one-out over all 128 peers, and walk-forward (fitted on peers listed before 2025, tested on peers listed after). The curve won both: median log error 1.22 vs 1.60 leave-one-out (within-3x 44% vs 34%), 1.12 vs 1.51 walk-forward (within-3x 48% vs 36%). The slope is 0.52, so the implied multiple falls as TVL grows — the largest priced peers prove it (Lido 0.013x, OKX 0.075x, EigenCloud 0.032x). Seasoning and chain breadth failed both tests on the curve base and were dropped; momentum survived at half strength. The bear–bull band is the 25th–75th percentile of the model's own leave-one-out errors (x0.32–x4.39), holding 50% of held-out tokens. The dashboard's integrity strip shows every check live, including a recompute of the top 5 rows from the curve itself. Farm verdicts (91 FARM / 57 MARGINAL / 50 SKIP) price gas cost against the position size only — the snapshot records no yield, so no return is ever claimed. Nothing here predicts whether or when a token will launch.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only, no network. Writes `board.json` (198 rows, whole watchlist covered), `data.js`, `dashboard/` (a static page that renders offline from `data.js`), three screenshots, and `dossier.json` via the kit's `vendor/makefun-board.ts`. The dashboard is a dense data terminal — dark ink, one amber accent, no gradients, no hero — with an integrity strip (held-out validation, range calibration, coverage, farm verdicts, live recompute), sortable/filterable rows, a per-protocol detail view (the full arithmetic: size-curve value, category-median cross-check, halved momentum, farm economics), and the set-aside table with reasons.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
