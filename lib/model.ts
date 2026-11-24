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
//
// Sharpening (24 Nov 2026, still snapshot-only): each row also carries a one-line
// multiple_note naming the peer set behind its multiple and why that set was used,
// so a repeated median is a documented method choice, not a stamped number. The
// highest-ranked rows get curated farm plans (PRODUCT_PLANS below) that name the
// real vault, market or mechanism — researched from the protocols' own docs and
// listings in Nov 2026 and baked in as literal strings. No curated step claims a
// points program, an APY, or a launch date the snapshot does not record.

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
  multiple_p25: number;
  multiple_p75: number;
  multiple_note: string;
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

// One line per row, naming the peer set behind its multiple and why that set was
// used. The point is that a repeated median (0.169x on several Risk Curator rows)
// is a documented fallback, not a stamped number. An extreme outlier peer is
// called out only for small category-level peer sets, where one peer is visible
// enough to look like it stretches the range (the BitFi case: Bitway Earn at
// 36.17x among 7 Basis Trading peers). With at least five peers the max never
// sets the median or the p25/p75 range, so the note says so.
function multipleNote(p: Protocol, m: MultipleSet, pool: Peer[]): string {
  const med = Math.round(m.median * 1000) / 1000;
  const p25 = Math.round(m.p25 * 1000) / 1000;
  const p75 = Math.round(m.p75 * 1000) / 1000;
  const cat = p.category ?? 'Uncategorised';
  let note: string;
  if (m.level === 'category') {
    note = `Multiple is the median of ${m.n} tokenised ${cat} peers (p25 ${p25}x, p75 ${p75}x).`;
  } else if (m.level === 'group') {
    const g = GROUP_OF[cat] ?? 'infra';
    note = `${cat} has no tokenised peer set of its own (fewer than 3 peers with a market cap), so the multiple is the median of ${m.n} ${g}-group peers (p25 ${p25}x, p75 ${p75}x).`;
  } else {
    note = `No category or group peer set, so the multiple is the median of ${m.n} tokenised protocols overall (p25 ${p25}x, p75 ${p75}x).`;
  }
  if (m.level === 'category' && m.n >= 5 && m.n <= 10 && pool.length > 0) {
    const top = [...pool].sort((a, b) => b.multiple - a.multiple)[0]!;
    if (top.multiple > 10 * m.p75) {
      note += ` One peer, ${top.name} at ${Math.round(top.multiple * 100) / 100}x, is an extreme outlier far above the rest of the set; it does not move the median or the p25/p75 range.`;
    }
  }
  return note;
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
      multiple_p25: Math.round(m.p25 * 1000) / 1000,
      multiple_p75: Math.round(m.p75 * 1000) / 1000,
      multiple_note: multipleNote(p, m, compPool),
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
        'Implied value = TVL x the median market-cap/TVL multiple of tokenised peers in the same category (group, then whole field, where a category has fewer than 3 peers), adjusted for 7-day TVL momentum, seasoning since first tracked, and chain breadth. Protocols the house rule excludes (bridges, liquid-staking wrappers, CEX, versioned/wrapped names) are set aside, not ranked. Multiples use circulating market cap, not FDV, so values are a floor. Bear/base/bull use the 25th/median/75th peer multiples. Each row carries a multiple_note naming the peer set behind its multiple and why that set was used. Third-party pages report Extended’s XTEN token launching 30 Nov 2026, after this snapshot’s date; the board still ranks Extended from the 14 Nov snapshot, as the bounty requires.',
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
//
// The highest-ranked rows get curated plans (curatedPlan below) that name the
// real vault, market or mechanism instead of a generic template. The cadence
// and log steps also vary by category group, so the tail of every plan names
// what that kind of protocol actually asks a user to record.

// Curated farm plans for the highest-ranked rows. Each names the real product a
// reader touches (vault, market, mechanism) instead of a generic "flagship vault".
// Researched from the protocols' own docs and listings in Nov 2026 and baked in
// here as literal strings; the program still reads nothing but the sealed snapshot.
// Deliberately claims NO points program, NO APY, NO launch date the snapshot
// does not record. Every plan is setup + three protocol-specific actions; the
// shared verify-first and exit steps are appended by farmPlan below.
interface CuratedPlan { setup: string; actions: string[]; }

function curatedPlan(p: Protocol, size: string, chain: string, gas: string): CuratedPlan | null {
  switch (p.slug) {
    case 'steakhouse-financial':
      return {
        setup: `Deposit ${size} into Steakhouse Prime USDC (steakUSDC) on Morpho on ${chain}, the vault that lends USDC only against blue-chip collateral (cbBTC, cbETH, WETH, wstETH), plus ${gas}.`,
        actions: [
          `On Morpho, open Steakhouse Prime USDC and check the vault's current collateral list and loan-to-value before depositing; Prime accepts blue-chip collateral only, so a loan against it stays inside the same safety band.`,
          `Optionally add a second, smaller deposit into Steakhouse High Yield USDC, the higher-yield tier that takes a broader collateral set than Prime; write down the exact collateral difference before sizing it.`,
          `Keep the steakUSDC share-token receipt and the deposit transaction; if the vault ever changes collateral or curator, the receipt is the record of what was deposited and when.`,
        ],
      };
    case 'polymarket-international':
      return {
        setup: `Fund ${size} on Polymarket on ${chain} with USDC; the site wraps it into pUSD, the ERC-20 balance token backed 1:1 by USDC/USDC.e, plus ${gas}.`,
        actions: [
          `Pick one market whose question and resolution source are plain to you (for example an election or a sports result), read its rules page, and place a small trade; keep most of the position in pUSD until the mechanics are familiar.`,
          `Trade inside the markets themselves rather than holding a balance; note which markets have the deepest books, because thin books are where a fill costs more than the price shown.`,
          `Do not touch Polymarket US unless you are a US user: it is a CFTC-regulated exchange with its own registration, and the international site is the one this entry tracks.`,
        ],
      };
    case 'sentora-curator':
      return {
        setup: `Deposit ${size} into Sentora RLUSD Main on Morpho on ${chain}, the vault that lends against RLUSD with an audited curator review, plus ${gas}.`,
        actions: [
          `On Morpho, open Sentora RLUSD Main and confirm the vault's collateral list and its borrow cap; a small share of this vault's funds is withdrawable on demand, so check the current withdrawable amount before sizing a deposit.`,
          `Optionally add a second deposit into Sentora PayPal USD Main, the other large vault in the same family (PYUSD collateral); compare the two vaults' collateral and withdrawable amounts side by side before choosing.`,
          `Keep the Morpho vault share-token receipt and the deposit transaction; if Sentora ever changes the vault's curator or collateral, the receipt is the record of what was deposited and when.`,
        ],
      };
    case 'gauntlet':
      return {
        setup: `Deposit ${size} into Gauntlet USDC Prime on Morpho on ${chain}, the blue-chip-only tier that lends against wstETH, cbBTC, wBTC and sDAI, plus ${gas}.`,
        actions: [
          `On Morpho, open Gauntlet USDC Prime and check the current collateral list and loan-to-value; Prime accepts blue-chip collateral only, so a loan against it stays inside the same safety band.`,
          `Optionally step one tier up to Gauntlet USDC Core (listed as Balanced in newer docs), which adds PT tokens and sUSDe; write down the extra collateral accepted before sizing it, and keep the higher-yield Frontier tier (syrupUSDC, sdeUSD) for a separate, smaller deposit if you want it at all.`,
          `Uniswap Earn routes into the Prime tier, so if you already use Uniswap Earn, check whether the same vault is available there before opening a second position.`,
        ],
      };
    case 'veda':
      return {
        setup: `Deposit ${size} into a partner vault built on Veda's BoringVault infrastructure on ${chain}, for example the ether.fi Liquid vault, the Kraken DeFi Earn vault or the MetaMask Earn vault, plus ${gas}.`,
        actions: [
          `Open the partner vault's own page and check what it actually holds (liquid restaking tokens, stablecoins, or a mix); Veda is the vault infrastructure, not the vault itself, so the risk sits in the partner's strategy, not in a Veda flagship product.`,
          `Compare two partner vaults side by side on the same page (assets held, withdrawal terms, fees) before choosing; do not deposit into a vault whose holdings you cannot name.`,
          `Keep the vault share-token receipt and the deposit transaction; if the partner ever changes strategy or manager, the receipt is the record of what was deposited and when.`,
        ],
      };
    case 'usdd':
      return {
        setup: `Mint ${size} of USDD 2.0 on ${chain} through the PSM (Peg Stability Module), which swaps USDT or USDC 1:1 with no fee, plus ${gas}.`,
        actions: [
          `Deposit the minted USDD into the sUSDD savings vault on the USDD site and check the current savings rate there; the vault, not the stablecoin itself, is where the yield comes from.`,
          `Optionally open a USDD vault position with TRX or staked TRX as collateral and mint up to about half the liquidation line (liquidation sits below a 120% collateral ratio); write down the exact ratio before borrowing.`,
          `Keep the PSM swap receipt and the vault deposit transaction; if USDD ever changes its peg mechanism or the Smart Allocator's backing, the receipts are the record of what was held and when.`,
        ],
      };
    case 'hive-protocol':
      return {
        setup: `Bridge ${size} of BTC to ${chain} and stake it in the BSquared Hive vault, which stakes BTC to safeguard the B2 network and pays rewards in the B2 token, plus ${gas}.`,
        actions: [
          `On Hive's own site, check the bridge's status and the vault's current terms first, then bridge the BTC and stake it in the Hive vault; note the one-day unstaking lock, so do not stake funds needed sooner.`,
          `Watch the B2 rewards the vault accrues and record how they are paid (token, cadence, claim or auto-compound); a reward that cannot be claimed or sold is not a return yet.`,
          `Keep the bridge transaction and the staking receipt; if the bridge or the vault ever pauses, the receipts are the record of where the BTC went and when.`,
        ],
      };
    case 'figure-markets-exchange':
      return {
        setup: `Open a Figure Markets account on ${chain} and deposit ${size} into YLDS, the SEC-registered yield-bearing stablecoin that accrues interest daily and pays monthly, plus ${gas}.`,
        actions: [
          `Complete the account and identity check first: YLDS is a registered security, not a permissionless vault token, so there is no way to hold it without an account; read the offering documents before depositing.`,
          `Check the current yield on the YLDS page (it tracks the Secured Overnight Financing Rate minus 35 basis points) and confirm the daily accrual and monthly payment schedule in the account.`,
          `Keep the account statement and the deposit receipt; YLDS is not a bank deposit and is not FDIC-insured, so the account record is the proof of what was held and when.`,
        ],
      };
    case 'bitfi-basis':
      return {
        setup: `Deposit ${size} of USDT on ${chain} to mint bfUSD, BitFi's yield stablecoin, which is backed by delta-neutral positions held with the custodian Ceffu, plus ${gas}.`,
        actions: [
          `On the BitFi app, mint bfUSD with USDT and record the mint fee the app actually charged; the fee is not published publicly, so the number on screen is the only fee you will ever see.`,
          `Optionally hold bfBTC, the yield-bearing BTC token from the same issuer, instead of or alongside bfUSD; compare the two tokens' backing and redemption terms on the BitFi site before choosing.`,
          `Keep the mint receipt and the deposit transaction; BitFi lists no public audits on DefiLlama, so the receipt and a record of the custodian arrangement are the only proof of what was held and when.`,
        ],
      };
    case 'extended-perps':
      return {
        setup: `Deposit ${size} of USDC into Extended on ${chain}, the Starknet hybrid perps exchange (formerly X10) that settles in USDC with no account or KYC, plus ${gas}.`,
        actions: [
          `Pick one market you can explain in a sentence (for example BTC, EUR/USD or gold; Extended lists 50+ markets including TradFi) and place a small trade with leverage well below the 100x maximum; keep most of the deposit in USDC until the order book and fees are familiar.`,
          `Optionally deposit into the XVS vault, Extended's yield vault for USDC; check the vault's current terms on the Extended site and do not quote any APY figure from a third-party page, because the vault's rate is not verified here.`,
          `Keep the deposit and trade receipts; Extended's settlement moved to the Arc chain in Oct 2026, so confirm which chain your funds actually settle on before depositing.`,
        ],
      };
    default:
      return null;
  }
}

function primaryChain(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
}

function verifyStep(p: Protocol): string {
  return `Before committing funds, confirm ${p.name}'s current program on its official site and docs: points, quests and eligibility change often, and this plan is built from the 14 Nov 2026 snapshot, not live data. If there is no program, treat the activity below as product use, not a farm.`;
}

function exitStep(p: Protocol): string {
  return `Plan the exit before you enter: know how to unwind each position on ${p.name}, keep a small reserve for gas on ${primaryChain(p)}, and never lock funds you need within the next month. If the protocol pauses deposits or changes terms, unwind rather than chase it.`;
}

function cadenceStep(group: string): string {
  const activity =
    group === 'trading'
      ? 'the trades'
      : group === 'credit'
        ? 'the supply and borrow cycle'
        : group === 'yield'
          ? 'deposits and claims'
          : group === 'staking'
            ? 'the stake and any restaking'
            : group === 'bridge'
              ? 'the transfers'
              : group === 'rwa'
                ? 'the position and any redemptions'
                : group === 'cex'
                  ? 'the trades'
                  : 'the activity';
  return `Spread ${activity} over 3–4 weeks, 2–3 sessions a week, instead of one burst: a steady footprint reads as real use, and a single-day burst reads as a sybil run.`;
}

function trackStep(p: Protocol, group: string): string {
  const what =
    group === 'trading'
      ? 'every trade — date, market, side, size, fill price, transaction hash'
      : group === 'credit'
        ? 'every supply, borrow and repayment — date, asset, amount, collateral ratio, transaction hash'
        : group === 'yield'
          ? 'every deposit and claim — date, vault name, share token received, amount, transaction hash'
          : group === 'staking'
            ? 'every stake, restake and claim — date, amount, receipt token, unstaking delay, transaction hash'
            : group === 'bridge'
              ? 'every bridge transfer — date, source and destination chain, amount, fee, arrival time, transaction hash'
              : group === 'rwa'
                ? 'every position and redemption — date, asset, amount, yield received, transaction hash'
                : group === 'cex'
                  ? 'every trade and earn position — date, market, size, fee, transaction or order id'
                  : 'every action — date, amount, chain, transaction hash';
  const watchFor =
    group === 'trading'
      ? 'new markets, seasons or announcements'
      : group === 'credit' || group === 'yield'
        ? 'new vaults, seasons or announcements'
        : group === 'staking'
          ? 'new options, seasons or announcements'
          : group === 'bridge'
            ? 'new routes, seasons or announcements'
            : group === 'rwa'
              ? 'new offerings, seasons or announcements'
              : 'new products or announcements';
  return `Keep a one-line log of ${what} on ${p.name}, and check weekly for ${watchFor}. A farm you cannot reconstruct is a farm you cannot defend.`;
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

  const curated = curatedPlan(p, size, chain, gas);
  if (curated !== null) {
    steps.push(curated.setup, ...curated.actions);
  } else {
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
  }

  steps.push(cadenceStep(group));
  steps.push(trackStep(p, group));
  steps.push(verifyStep(p));
  steps.push(exitStep(p));
  return steps.slice(0, 8);
}
