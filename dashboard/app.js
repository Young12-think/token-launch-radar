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
        '<td class="num"><span class="meter"><i style="width:' + r.readiness + '%"></i></span>' + r.readiness + '</td>' +
        '</tr>';
    });
    $('boardBody').innerHTML = html || '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:18px">No protocols match the filter.</td></tr>';
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
    var mom = r.change_7d === null ? 1 : 1 + Math.min(100, Math.max(-50, r.change_7d)) / 200;
    var sea = r.age_days === null ? 1 : 0.85 + (0.3 * Math.min(r.age_days, 1095)) / 1095;
    var chf = 1 + 0.02 * Math.min(Math.max(r.chains.length - 1, 0), 10);
    $('dMath').innerHTML =
      '<dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd>' +
      '<dt>Peer multiple (median)</dt><dd>' + r.multiple + 'x · ' + r.multiple_level + ' · ' + r.peer_count + ' peers</dd>' +
      '<dt>Base FDV (TVL × multiple)</dt><dd>' + money(r.base_fdv_usd) + '</dd>' +
      '<dt>Momentum factor</dt><dd>×' + mom.toFixed(2) + '</dd>' +
      '<dt>Seasoning factor</dt><dd>×' + sea.toFixed(2) + '</dd>' +
      '<dt>Chain factor</dt><dd>×' + chf.toFixed(2) + '</dd>' +
      '<dt>Implied launch value</dt><dd>' + money(r.implied_value_usd) + '</dd>' +
      '<dt>Bear — Bull range</dt><dd>' + money(r.bear_usd) + ' — ' + money(r.bull_usd) + '</dd>' +
      '<dt>Readiness</dt><dd>' + r.readiness + ' / 100</dd>';
    $('dLevel').textContent = r.plausibility_reasons.length
      ? 'Launch plausibility ' + r.plausibility + 'x — ' + r.plausibility_reasons.join('; ') + '.'
      : 'No structural discount: nothing in the record marks this protocol a wrapped, bridged or exchange product.';
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
