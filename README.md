# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Young12-think/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Young12-think/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for token launches that have not happened yet. It reads a sealed snapshot of every protocol DefiLlama tracks (758 protocols, 14 Nov 2026), finds the ones with no token, and ranks them by what a launch would be worth — not by raw TVL, but by the market-cap/TVL multiple of tokenised peers in the same category, adjusted for 7-day momentum, seasoning, and chain breadth, with a bear/base/bull range instead of one fake-precise number.

The point the ranking turns on: the obvious giants are not launchable. Wrapped Bitcoin, the big bridges, the liquid-staking receipts and the centralised exchanges hold most of the pre-token TVL, and a "launch" for them is meaningless — so this entry sets 144 of them aside with the reason stated, and ranks the remaining 198. The top of the board is Steakhouse Financial ($552M implied), Polymarket International ($516M) and Sentora Curator ($481M) — risk curators and a prediction market, not the wrapped assets every TVL-sorted list returns. Every row shows the multiple used, the named peers behind it, and a farm plan built from that protocol's own record (category, chains, TVL tier, gas cost, cadence, exit) — never a repeated generic step.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only, no network. Writes `board.json` (198 rows, whole watchlist covered), `data.js`, `dashboard/` (a static page that renders offline from `data.js`), three screenshots, and `dossier.json` via the kit's `vendor/makefun-board.ts`. The dashboard is a dense data terminal — dark ink, one amber accent, no gradients, no hero — with sortable/filterable rows, a per-protocol detail view (the full arithmetic: TVL × multiple, each adjustment, named comps, farm steps), and the set-aside table with reasons.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
