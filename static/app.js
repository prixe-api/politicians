const REFRESH_MS = 5 * 60 * 1000;
const RETRY_DELAYS_MS = [4000, 8000, 15000];

const state = {
  transactions: [],
  groups: [],
  txToGroup: [],
  currentGroupIndex: 0,
  playing: true,
  rotationTimer: null,
  activeYear: null,
  politicianFilter: null,       // slug or substring filter for /api/latest
  politicianFilterName: null,   // display name for the chip
  dateFilter: null,             // YYYY-MM-DD transaction date filter
  assetFilter: null,            // asset slug (e.g. "ishares_bitcoin_trust_etf")
  assetFilterName: null,        // human display name, derived from response
};

// ---- Formatting ----
const fmt = (n) => {
  if (!n && n !== 0) return '$?';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
};
function formatMax(max) {
  if (!max && max !== 0) return '—';
  return fmt(max);
}
function netAmount(v) {
  if (!v) return '$0';
  return `${v > 0 ? '+' : '-'}${fmt(Math.abs(v))}`;
}
function shortName(full) {
  const cleaned = (full || '').replace(/^Hon\.?\s+/i, '');
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}. ${parts[parts.length - 1].toUpperCase()}`;
  return cleaned.toUpperCase();
}
function actionLabel(t) {
  switch (t.transaction_type) {
    case 'purchase': return 'ACQUIRED';
    case 'sale': return 'SOLD';
    case 'sale_partial': return 'SOLD (PARTIAL)';
    case 'exchange': return 'EXCHANGED';
    default: return (t.transaction_type || '?').toUpperCase();
  }
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Matches the backend's slugify: lowercase, collapse non-alphanum runs to _
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ---- API ----
async function fetchJSON(url) {
  const r = await fetch(url);
  let body = null;
  try { body = await r.json(); } catch (_) {}
  if (!r.ok) {
    const err = new Error(pickMsg(body, r.status));
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return body;
}
function pickMsg(body, status) {
  if (!body) return `HTTP ${status}`;
  const d = body.detail;
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object') {
    return d.error || d.message || JSON.stringify(d);
  }
  return body.error || `HTTP ${status}`;
}
function isTransient(err) {
  if (!err) return false;
  if ([429, 502, 503, 504].includes(err.status)) return true;
  return /timed out|upstream|prepar|network/i.test(err.message || '');
}

// ---- Loading + Error UI ----
function renderLoading(label, sub) {
  const lot = document.getElementById('lot');
  lot.className = 'dialog';
  lot.innerHTML = `
    <div class="loading">
      <div class="loading-label">${escapeHTML(label)}<span class="dots"></span></div>
      <div class="progress"><div class="progress-bar"></div></div>
      <div class="loading-sub">${escapeHTML(sub || '')}</div>
    </div>
  `;
}
function renderError(message, sub) {
  const lot = document.getElementById('lot');
  lot.className = 'dialog';
  lot.innerHTML = `
    <div class="error">
      <div>! ${escapeHTML(message)}</div>
      ${sub ? `<div class="loading-sub" style="color:var(--cream);opacity:.7">${escapeHTML(sub)}</div>` : ''}
    </div>
  `;
}
function setFallbackNote(data) {
  const el = document.getElementById('fallback-note');
  if (data && data.fallback && data.requested_year && data.year) {
    el.textContent = `${data.requested_year} NOT READY — SHOWING ${data.year}`;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

// ---- Rendering ----
const ASSET_TYPE_LABELS = {
  ST: 'STOCK',           OP: 'OPTION',           CS: 'CORP BOND',
  GS: 'GOVT BOND',       MF: 'MUTUAL FUND',      ET: 'ETF',
  OT: 'OTHER',           HN: 'HEDGE FUND',       PS: 'PARTNERSHIP',
  RS: 'RESTRICTED',      BA: 'BANK ACCOUNT',     FA: 'FOREX/FUTURES',
  SA: 'SAVINGS',         VS: 'VAR SECURITY',     VA: 'VAR ANNUITY',
  DN: 'DIGITAL ASSET',   CT: 'CRYPTO',           FI: 'FIXED INCOME',
  IF: 'INDEX FUND',
};
const TYPE_SHORT_FE = {
  OP: 'OPT', CS: 'BND', GS: 'GBND', MF: 'FUND', ET: 'ETF', HN: 'HF',
  PS: 'PS', RS: 'RS', BA: 'BANK', FA: 'FX', SA: 'SAV', VS: 'VAR',
  VA: 'ANN', DN: 'DIG', CT: 'CRYP', FI: 'FI', IF: 'IDX',
};

function tickerOf(t) {
  if (!t) return '?';
  const type = (t.asset_type || '').toUpperCase();
  if (t.ticker) {
    const base = t.ticker.toUpperCase();
    if (type === 'ST' || !TYPE_SHORT_FE[type]) return base.slice(0, 8);
    return (base.slice(0, 5) + '-' + TYPE_SHORT_FE[type]).slice(0, 10);
  }
  const first = (t.asset_name || '?').replace(/[^A-Za-z0-9]/g, ' ').trim().split(/\s+/)[0] || '?';
  return first.toUpperCase().slice(0, 10);
}

function assetHeadline(t) {
  if (t.ticker) return t.ticker.toUpperCase();
  const first = (t.asset_name || '?').replace(/[^A-Za-z0-9]/g, ' ').trim().split(/\s+/)[0] || '?';
  return first.toUpperCase().slice(0, 12);
}

function assetSubtitle(t) {
  const type = (t.asset_type || '').toUpperCase();
  const label = ASSET_TYPE_LABELS[type];
  const name = t.asset_name || '';
  if (label && type !== 'ST') return `[${label}] ${name}`.trim();
  return name;
}

function renderGroup(groupIndex) {
  const group = state.groups[groupIndex];
  if (!group || !group.length) return;
  state.currentGroupIndex = groupIndex;

  const primary = group[0];
  const lot = document.getElementById('lot');
  const purchases = group.filter(t => t.transaction_type === 'purchase');
  const sales = group.filter(t => (t.transaction_type || '').startsWith('sale'));
  const dirCls = purchases.length && !sales.length ? 'buy'
    : sales.length && !purchases.length ? 'sell'
    : '';
  lot.className = 'dialog ' + dirCls;

  if (group.length === 1) {
    const t = primary;
    lot.innerHTML = `
      <div class="lot-politician" data-slug="${escapeHTML(t.politician_slug || '')}" data-name="${escapeHTML(t.politician || '')}">
        ${escapeHTML(t.politician || 'UNKNOWN')}${t.state_district ? `<span class="district">${escapeHTML(t.state_district)}</span>` : ''}
      </div>
      <div class="lot-action">${escapeHTML(actionLabel(t))}</div>
      <div class="lot-ticker">${escapeHTML(assetHeadline(t))}</div>
      <div class="lot-asset">${escapeHTML(assetSubtitle(t))}</div>
      <div class="lot-amount">&#9830; UP TO ${escapeHTML(formatMax(t.amount_max))}</div>
      <div class="lot-date">ON ${escapeHTML(t.transaction_date || '?')} &middot; FILED ${escapeHTML(t.filing_date || '?')}</div>
    `;
  } else {
    const totalMax = group.reduce((s, t) => s + (t.amount_max || 0), 0);
    const buyList = purchases.slice(0, 5).map(t => tickerOf(t)).join(', ') + (purchases.length > 5 ? '\u2026' : '');
    const sellList = sales.slice(0, 5).map(t => tickerOf(t)).join(', ') + (sales.length > 5 ? '\u2026' : '');
    lot.innerHTML = `
      <div class="lot-politician" data-slug="${escapeHTML(primary.politician_slug || '')}" data-name="${escapeHTML(primary.politician || '')}">
        ${escapeHTML(primary.politician || 'UNKNOWN')}${primary.state_district ? `<span class="district">${escapeHTML(primary.state_district)}</span>` : ''}
      </div>
      <div class="lot-action">${escapeHTML(String(group.length))} TRADES</div>
      <div class="group-lines">
        ${purchases.length ? `<div class="gline buy"><span class="gdir">&#9650; BUY</span> ${escapeHTML(buyList)}</div>` : ''}
        ${sales.length ? `<div class="gline sell"><span class="gdir">&#9660; SELL</span> ${escapeHTML(sellList)}</div>` : ''}
      </div>
      <div class="lot-amount">&#9830; UP TO ${escapeHTML(formatMax(totalMax))} TOTAL</div>
      <div class="lot-date">ON ${escapeHTML(primary.transaction_date || '?')} &middot; FILED ${escapeHTML(primary.filing_date || '?')}</div>
    `;
  }

  document.getElementById('lot-num').textContent = String(groupIndex + 1).padStart(3, '0');

  if (window.Scene && typeof window.Scene.setLot === 'function') {
    window.Scene.setLot(group);
  }

  highlightGroup(groupIndex);
}

function renderFilingList() {
  const list = document.getElementById('filing-list');
  if (!state.transactions.length) {
    list.innerHTML = '<li class="filing"><span style="opacity:.6">— NO FILINGS —</span></li>';
    return;
  }
  list.innerHTML = state.transactions.map((t, i) => {
    const isBuy = t.transaction_type === 'purchase';
    const isSell = (t.transaction_type || '').startsWith('sale');
    const cls = isBuy ? 'buy' : isSell ? 'sell' : '';
    const sigil = isBuy ? '\u25B2' : isSell ? '\u25BC' : '\u25C6';
    return `
      <li class="filing ${cls}" data-index="${i}">
        <span class="f-sigil">${sigil}</span>
        <span class="f-name" data-slug="${escapeHTML(t.politician_slug || '')}" data-name="${escapeHTML(t.politician || '')}">${escapeHTML(shortName(t.politician))}</span>
        <span class="f-ticker">${escapeHTML(tickerOf(t))}</span>
        <span class="f-amt">&#8804;${escapeHTML(formatMax(t.amount_max))}</span>
      </li>
    `;
  }).join('');
}

function highlightGroup(groupIndex) {
  document.querySelectorAll('.filing.current').forEach(el => el.classList.remove('current'));
  let firstIdx = -1;
  state.txToGroup.forEach((g, i) => {
    if (g === groupIndex) {
      if (firstIdx < 0) firstIdx = i;
      const el = document.querySelector(`.filing[data-index="${i}"]`);
      if (el) el.classList.add('current');
    }
  });
  if (firstIdx >= 0) {
    const el = document.querySelector(`.filing[data-index="${firstIdx}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// ---- Fetch with retries and friendly UI ----
async function loadLatest(options = {}) {
  const { silent = false } = options;
  const polParam = state.politicianFilter
    ? `&politician=${encodeURIComponent(state.politicianFilter)}`
    : '';
  const dateParam = state.dateFilter
    ? `&start_date=${state.dateFilter}&end_date=${state.dateFilter}`
    : '';
  const assetParam = state.assetFilter
    ? `&asset_slug=${encodeURIComponent(state.assetFilter)}`
    : '';
  const url = `/api/latest?limit=100&pool=800${polParam}${dateParam}${assetParam}`;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (!silent) {
      if (attempt === 0) {
        renderLoading('FETCHING HOUSE LEDGER', 'INITIAL FETCH CAN TAKE ~20s. HANG TIGHT.');
      } else {
        renderLoading(
          `RETRYING (${attempt}/${RETRY_DELAYS_MS.length})`,
          'UPSTREAM SCRAPER IS WARMING — TRYING AGAIN.'
        );
      }
    }
    try {
      const data = await fetchJSON(url);
      applyLatest(data);
      return data;
    } catch (err) {
      if (attempt < RETRY_DELAYS_MS.length && isTransient(err)) {
        if (!silent) await countdown(RETRY_DELAYS_MS[attempt], attempt);
        continue;
      }
      if (!silent) {
        renderError(
          err.message || 'UNKNOWN ERROR',
          state.transactions.length
            ? ''
            : 'PRIXE UPSTREAM IS UNAVAILABLE. CHECK YOUR API KEY TIER (PRO+ REQUIRED) OR TRY A DIFFERENT YEAR.'
        );
      }
      throw err;
    }
  }
}

async function countdown(ms, attemptIndex) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const remain = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    const sub = document.querySelector('#lot .loading-sub');
    if (sub) sub.textContent = `RETRY IN ${remain}s (try ${attemptIndex + 2} of ${RETRY_DELAYS_MS.length + 1})`;
    await sleep(Math.min(250, Math.max(50, end - Date.now())));
  }
}

function groupTransactions(txs) {
  const map = new Map();
  const order = [];
  const txToGroup = [];
  for (const t of txs) {
    const key = `${t.politician_slug || t.politician || '?'}|${t.transaction_date || '?'}`;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key).push(t);
    txToGroup.push(order.length - 1);
  }
  return { groups: order.map(k => map.get(k)), txToGroup };
}

function applyLatest(data) {
  state.transactions = data.transactions || [];
  state.activeYear = data.year;
  const { groups, txToGroup } = groupTransactions(state.transactions);
  state.groups = groups;
  state.txToGroup = txToGroup;

  // Pick up human-friendly names from the results if we're filtered
  if (state.politicianFilter && state.transactions.length) {
    state.politicianFilterName = state.transactions[0].politician || state.politicianFilter;
  }
  if (state.assetFilter && state.transactions.length) {
    const t = state.transactions[0];
    state.assetFilterName = t.asset_name || t.ticker || state.assetFilter;
  }
  renderFilterChip();

  setFallbackNote(data);
  renderFilingList();
  if (state.groups.length) {
    renderGroup(Math.min(state.currentGroupIndex, state.groups.length - 1));
  } else {
    renderError('NO FILINGS RETURNED', 'TRY A DIFFERENT YEAR FROM THE SELECTOR ABOVE.');
  }
}

// ---- Holdings modal ----
async function openHoldings(identifier, displayName) {
  const modal = document.getElementById('modal');
  const body = modal.querySelector('.modal-body');
  modal.classList.add('open');
  body.innerHTML = `
    <div class="loading">
      <div class="loading-label">LOADING DISCLOSURES<span class="dots"></span></div>
      <div class="progress"><div class="progress-bar"></div></div>
      <div class="loading-sub">CAN TAKE ~15s FOR UNCACHED POLITICIANS</div>
    </div>`;
  const year = state.activeYear || '';
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const q = new URLSearchParams({ politician: identifier });
      if (year) q.set('year', year);
      const data = await fetchJSON(`/api/holdings?${q}`);
      body.innerHTML = renderHoldings(displayName, data, identifier);
      return;
    } catch (err) {
      if (attempt < RETRY_DELAYS_MS.length && isTransient(err)) {
        const sub = body.querySelector('.loading-sub');
        if (sub) sub.textContent =
          `UPSTREAM SLOW — RETRY ${attempt + 1}/${RETRY_DELAYS_MS.length} IN ${Math.round(RETRY_DELAYS_MS[attempt] / 1000)}s`;
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      body.innerHTML = `<div class="error">ERROR: ${escapeHTML(err.message)}</div>`;
      return;
    }
  }
}

function renderHoldings(name, data, identifier) {
  // Sort by total disclosed activity so round-trips don't fall to the bottom
  const activity = (data.activity || []).slice().sort((a, b) => {
    const at = (a.gross_purchased_midpoint || 0) + (a.gross_sold_midpoint || 0);
    const bt = (b.gross_purchased_midpoint || 0) + (b.gross_sold_midpoint || 0);
    return bt - at;
  });
  const rows = activity.map(a => {
    const gp = a.gross_purchased_midpoint || 0;
    const gs = a.gross_sold_midpoint || 0;
    const net = a.net_activity_midpoint || 0;
    const roundTrip = (a.purchase_count || 0) > 0 && (a.sale_count || 0) > 0;
    const cls = [
      net > 0 ? 'buy' : net < 0 ? 'sell' : '',
      roundTrip ? 'roundtrip' : '',
    ].filter(Boolean).join(' ');
    return `
      <tr class="${cls}">
        <td>${escapeHTML(a.ticker || '—')}</td>
        <td class="a-name">${escapeHTML(a.asset_name || '')}</td>
        <td class="a-count">${a.purchase_count || 0}B / ${a.sale_count || 0}S${roundTrip ? ' <span class="rt" title="Round-trip: bought and sold in this period">\u21C4</span>' : ''}</td>
        <td class="a-bought">${gp ? escapeHTML(fmt(gp)) : '—'}</td>
        <td class="a-sold">${gs ? escapeHTML(fmt(gs)) : '—'}</td>
        <td class="a-net">${escapeHTML(netAmount(net))}</td>
      </tr>
    `;
  }).join('');
  const slugForLink = identifier || data.politician || '';
  return `
    <h2>${escapeHTML(name || data.politician || 'POLITICIAN')}</h2>
    <div class="modal-actions">
      <button class="btn btn-primary" data-view-latest="${escapeHTML(slugForLink)}" data-view-name="${escapeHTML(name || '')}">&#9830; VIEW LATEST TRADES</button>
    </div>
    <div class="caveat">&#9733; DISCLOSED TRADING ACTIVITY (${data.year || ''}) &mdash; NOT A PORTFOLIO BALANCE. &#8644; = ROUND-TRIP (BOUGHT &amp; SOLD)</div>
    <table class="holdings">
      <thead><tr>
        <th>TICKER</th><th>ASSET</th><th>COUNT</th>
        <th class="a-bought">BOUGHT</th><th class="a-sold">SOLD</th><th>NET</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="6" style="text-align:center;padding:20px;">NO DISCLOSURES IN ${data.year || ''}</td></tr>`}</tbody>
    </table>
  `;
}

// ---- Rotation (scene-driven) ----
function advanceLot() {
  if (!state.groups.length) return;
  const next = (state.currentGroupIndex + 1) % state.groups.length;
  renderGroup(next);
}

// ---- Event wiring ----
document.addEventListener('click', (e) => {
  const viewLatestBtn = e.target.closest('[data-view-latest]');
  if (viewLatestBtn) {
    const slug = viewLatestBtn.dataset.viewLatest;
    const name = viewLatestBtn.dataset.viewName || slug;
    setPoliticianFilter(slug, name);
    document.getElementById('modal').classList.remove('open');
    return;
  }
  const nameEl = e.target.closest('[data-name]');
  if (nameEl && nameEl.dataset.name) {
    openHoldings(nameEl.dataset.slug || nameEl.dataset.name, nameEl.dataset.name);
    return;
  }
  const filing = e.target.closest('.filing[data-index]');
  if (filing) {
    const txIdx = parseInt(filing.dataset.index, 10);
    const t = state.transactions[txIdx];
    if (t) {
      const slug = t.politician_slug || t.politician || '';
      const date = t.transaction_date || '';
      const assetRaw = t.asset_name || t.ticker || '';
      const assetSlug = slugify(assetRaw);
      if (slug && /^\d{4}-\d{2}-\d{2}$/.test(date) && assetSlug) {
        setPoliticianFilter(slug, t.politician || slug, date, assetSlug, assetRaw);
        return;
      }
    }
    // Fallback: just play the scene if we can't build a clean URL
    const gIdx = state.txToGroup[txIdx];
    if (gIdx !== undefined) renderGroup(gIdx);
  }
});

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal').classList.remove('open');
});
document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') e.target.classList.remove('open');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.getElementById('modal').classList.remove('open');
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  if (e.key === 'ArrowLeft' && state.groups.length)
    renderGroup((state.currentGroupIndex - 1 + state.groups.length) % state.groups.length);
  if (e.key === 'ArrowRight' && state.groups.length)
    renderGroup((state.currentGroupIndex + 1) % state.groups.length);
  if (e.key === ' ') { e.preventDefault(); document.getElementById('pause').click(); }
});
document.getElementById('pause').addEventListener('click', () => {
  state.playing = !state.playing;
  document.getElementById('pause').textContent = state.playing ? 'PAUSE' : 'PLAY';
  if (state.playing && window.Scene && window.Scene.isIdle && window.Scene.isIdle()) {
    // Resume: kick off the next lot
    advanceLot();
  }
});
document.getElementById('prev').addEventListener('click', () => {
  if (!state.groups.length) return;
  renderGroup((state.currentGroupIndex - 1 + state.groups.length) % state.groups.length);
});
document.getElementById('next').addEventListener('click', () => {
  if (!state.groups.length) return;
  renderGroup((state.currentGroupIndex + 1) % state.groups.length);
});

// ---- Filter chip + hash routing ----
function truncate(s, max) {
  s = String(s || '');
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

function renderFilterChip() {
  const chip = document.getElementById('filter-chip');
  const name = document.getElementById('filter-name');
  if (state.politicianFilter || state.dateFilter || state.assetFilter) {
    const parts = [];
    if (state.politicianFilter) {
      parts.push((state.politicianFilterName || state.politicianFilter).toUpperCase());
    }
    if (state.dateFilter) parts.push(state.dateFilter);
    if (state.assetFilter) {
      parts.push(truncate(state.assetFilterName || state.assetFilter, 36));
    }
    name.textContent = parts.join(' \u00B7 ');
    chip.hidden = false;
  } else {
    chip.hidden = true;
  }
}

function setPoliticianFilter(slugOrName, displayName, date, assetSlug, assetName) {
  const v = (slugOrName || '').trim();
  if (!v) { clearPoliticianFilter(); return; }
  state.politicianFilter = v;
  state.politicianFilterName = displayName || v;
  state.dateFilter = (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) ? date : null;
  state.assetFilter = assetSlug ? assetSlug : null;
  state.assetFilterName = assetName || null;
  state.currentGroupIndex = 0;
  renderFilterChip();
  const datePart = state.dateFilter ? `/${state.dateFilter.replace(/-/g, '_')}` : '';
  const assetPart = state.assetFilter ? `/${encodeURIComponent(state.assetFilter)}` : '';
  const hash = `#/politician/${encodeURIComponent(v)}${datePart}${assetPart}`;
  if (window.location.hash !== hash) {
    window.location.hash = hash; // triggers hashchange → applyRoute → loadLatest
  } else {
    loadLatest().catch(() => {});
  }
}

function clearPoliticianFilter() {
  state.politicianFilter = null;
  state.politicianFilterName = null;
  state.dateFilter = null;
  state.assetFilter = null;
  state.assetFilterName = null;
  state.currentGroupIndex = 0;
  renderFilterChip();
  if (window.location.hash) {
    window.location.hash = ''; // triggers hashchange
  } else {
    loadLatest().catch(() => {});
  }
}

function parseHash() {
  const h = window.location.hash || '';
  // Accepts: #politician=<slug>, #/politician/<slug>, #/politician/<slug>/<date>,
  //          #/politician/<slug>/<date>/<asset_slug>, #/politician/<slug>/<asset_slug>
  const m = h.match(/^#\/?politician[\/=]([^/&?#]+)(?:\/([^/&?#]+))?(?:\/([^/&?#]+))?/i);
  if (!m) return null;
  const slug = decodeURIComponent(m[1]);
  let date = null;
  let assetSlug = null;
  if (m[2]) {
    const raw = decodeURIComponent(m[2]).replace(/[_/]/g, '-');
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) date = raw;
    else assetSlug = decodeURIComponent(m[2]);
  }
  if (m[3] && !assetSlug) assetSlug = decodeURIComponent(m[3]);
  return { slug, date, assetSlug };
}

function applyRoute({ fetch = true } = {}) {
  const parsed = parseHash();
  if (parsed) {
    state.politicianFilter = parsed.slug;
    state.politicianFilterName = state.politicianFilterName || parsed.slug;
    state.dateFilter = parsed.date;
    state.assetFilter = parsed.assetSlug;
    // Clear stale display name; will be refilled from response
    if (!parsed.assetSlug) state.assetFilterName = null;
  } else {
    state.politicianFilter = null;
    state.politicianFilterName = null;
    state.dateFilter = null;
    state.assetFilter = null;
    state.assetFilterName = null;
  }
  state.currentGroupIndex = 0;
  renderFilterChip();
  if (fetch) loadLatest().catch(() => {});
}

window.addEventListener('hashchange', () => applyRoute());

document.getElementById('filter-clear').addEventListener('click', () => clearPoliticianFilter());

// ---- Init ----
(async function init() {
  const sceneEl = document.getElementById('scene');
  if (sceneEl && window.Scene) {
    window.Scene.init(sceneEl);
    sceneEl.addEventListener('scene-done', () => {
      if (state.playing) advanceLot();
    });
  }
  applyRoute({ fetch: false }); // pick up initial hash silently
  try {
    await loadLatest();
    setInterval(() => { loadLatest({ silent: true }).catch(console.error); }, REFRESH_MS);
  } catch (_err) {
    // renderError already called
  }
})();
