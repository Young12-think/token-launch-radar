/* Token Launch Radar — page logic. Reads window.RADAR (data.js, written by
   main.ts from the same board), renders the board, the filters and the detail
   view. No network, no framework, no external assets. */

(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:20px">data.js did not load.</p>'; return; }
  var rows = R.rows;
  var meta = R.meta;

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function pct(x) {
    if (x === null || x === undefined) return '—';
    var s = (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
    return s;
  }
  function pctCls(x) { return x === null ? 'flat' : x > 0 ? 'up' : x < 0 ? 'down' : 'flat'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ---- integrity strip: build-time checks + a live recompute ---- */
  var val = meta.validation || null;
  function recomputeCheck() {
    // Re-derive the top 5 implied values from the curve the page itself carries
    // (slope + intercept + momentum factor, all in data.js) and compare with the
    // stored values. A mismatch means the board and its method disagree.
    var ok = 0, n = Math.min(5, rows.length);
    for (var i = 0; i < n; i++) {
      var r = rows[i];
      var re = Math.exp(r.curve_intercept + r.curve_slope * Math.log(r.tvl_usd)) * r.momentum_factor;
      if (Math.abs(re - r.implied_value_usd) / r.implied_value_usd < 0.005) ok++;
    }
    return { label: 'Dashboard recompute', detail: 'top ' + n + ' implied values re-derived from the curve in data.js: ' + ok + '/' + n + ' match', pass: ok === n };
  }
  var checks = (meta.integrity || []).slice();
  checks.push(recomputeCheck());
  $('integrityChecks').innerHTML = checks.map(function (c) {
    return '<div class="check-chip ' + (c.pass ? 'ok' : 'bad') + '"><b>' + (c.pass ? 'PASS' : 'FAIL') + ' · ' + esc(c.label) + '</b><span>' + esc(c.detail) + '</span></div>';
  }).join('');
  $('integrityNote').textContent = val
    ? 'Model: ' + val.base_model + '. Held-out on the ' + val.fit_n + ' launchable peers: leave-one-out median log error ' + val.loo.median_log_error + ' (within-3x ' + val.loo.within_3x_pct + '%), walk-forward ' + val.walk_forward.median_log_error + ' (within-3x ' + val.walk_forward.within_3x_pct + '%). Cross-check on all priced peers: leave-one-out within-3x ' + val.crosscheck_loo.within_3x_pct + '%, walk-forward ' + val.crosscheck_walk_forward.within_3x_pct + '%. The v2 estimator on the launchable peers scored leave-one-out within-3x ' + val.v2_primary_loo.within_3x_pct + '%, walk-forward ' + val.v2_primary_walk_forward.within_3x_pct + '%. The v1 category-median baseline scored ' + val.baseline_loo_median_log_error + ' / ' + val.baseline_wf_median_log_error + '. Dropped after failing both tests: seasoning, chain breadth. Momentum kept at full strength.'
    : '';

  /* ---- top stats ---- */
  var top = rows[0];
  $('topStats').innerHTML =
    '<div class="stat"><span>Ranked</span><b>' + rows.length + '</b></div>' +
    '<div class="stat"><span>Watchlist</span><b>' + meta.watchlist + '/' + meta.watchlist + '</b></div>' +
    '<div class="stat"><span>Median multiple</span><b>' + meta.global_multiple.median + 'x</b></div>' +
    '<div class="stat"><span>Top implied</span><b>' + money(top.implied_value_usd) + '</b></div>' +
    '<div class="stat"><span>Set aside</span><b>' + meta.set_aside + '</b></div>';

  /* ---- filter options ---- */
  var cats = [], chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  cats.forEach(function (c) { $('fCat').appendChild(new Option(c, c)); });
  chains.forEach(function (c) { $('fChain').appendChild(new Option(c, c)); });

  var state = { q: '', cat: '', chain: '', watch: false, sort: 'implied', sel: null };

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    if (state.sort === 'tvl') list.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (state.sort === 'momentum') list.sort(function (a, b) { return (b.change_7d || -999) - (a.change_7d || -999); });
    else if (state.sort === 'age') list.sort(function (a, b) { return (b.age_days || 0) - (a.age_days || 0); });
    else if (state.sort === 'readiness') list.sort(function (a, b) { return b.readiness - a.readiness; });
    else list.sort(function (a, b) { return a.rank - b.rank; });
    return list;
  }

  function renderBoard() {
    var list = filtered();
    var html = '';
    list.forEach(function (r) {
      var span = r.bull_usd - r.bear_usd;
      var basePos = span > 0 ? Math.round(((r.base_fdv_usd - r.bear_usd) / span) * 100) : 50;
      basePos = Math.max(0, Math.min(100, basePos));
      html += '<tr data-slug="' + esc(r.slug) + '"' + (state.sel === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + (r.watchlist ? '<span class="wl">WATCHLIST</span>' : '') + '</td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctCls(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="range-cell"><div class="range-bar"><i style="left:0%;width:100%"></i><b style="left:' + basePos + '%"></b></div>' +
        '<div class="range-num">' + money(r.bear_usd) + ' — ' + money(r.bull_usd) + '</div></td>' +
        '<td class="farm"><span class="verdict v-' + r.farm_verdict.toLowerCase() + '">' + r.farm_verdict + '</span> <span class="farm-h">$' + r.farm_cost_per_hour_usd + '/h</span></td>' +
        '<td class="num"><span class="meter"><i style="width:' + r.readiness + '%"></i></span>' + r.readiness + '</td>' +
        '</tr>';
    });
    $('boardBody').innerHTML = html || '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:18px">No protocols match the filter.</td></tr>';
    $('rowCount').textContent = list.length + ' of ' + rows.length + ' rows';
  }

  function renderDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    if (!r) { $('detail').hidden = true; state.sel = null; renderBoard(); return; }
    state.sel = slug;
    $('detail').hidden = false;
    $('dName').textContent = '#' + r.rank + ' — ' + r.name;
    $('dSub').textContent = (r.category || 'Uncategorised') + ' · ' + r.chains.join(', ') + ' · TVL ' + money(r.tvl_usd) +
      ' · 7d ' + pct(r.change_7d) + ' · tracked ' + (r.age_days === null ? 'date unknown' : r.age_days + ' days') +
      (r.watchlist ? ' · on the house watchlist' : ' · below the $50M watchlist floor');
    $('dMath').innerHTML =
      '<dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd>' +
      '<dt>Size curve value</dt><dd>' + money(r.curve_value_usd) + '</dd>' +
      '<dt>Size curve</dt><dd>log(mcap) = ' + r.curve_intercept + ' + ' + r.curve_slope + '·log(TVL)</dd>' +
      '<dt>Category median (cross-check)</dt><dd>' + r.category_multiple + 'x · ' + r.multiple_level + ' · ' + r.category_peer_count + ' peers — tested, lost, prices nothing</dd>' +
      '<dt>Momentum factor (full strength)</dt><dd>×' + r.momentum_factor.toFixed(3) + '</dd>' +
      '<dt>Implied launch value</dt><dd>' + money(r.implied_value_usd) + '</dd>' +
      '<dt>Bear — Bull range</dt><dd>' + money(r.bear_usd) + ' — ' + money(r.bull_usd) + '</dd>' +
      '<dt>Readiness</dt><dd>' + r.readiness + ' / 100</dd>';
    $('dMultNote').textContent = r.multiple_note ? 'Why this cross-check: ' + r.multiple_note : '';
    $('dLevel').textContent = 'Seasoning and chain breadth were dropped after failing both held-out tests; momentum survived at full strength. ' + (r.plausibility_reasons.length
      ? 'Launch plausibility ' + r.plausibility + 'x — ' + r.plausibility_reasons.join('; ') + '.'
      : 'No structural discount: nothing in the record marks this protocol a wrapped, bridged or exchange product.');
    var fv = r.farm_verdict;
    $('dFarm').innerHTML =
      '<dt>Farm verdict</dt><dd>' + fv + '</dd>' +
      '<dt>Plan gas cost</dt><dd>$' + r.farm_cost_usd.toFixed(2) + ' total · $' + r.farm_cost_per_hour_usd.toFixed(2) + '/h of active work</dd>' +
      '<dt>Position deployed</dt><dd>$' + r.farm_position_usd.toLocaleString() + ' over ' + r.farm_sessions + ' sessions / ' + r.farm_hours + 'h in 4 weeks</dd>' +
      '<dt>Gas vs position</dt><dd>' + (r.farm_cost_usd / r.farm_position_usd * 100).toFixed(1) + '%</dd>';
    $('dFarmNote').textContent = fv === 'FARM'
      ? 'FARM: gas under 10% of the position — cheap to run. This prices the cost only; the snapshot records no yield, so no return is claimed.'
      : fv === 'MARGINAL'
        ? 'MARGINAL: gas is 10–25% of the position — costly. Consider a cheaper chain or a bigger size before running the plan.'
        : 'SKIP: gas over 25% of the position — the gas alone eats the case. Use a cheaper chain or a bigger size, or do not farm this one.';
    var ph = '<tr><th>Peer (tokenised)</th><th class="num">Market-cap / TVL</th><th class="num">TVL</th></tr>';
    r.peers.forEach(function (p) {
      var full = null;
      for (var j = 0; j < R.comps.length; j++) if (R.comps[j].name === p.name) { full = R.comps[j]; break; }
      ph += '<tr><td>' + esc(p.name) + '</td><td class="num">' + p.multiple.toFixed(2) + 'x</td><td class="num">' + (full ? money(full.tvl_usd) : '—') + '</td></tr>';
    });
    $('dPeers').innerHTML = ph;
    var sh = '';
    r.farm_steps.forEach(function (s) { sh += '<li>' + esc(s) + '</li>'; });
    $('dSteps').innerHTML = sh;
    renderBoard();
    document.getElementById('detail').scrollIntoView({ behavior: 'instant', block: 'start' });
  }

  /* ---- set-aside table ---- */
  var sa = '<tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th>Why it is not ranked</th></tr>';
  R.setAside.forEach(function (s) {
    sa += '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.category || '—') + '</td><td class="num">' + money(s.tvl_usd) + '</td><td>' + esc(s.reason) + '</td></tr>';
  });
  $('setAsideTable').innerHTML = sa;

  /* ---- events ---- */
  $('q').addEventListener('input', function () { state.q = this.value; renderBoard(); });
  $('fCat').addEventListener('change', function () { state.cat = this.value; renderBoard(); });
  $('fChain').addEventListener('change', function () { state.chain = this.value; renderBoard(); });
  $('fWatch').addEventListener('change', function () { state.watch = this.checked; renderBoard(); });
  $('fSort').addEventListener('change', function () { state.sort = this.value; renderBoard(); });
  $('boardBody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) renderDetail(tr.getAttribute('data-slug'));
  });
  $('dClose').addEventListener('click', function () { state.sel = null; $('detail').hidden = true; renderBoard(); });

  /* ---- deep link: #detail=<slug> or #watchlist ---- */
  renderBoard();
  var h = window.location.hash || '';
  var m = h.match(/detail=([A-Za-z0-9\-_]+)/);
  if (m) renderDetail(m[1]);
  else if (h.indexOf('watchlist') >= 0) { state.watch = true; $('fWatch').checked = true; renderBoard(); }
})();
