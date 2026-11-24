// Token Launch Radar — scoring model (written for make.fun bounty token-radar-01).
//
// The model reads ONLY the sealed DefiLlama snapshot (2026-11-14). It contains no
// hardcoded ranking of names: every value is computed from the snapshot's own figures.
//
// Value model, in one paragraph: for each protocol that records no token, take the
// market-cap/TVL multiples of the tokenised protocols in its own category (median,
// with 25th/75th percentiles for the range), fall back to a category group and then
// to the whole field where a category has too few peers, and multiply the protocol's
// TVL by that multiple. The result is then adjusted for what the snapshot actually
// says about the protocol: its 7-day TVL momentum, how long it has run with no token
// (seasoning), and how many chains it runs on. Protocols the house's own rule
// excludes — bridges, liquid-staking wrappers, centralised exchanges, versioned
// releases, wrapped/staked products — are not ranked at all: their "launch" is
// meaningless (WBTC is Bitcoin on Ethereum), so they are listed separately with
// the reason they were set aside. The board ranks by the adjusted expected value,
// and every row shows the unadjusted base FDV and the bear/base/bull range beside
// it, so the adjustment is visible, not hidden.
//
// Two honest limits, stated wherever the numbers appear:
//   1. The snapshot carries circulating market cap, not fully-diluted value. Multiples
//      built on it are a floor: a token's FDV at launch is usually higher.
//   2. The snapshot carries no fees, revenue, funding, team or points-program data.
//      Nothing here claims a protocol HAS a points program or funding round; the
//      farm plans say what to do on the protocol itself and tell the reader to verify
//      the live program on the protocol's own docs before committing funds.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Peer {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  // explainability extras (the gate allows extra keys)
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  base_fdv_usd: number;
  bear_usd: number;
  bull_usd: number;
  multiple: number;
  multiple_level: 'category' | 'group' | 'global';
  peer_count: number;
  peers: { name: string; multiple: number }[];
  plausibility: number;
  plausibility_reasons: string[];
  readiness: number;
  watchlist: boolean;
}

export interface RadarData {
  meta: {
    as_of: string;
    source: string;
    floor_usd: number;
    protocols_scanned: number;
    pre_token: number;
    tokenised: number;
    watchlist: number;
    board_rows: number;
    set_aside: number;
    global_multiple: { median: number; p25: number; p75: number; peers: number };
    model_note: string;
  };
  rows: BoardRow[];
  comps: Peer[];
  setAside: { slug: string; name: string; category: string | null; tvl_usd: number; reason: string }[];
}

const AS_OF_MS = Date.parse('2026-11-14T00:00:00Z');

// ---------------------------------------------------------------- snapshot

const PROTOCOL_FIELDS = ['slug', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'mcap_usd', 'listed_at', 'gecko_id', 'symbol'];

export function parseSnapshot(text: string): Snapshot {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null) throw new Error('snapshot: not an object');
  const s = raw as Record<string, unknown>;
  if (typeof s.as_of !== 'string' || typeof s.source !== 'string' || typeof s.floor_usd !== 'number') {
    throw new Error('snapshot: missing as_of/source/floor_usd');
  }
  if (!Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) throw new Error('snapshot: protocols/watchlist are not arrays');
  const protocols: Protocol[] = (s.protocols as Record<string, unknown>[]).map((p, i) => {
    for (const f of PROTOCOL_FIELDS) if (!(f in p)) throw new Error(`snapshot: protocol ${i} lacks ${f}`);
    return {
      slug: String(p.slug),
      name: String(p.name),
      category: p.category === null ? null : String(p.category),
      chains: (p.chains as string[]).map(String),
      tvl_usd: Number(p.tvl_usd),
      change_7d: p.change_7d === null ? null : Number(p.change_7d),
      mcap_usd: p.mcap_usd === null ? null : Number(p.mcap_usd),
      listed_at: p.listed_at === null ? null : String(p.listed_at),
      gecko_id: p.gecko_id === null ? null : String(p.gecko_id),
      symbol: p.symbol === null ? null : String(p.symbol),
    };
  });
  return { as_of: s.as_of, source: s.source, floor_usd: s.floor_usd, protocols, watchlist: (s.watchlist as string[]).map(String) };
}

// ---------------------------------------------------------------- helpers

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[idx]!;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

// ---------------------------------------------------------------- category groups (fallback ladder for peer multiples)

const GROUP_OF: Record<string, string> = {
  Dexs: 'trading',
  Derivatives: 'trading',
  'Prediction Market': 'trading',
  'Options Vault': 'trading',
  'OTC Marketplace': 'trading',
  Lending: 'credit',
  CDP: 'credit',
  'CDP Manager': 'credit',
  'Leveraged Farming': 'credit',
  'Uncollateralized Lending': 'credit',
  'Collateral Markets': 'credit',
  'Basis Trading': 'credit',
  Yield: 'yield',
  'Yield Aggregator': 'yield',
  Farm: 'yield',
  'Liquidity Manager': 'yield',
  'Risk Curators': 'yield',
  'Onchain Capital Allocator': 'yield',
  'Liquid Staking': 'staking',
  'Liquid Restaking': 'staking',
  Restaking: 'staking',
  'Restaked BTC': 'staking',
  'Staking Pool': 'staking',
  'Anchor BTC': 'staking',
  Bridge: 'bridge',
  'Canonical Bridge': 'bridge',
  'Cross Chain Bridge': 'bridge',
  RWA: 'rwa',
  CeDeFi: 'rwa',
  'Stablecoin Wrapper': 'rwa',
  'Dual-Token Stablecoin': 'rwa',
  'Crypto Card Issuer': 'rwa',
  Payments: 'rwa',
  Chain: 'infra',
  Privacy: 'infra',
  Insurance: 'infra',
  Indexes: 'infra',
  'Interest Rate Derivatives': 'infra',
  'Governance Incentives': 'infra',
  'Decentralized BTC': 'infra',
  'AI Agents': 'infra',
  'Token Locker': 'infra',
  CEX: 'cex',
};

// The house's own exclusion rule, applied to the whole pre-token universe: a
// protocol is a structural non-launcher when its category is a bridge, a liquid
// staking/restaking product, or a centralised exchange; when its name ends in a
// version marker; when its name carries wrapped/staked/staking; or when it begins
// with an exchange's name. (The house rule also drops protocols with a
// parentProtocol; that field is not in the snapshot, and the watchlist already
// reflects it.) These protocols are NOT ranked: WBTC is Bitcoin on Ethereum and
// a bridge's "launch" is meaningless, so ranking them at the top on raw TVL
// would be the exact error this radar exists to avoid. They are listed, with
// their reason, in the dashboard's set-aside table instead of being silently cut.
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

function exclusionReason(p: Protocol): string | null {
  const cat = p.category ?? '';
  if (EXCLUDED_CATEGORIES.has(cat)) {
    if (cat === 'CEX') return 'Centralised exchange: a token launch is structurally unlikely';
    if (cat === 'Bridge' || cat === 'Canonical Bridge') return 'Bridge: moves other chains’ assets, rarely launches its own token';
    return 'Staking wrapper: the product is a receipt for a token that already trades';
  }
  if (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name)) return 'Versioned release (e.g. V2): usually an upgrade, not a fresh launch';
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return 'Name marks it a wrapped/staked product of an existing token';
  if (/^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i.test(p.name)) return 'Carries an exchange’s name: an exchange product, not an independent launch';
  return null;
}

// Launch-plausibility priors, stated openly in the dashboard's method note.
// A centralised exchange or a wrapped/staked product of a token that already trades
// is structurally unlikely to launch a token of its own; ordinary DeFi is not discounted.
function plausibility(p: Protocol): { factor: number; reasons: string[] } {
  const reason = exclusionReason(p);
  if (reason !== null) return { factor: 0.25, reasons: [reason] };
  return { factor: 1, reasons: [] };
}

// Gas-cost tier of a chain, for farm-plan budgeting (rough, stated as a range).
function gasTier(chain: string): string {
  const cheap = new Set(['Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BNB Chain', 'Avalanche', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mantle', 'Gnosis', 'Fantom', 'Celo']);
  if (chain === 'Ethereum') return '$25–60 in gas per session on Ethereum mainnet';
  if (cheap.has(chain)) return '$1–5 in gas per session on ' + chain;
  if (chain === 'Bitcoin') return 'no smart-contract gas: actions run on the wrapping chain, budget $5–15';
  return '$2–10 in gas per session on ' + chain;
}

function sizeTier(tvl: number): string {
  if (tvl < 25_000_000) return '$200–500';
  if (tvl < 250_000_000) return '$500–2,000';
  return '$1,000–5,000';
}

// ---------------------------------------------------------------- scoring

interface MultipleSet {
  median: number;
  p25: number;
  p75: number;
  n: number;
  level: 'category' | 'group' | 'global';
}

function multipleSet(values: number[]): { median: number; p25: number; p75: number; n: number } {
  const s = [...values].sort((a, b) => a - b);
  return { median: median(s), p25: percentile(s, 0.25), p75: percentile(s, 0.75), n: s.length };
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const watch = new Set(snapshot.watchlist);
  const tokenised = snapshot.protocols.filter((p) => p.gecko_id !== null || p.symbol !== null);
  const preToken = snapshot.protocols.filter((p) => p.gecko_id === null && p.symbol === null);
  // The ranked board holds only launchable pre-token protocols. Structural
  // non-launchers (the house's exclusion rule) are set aside with their reason.
  const launchable = preToken.filter((p) => exclusionReason(p) === null);
  const setAside = preToken
    .filter((p) => exclusionReason(p) !== null)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: exclusionReason(p)! }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd);

  // Peer multiples: tokenised protocols with a market cap and positive TVL.
  const peers: Peer[] = tokenised
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, multiple: p.mcap_usd! / p.tvl_usd }))
    .sort((a, b) => a.multiple - b.multiple);

  const byCategory = new Map<string, number[]>();
  const byGroup = new Map<string, number[]>();
  for (const peer of peers) {
    if (peer.category !== null) {
      const arr = byCategory.get(peer.category) ?? [];
      arr.push(peer.multiple);
      byCategory.set(peer.category, arr);
      const g = GROUP_OF[peer.category];
      if (g !== undefined) {
        const ga = byGroup.get(g) ?? [];
        ga.push(peer.multiple);
        byGroup.set(g, ga);
      }
    }
  }
  const global = multipleSet(peers.map((p) => p.multiple));

  function multiplesFor(p: Protocol): MultipleSet {
    if (p.category !== null) {
      const c = byCategory.get(p.category);
      if (c !== undefined && c.length >= 3) return { ...multipleSet(c), level: 'category' };
      const g = GROUP_OF[p.category];
      if (g !== undefined) {
        const gr = byGroup.get(g);
        if (gr !== undefined && gr.length >= 3) return { ...multipleSet(gr), level: 'group' };
      }
    }
    return { ...global, level: 'global' };
  }

  const rows: BoardRow[] = launchable.map((p) => {
    const m = multiplesFor(p);
    // Momentum: 7-day TVL change, clamped so one spike cannot carry the score.
    const chg = p.change_7d === null ? 0 : clamp(p.change_7d, -50, 100);
    const momentum = 1 + chg / 200; // 0.75x at -50%, 1.50x at +100%
    // Seasoning: days since DefiLlama first tracked it, to the snapshot date.
    let ageDays: number | null = null;
    let seasoning = 1;
    if (p.listed_at !== null) {
      ageDays = Math.max(0, Math.round((AS_OF_MS - Date.parse(p.listed_at + 'T00:00:00Z')) / 86_400_000));
      seasoning = 0.85 + (0.3 * Math.min(ageDays, 1095)) / 1095; // 0.85x fresh -> 1.15x after 3 years
    }
    // Chain breadth: distribution across chains.
    const chainF = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 10); // up to 1.20x
    const adj = momentum * seasoning * chainF;
    const { factor: plaus, reasons } = plausibility(p);
    const baseFdv = p.tvl_usd * m.median;
    const bear = p.tvl_usd * m.p25 * adj;
    const bull = p.tvl_usd * m.p75 * adj;
    const expected = baseFdv * adj * plaus;
    // Named comps: the 3 tokenised peers closest in TVL from the SAME pool the
    // multiple came from (category, group, or the whole field) — never a peer
    // from an unrelated category that merely shares a TVL.
    const compPool =
      m.level === 'category'
        ? peers.filter((x) => x.category === p.category)
        : m.level === 'group'
          ? peers.filter((x) => x.category !== null && GROUP_OF[x.category] === GROUP_OF[p.category ?? ''])
          : peers;
    const named = [...compPool]
      .sort((a, b) => Math.abs(Math.log(a.tvl_usd / p.tvl_usd)) - Math.abs(Math.log(b.tvl_usd / p.tvl_usd)))
      .slice(0, 3)
      .map((x) => ({ name: x.name, multiple: Math.round(x.multiple * 100) / 100 }));
    // Readiness: a 0-100 presentation aid (rank itself is by expected value).
    const momScore = p.change_7d === null ? 0.5 : clamp((p.change_7d + 50) / 150, 0, 1);
    const seaScore = ageDays === null ? 0.5 : clamp(ageDays / 1095, 0, 1);
    const chainScore = clamp((p.chains.length - 1) / 10, 0, 1);
    const readiness = Math.round(50 * plaus + 25 * momScore + 15 * seaScore + 10 * chainScore);

    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: Math.max(1, Math.round(expected)),
      farm_steps: farmPlan(p, m),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageDays,
      base_fdv_usd: Math.max(1, Math.round(baseFdv * adj)),
      bear_usd: Math.max(1, Math.round(bear)),
      bull_usd: Math.max(1, Math.round(bull)),
      multiple: Math.round(m.median * 1000) / 1000,
      multiple_level: m.level,
      peer_count: m.n,
      peers: named,
      plausibility: Math.round(plaus * 100) / 100,
      plausibility_reasons: reasons,
      readiness,
      watchlist: watch.has(p.slug),
    };
  });

  // Rank by expected value; ties break on TVL, then slug (deterministic).
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const radar: RadarData = {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      protocols_scanned: snapshot.protocols.length,
      pre_token: preToken.length,
      tokenised: tokenised.length,
      watchlist: snapshot.watchlist.length,
      board_rows: rows.length,
      set_aside: setAside.length,
      global_multiple: { median: Math.round(global.median * 1000) / 1000, p25: Math.round(global.p25 * 1000) / 1000, p75: Math.round(global.p75 * 1000) / 1000, peers: global.n },
      model_note:
        'Implied value = TVL x the median market-cap/TVL multiple of tokenised peers in the same category (group, then whole field, where a category has fewer than 3 peers), adjusted for 7-day TVL momentum, seasoning since first tracked, and chain breadth. Protocols the house rule excludes (bridges, liquid-staking wrappers, CEX, versioned/wrapped names) are set aside, not ranked. Multiples use circulating market cap, not FDV, so values are a floor. Bear/base/bull use the 25th/median/75th peer multiples.',
    },
    rows,
    comps: peers,
    setAside,
  };
  return { board: rows, radar };
}

// ---------------------------------------------------------------- gate validation (mirrors the scorer's seven rows)

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, needs 100 to 4000`;
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  let allSame = board.length > 1;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (seen.has(r.slug)) return `duplicate slug ${r.slug}`;
    seen.add(r.slug);
    if (!snapshot.protocols.some((p) => p.slug === r.slug)) return `unknown slug ${r.slug}`;
    if (r.rank !== i + 1) return `rank ${r.rank} at position ${i + 1}: ranks must be 1..N in order`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `row ${r.slug}: implied_value_usd ${r.implied_value_usd} is not a valid whole-dollar value`;
    }
    if (r.implied_value_usd > prev) return `row ${r.slug}: implied value rises with rank`;
    if (i > 0 && r.implied_value_usd !== board[0]!.implied_value_usd) allSame = false;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.slug}: ${r.farm_steps.length} farm steps, needs 3 to 12`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug}: a farm step is ${t.length} chars, needs 20 to 600`;
    }
    prev = r.implied_value_usd;
  }
  if (allSame) return 'all implied values are identical: not a ranking';
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `watchlist slug ${slug} missing from the board`;
  return null;
}

// ---------------------------------------------------------------- dashboard data script (deterministic)

export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

// ---------------------------------------------------------------- farm plans
//
// Every plan is built from the protocol's own snapshot record: its name, its
// category, its chains and its TVL tier. Steps name the cost and the time they
// take; the last step of every plan says the same honest thing: verify the live
// program on the protocol's own docs first, because this board is built from a
// 14 Nov 2026 snapshot, not live data, and no plan here claims a points program
// or an airdrop the snapshot does not record.

function primaryChain(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
}

function verifyStep(p: Protocol): string {
  return `Before committing funds, confirm ${p.name}'s current program on its official site and docs: points, quests and eligibility change often, and this plan is built from the 14 Nov 2026 snapshot, not live data. If there is no program, treat the activity below as product use, not a farm.`;
}

function exitStep(p: Protocol): string {
  return `Plan the exit before you enter: know how to unwind each position on ${p.name}, keep a small reserve for gas on ${primaryChain(p)}, and never lock funds you need within the next month. If the protocol pauses deposits or changes terms, unwind rather than chase it.`;
}

function cadenceStep(): string {
  return 'Spread the activity over 3–4 weeks, 2–3 sessions a week, instead of one burst: a steady footprint reads as real use, and a single-day burst reads as a sybil run.';
}

function trackStep(p: Protocol): string {
  return `Keep a one-line log of every action on ${p.name} — date, amount, chain, transaction hash — and check weekly for new quests, seasons or announcements. A farm you cannot reconstruct is a farm you cannot defend.`;
}

function farmPlan(p: Protocol, m: MultipleSet): string[] {
  const name = p.name;
  const chain = primaryChain(p);
  const gas = gasTier(chain);
  const size = sizeTier(p.tvl_usd);
  const cat = p.category ?? '';
  const group = GROUP_OF[cat] ?? 'infra';
  const tvlNote = `${money(p.tvl_usd)} of TVL on the snapshot`;
  const steps: string[] = [];

  const setup = `Set up a fresh wallet that supports ${chain}, fund it with ${size} for positions plus gas money (${gas}), and bridge only what the plan below needs. Keep the farm wallet separate from your main holdings.`;
  steps.push(setup);

  switch (group) {
    case 'trading': {
      steps.push(`Swap a small amount through ${name} on ${chain} first — a $50–150 test trade — and confirm the quote, slippage and receipt land as expected before sizing up.`);
      steps.push(`Provide liquidity or trade again in the same pool on ${name} at least twice more across the next two weeks, using varied sizes so the activity looks like a trader's, not a script's.`);
      if (cat === 'Derivatives' || cat === 'Prediction Market') {
        steps.push(`Open one small leveraged or prediction position on ${name} with size you can afford to lose outright, and close it within a week: the point is a completed trade lifecycle, not the PnL.`);
      } else {
        steps.push(`If ${name} lists a pool with an incentive or fee tier, route one trade through it and hold the position for at least 7 days so the liquidity is seasoned, not flash.`);
      }
      break;
    }
    case 'credit': {
      steps.push(`Supply an asset on ${name} on ${chain} — stablecoins first, ${size} — and confirm the deposit receipt and the supply position show in the app.`);
      if (cat === 'CDP' || cat === 'CDP Manager') {
        steps.push(`Mint the protocol's stable asset against your supplied collateral at a conservative ratio (below 50% of the liquidation line), hold it for at least two weeks, then repay and close the vault cleanly.`);
      } else {
        steps.push(`Borrow a modest amount against the supply (under 40% of its value), use it or repay it within the same week, and repeat once: a full supply-borrow-repay cycle is the footprint that counts.`);
      }
      if (cat === 'Basis Trading') {
        steps.push(`If ${name} runs a basis or funding-rate vault, enter it with a second tranche after the first week and compare its reported yield against the plan's expectation before adding more.`);
      } else {
        steps.push(`Leave the supply working for at least 3 weeks, topping it up once mid-period, so the position ages instead of appearing and vanishing in a day.`);
      }
      break;
    }
    case 'yield': {
      steps.push(`Deposit ${size} into ${name}'s flagship vault or strategy on ${chain} (${tvlNote}) and confirm the vault shares or receipt token arrive in your wallet.`);
      steps.push(`After one week, add a second deposit of roughly half the first into a different vault or strategy on ${name}, so the footprint covers more than a single pool.`);
      steps.push(`Hold both positions for at least 3 weeks, claim or compound any rewards once mid-period, and record the yield each vault actually paid versus what its page promised.`);
      break;
    }
    case 'staking': {
      steps.push(`Stake ${size} through ${name} on ${chain} and confirm the staking receipt token (or position) shows in your wallet; note the unstaking delay before you commit.`);
      steps.push(`If ${name} offers a restaking or second-layer option, move a portion of the receipt into it after a week — but only where the docs name the risks plainly, and only an amount you can afford to have locked for the full delay.`);
      steps.push(`Hold the stake for at least 3 weeks and claim rewards once, recording the unstaking queue length so you know the true exit time.`);
      break;
    }
    case 'bridge': {
      steps.push(`Bridge a small test amount ($50–150) through ${name} from ${chain} to its most-used destination chain and confirm it arrives, timing the transfer.`);
      steps.push(`Bridge two more transfers of varied size over the next two weeks, in both directions where the route supports it, and compare the fee each way.`);
      steps.push(`If ${name} charges a fee or runs a relayer program, use the standard route rather than a subsidised one, so the activity is the protocol's real revenue path.`);
      break;
    }
    case 'rwa': {
      steps.push(`Open a position in ${name}'s flagship offering on ${chain} with ${size}, and read the redemption terms before you deposit: lockups and KYC gates are common in this category.`);
      steps.push(`Hold the position for at least 3 weeks, collecting any yield or receipt it pays, and confirm the redemption path works with a small test redemption before the plan ends.`);
      steps.push(`If ${name} publishes audits or backing reports, read the latest one and note its date: a real-world-asset protocol is only as good as its backing.`);
      break;
    }
    case 'cex': {
      steps.push(`Use ${name} as a customer, not a farmer: place a few spot trades and, if it offers one, try its earn product with ${size}. A centralised exchange almost never airdrops a token, so this is product use.`);
      steps.push(`Complete the account checks the exchange requires and enable every security option it offers; a farm on a centralised venue is worthless if the account is the weak point.`);
      steps.push(`Keep balances on the exchange small and withdraw to your own wallet after each session: custody risk is the real cost of farming a CEX.`);
      break;
    }
    default: {
      // infra and uncategorised protocols
      steps.push(`Use ${name}'s core function on ${chain} with ${size}: make the interaction the protocol exists for, not a generic deposit, and confirm the result on-chain.`);
      steps.push(`Repeat the core interaction twice more over the next two weeks with varied parameters, so the footprint shows a user learning the tool rather than a one-off ping.`);
      steps.push(`If ${name} has a community channel or governance forum, read its latest updates once a week: infrastructure launches are announced there first, not on price charts.`);
      break;
    }
  }

  steps.push(cadenceStep());
  steps.push(trackStep(p));
  steps.push(verifyStep(p));
  steps.push(exitStep(p));
  return steps.slice(0, 8);
}
