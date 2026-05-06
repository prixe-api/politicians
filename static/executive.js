// Executive Wing — pick a filer from the roster, then walk their disclosure
// as easter eggs scattered across a pixel field. Arrow keys move the player;
// bumping an egg reveals the underlying disclosure row in the info panel.
// Memory budget: only the selected filer's data is loaded at a time, and
// only the current room/page's eggs ever exist as sprite objects (pool of
// at most EGGS_PER_PAGE).
(function () {
  // -------- Constants --------
  const W = 720;
  const H = 360;
  const EGGS_PER_PAGE = 24;       // 4 rows × 6 cols on the field
  const GRID_COLS = 6;
  const GRID_ROWS = 4;
  const PLAYER_SPEED = 90;        // px/sec
  const STREAM_PAGE = 50;

  const ROOMS = ['positions', 'assets', 'income', 'liabilities'];
  const ROOM_TITLES = {
    positions:   'POSITIONS HELD',
    assets:      'ASSETS',
    income:      'INCOME',
    liabilities: 'LIABILITIES',
  };
  const ROOM_HUE = {
    positions:   { egg: '#4a8cd6', eggDk: '#1f4f8a', accent: '#bcd9f4' },
    assets:      { egg: '#e8c547', eggDk: '#a9892e', accent: '#fff4c2' },
    income:      { egg: '#5cae4d', eggDk: '#205a25', accent: '#cfeacb' },
    liabilities: { egg: '#c83a3a', eggDk: '#7a1c1c', accent: '#f4c2c2' },
  };

  const PAL = {
    skyTop:   '#7cb8e0',
    skyBot:   '#e6efe2',
    grass:    '#3c8a3a',
    grassDk:  '#205a25',
    grassLt:  '#5cae4d',
    grassTuft:'#1a4a1c',
    path:     '#c9a76a',
    pathDk:   '#90703f',
    fence:    '#f0e4c3',
    fenceDk:  '#7a6e47',
    wh:       '#f0e7d0',
    whDk:     '#a89a76',
    whRoof:   '#3a4856',
    whWindow: '#7fb8d8',
    leaf:     '#2a6a2a',
    leafDk:   '#0e3416',
    leafLt:   '#4ea64a',
    trunk:    '#5a3a1a',
    ink:      '#0d0d0d',
    paper:    '#ecdca2',
    gold:     '#e8c547',
    goldDk:   '#a9892e',
    red:      '#c83a3a',
    white:    '#f5efd6',
    suits:    ['#1c2a56', '#3a3a3a', '#2a1f1a', '#4a3a2a', '#1f2a1f', '#2a2a3f'],
    suitsDk:  ['#0e1632', '#1a1a1a', '#180f0a', '#2a1f15', '#10180f', '#15151f'],
    skins:    ['#9a9a9a'],
    skinsDk:  ['#6a6a6a'],
    ties:     ['#c83a3a', '#1c4a8c', '#e8c547', '#5a2a8c', '#2a8c5a', '#2a8c8c', '#8c5a2a'],
    hairs:    ['#141414', '#3a2a1a', '#7a5a3a', '#a88860', '#d4b878'],
  };

  // -------- State --------
  let canvas = null;
  let ctx = null;
  let raf = 0;
  let lastT = 0;

  // Roster (summary list, populated by streamFilings())
  let allFilings = [];           // [{filer_slug, filer_name, position_line, total_estimated_value, ...}]
  let filtered = [];
  let lastQuery = '';

  // Active filer + their full disclosure
  let activeFiler = null;        // summary record of selected filer
  let disclosure = null;         // full /api/executive/<slug> response
  let roomItemsByRoom = null;    // { positions:[], assets:[], income:[], liabilities:[] }

  let currentRoom = 'positions';
  let currentPage = 0;
  let eggs = [];                 // sprite pool for current page
  let bumpedIdx = -1;            // index into eggs of the egg the player overlaps

  // Field decoration cache, rebuilt when room changes (one offscreen canvas)
  let bgCache = null;
  let bgCacheRoom = null;

  // Player
  const player = {
    x: W / 2, y: H * 0.7,
    vx: 0, vy: 0,
    walkPhase: 0, walkT: 0,
    facing: 1,                   // 1 right, -1 left
    colors: null,
    scale: 1,
  };
  const keys = Object.create(null); // 'ArrowUp', 'ArrowDown', etc.

  // -------- Hash + RNG (deterministic per slug+room+page) --------
  function hash32(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function pickFromHash(arr, h, salt) {
    return arr[((h ^ salt) >>> 0) % arr.length];
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // -------- Money parsing (mirrors backend's parse_money_value) --------
  // Used solely to rank items by magnitude — the user's experience is
  // better when high-value rows surface on early pages of a long room.
  function parseMoney(s) {
    if (!s || typeof s !== 'string') return 0;
    const txt = s.trim();
    const low = txt.toLowerCase();
    if (!low || low.startsWith('none') || (low.indexOf('less than') >= 0 && low.indexOf('over') < 0)) return 0;
    const re = /\$?([\d,]+(?:\.\d+)?)/g;
    const nums = [];
    let m;
    while ((m = re.exec(txt))) nums.push(parseFloat(m[1].replace(/,/g, '')));
    if (!nums.length) return 0;
    if (low.startsWith('over')) return Math.max(nums[0], 50_000_000);
    if (nums.length >= 2) return (nums[0] + nums[1]) / 2;
    return nums[0];
  }

  function fmtMoney(n) {
    if (!n || !Number.isFinite(n)) return '$0';
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
    return `$${Math.round(n)}`;
  }

  function lastNameOf(name) {
    if (!name) return '?';
    const comma = name.indexOf(',');
    let s = comma > 0 ? name.slice(0, comma) : name;
    s = s.replace(/^(Vice President|President|Hon\.?|Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Senator|Rep\.?)\s+/i, '');
    if (comma < 0) {
      const parts = s.trim().split(/\s+/);
      s = parts[parts.length - 1] || s;
    }
    return s.trim().toUpperCase().slice(0, 14);
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // -------- Schedule → room mapping --------
  // Build the four room arrays once per filer. Each room item carries the
  // metadata needed to render the info panel without keeping the whole
  // schedules object around indefinitely (we keep `disclosure` either way,
  // but the room arrays are what the egg sprites reference).
  function buildRoomItems(d) {
    const sch = (d && d.schedules) || {};
    const positions = (sch.positions || []).map(r => ({
      kind: 'position',
      title: r.description || r.raw || '(unknown)',
      role: r.position || '',
      orgType: r.organization_type || '',
      where: r.city_state || '',
      from: r.from || '',
      to: r.to || '',
      raw: r.raw || '',
      parseQuality: r.parse_quality || '',
      rowNum: r.row != null ? String(r.row) : '',
      scheduleKey: 'positions',
      sortKey: 0,
    }));

    const assetSchedules = ['employment_assets', 'other_assets', 'spouse_employment_assets'];
    const assetRows = [];
    const incomeRows = [];
    for (const k of assetSchedules) {
      for (const r of (sch[k] || [])) {
        const value = r.value || r.amount || '';
        const valueAmt = parseMoney(value);
        assetRows.push({
          kind: 'asset',
          title: r.description || r.raw || '(unknown)',
          ticker: r.ticker || '',
          value,
          valueAmt,
          eif: (r.eif && r.eif !== 'N/A' && r.eif !== 'No') ? r.eif : '',
          incomeType: r.income_type || '',
          incomeAmount: r.income_amount || '',
          spouse: k === 'spouse_employment_assets',
          raw: r.raw || '',
          parseQuality: r.parse_quality || '',
          rowNum: r.row != null ? String(r.row) : '',
          scheduleKey: k,
          sortKey: -valueAmt,
        });
        const ia = r.income_amount;
        if (ia && !/^\s*none/i.test(ia)) {
          incomeRows.push({
            kind: 'income',
            title: r.description || r.raw || '(unknown)',
            ticker: r.ticker || '',
            incomeType: r.income_type || '',
            incomeAmount: ia,
            incomeAmt: parseMoney(ia),
            spouse: k === 'spouse_employment_assets',
            raw: r.raw || '',
            parseQuality: r.parse_quality || '',
            rowNum: r.row != null ? String(r.row) : '',
            scheduleKey: k,
            sortKey: -parseMoney(ia),
          });
        }
      }
    }
    for (const r of (sch.compensation_sources || [])) {
      incomeRows.push({
        kind: 'income',
        title: r.source || r.description || r.raw || '(unknown)',
        incomeType: r.brief_description || '',
        incomeAmount: r.amount || '',
        incomeAmt: parseMoney(r.amount || ''),
        raw: r.raw || '',
        parseQuality: r.parse_quality || '',
        rowNum: r.row != null ? String(r.row) : '',
        scheduleKey: 'compensation_sources',
        sortKey: -parseMoney(r.amount || ''),
      });
    }

    const liabilities = (sch.liabilities || []).map(r => ({
      kind: 'liability',
      title: r.description || r.raw || '(unknown)',
      liabilityType: r.liability_type || '',
      amount: r.amount || '',
      amountVal: parseMoney(r.amount || ''),
      rate: r.rate || '',
      term: r.term || '',
      yearIncurred: r.year_incurred || '',
      raw: r.raw || '',
      parseQuality: r.parse_quality || '',
      rowNum: r.row != null ? String(r.row) : '',
      scheduleKey: 'liabilities',
      sortKey: -parseMoney(r.amount || ''),
    }));

    [positions, assetRows, incomeRows, liabilities].forEach(arr =>
      arr.sort((a, b) => a.sortKey - b.sortKey)
    );

    return {
      positions,
      assets: assetRows,
      income: incomeRows,
      liabilities,
    };
  }

  // -------- Background (per-room) --------
  function buildBackground(room) {
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const g = off.getContext('2d');
    g.imageSmoothingEnabled = false;

    const skyEnd = Math.floor(H * 0.32);
    for (let y = 0; y < skyEnd; y++) {
      const t = y / skyEnd;
      const r = Math.round(0x7c + (0xbf - 0x7c) * t);
      const gg = Math.round(0xb8 + (0xdc - 0xb8) * t);
      const b = Math.round(0xe0 + (0xef - 0xe0) * t);
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(0, y, W, 1);
    }
    g.fillStyle = '#ffe07a'; g.fillRect(590, 28, 24, 24);
    g.fillStyle = '#ffd84a'; g.fillRect(594, 32, 16, 16);
    drawCloud(g, 80, 50);
    drawCloud(g, 280, 35);
    drawCloud(g, 460, 60);

    // Lawn band
    g.fillStyle = PAL.grass;
    g.fillRect(0, skyEnd, W, H - skyEnd);
    const seed = mulberry32(0xC0FFEE ^ hash32(room));
    for (let i = 0; i < 220; i++) {
      const x = Math.floor(seed() * W);
      const y = skyEnd + Math.floor(seed() * (H - skyEnd));
      const which = seed();
      g.fillStyle = which < 0.5 ? PAL.grassDk : (which < 0.85 ? PAL.grassLt : PAL.grassTuft);
      g.fillRect(x, y, 2, 1);
      g.fillRect(x + 1, y - 1, 1, 1);
    }

    drawWhiteHouse(g, W / 2 - 60, skyEnd - 40);
    const hue = ROOM_HUE[room];

    drawTree(g, 36, skyEnd + 20);
    drawTree(g, W - 48, skyEnd + 18);
    drawTree(g, 165, skyEnd + 6);
    drawTree(g, W - 165, skyEnd + 8);

    // Fence
    for (let x = 0; x < W; x += 12) {
      g.fillStyle = PAL.fence;    g.fillRect(x + 2, H - 14, 2, 8);
      g.fillStyle = PAL.fenceDk;  g.fillRect(x + 2, H - 14, 2, 1);
    }
    g.fillStyle = PAL.fence;   g.fillRect(0, H - 8, W, 2);
    g.fillStyle = PAL.fenceDk; g.fillRect(0, H - 8, W, 1);

    // Room banner (top-left)
    const label = ROOM_TITLES[room] || '';
    g.font = `bold 9px "Press Start 2P", monospace`;
    const tw = g.measureText(label).width;
    g.fillStyle = 'rgba(0,0,0,0.65)';
    g.fillRect(8, 8, tw + 14, 18);
    g.fillStyle = hue.accent;
    g.fillRect(8, 8 + 17, tw + 14, 1);
    g.fillStyle = hue.egg;
    g.fillText(label, 15, 18);

    return off;
  }

  function drawCloud(g, x, y) {
    g.fillStyle = '#ffffff';
    g.fillRect(x + 4, y, 18, 4);
    g.fillRect(x, y + 2, 26, 4);
    g.fillRect(x + 6, y + 4, 14, 2);
    g.fillStyle = '#e6efe2';
    g.fillRect(x, y + 5, 26, 1);
  }
  function drawTree(g, x, baseY) {
    g.fillStyle = PAL.trunk;  g.fillRect(x - 2, baseY - 8, 4, 14);
    g.fillStyle = PAL.leafDk; g.fillRect(x - 12, baseY - 30, 24, 6);
    g.fillStyle = PAL.leaf;   g.fillRect(x - 14, baseY - 26, 28, 14);
    g.fillStyle = PAL.leafLt; g.fillRect(x - 10, baseY - 24, 8, 4); g.fillRect(x + 2,  baseY - 22, 6, 3);
    g.fillStyle = PAL.leafDk; g.fillRect(x - 14, baseY - 14, 28, 2);
  }
  function drawWhiteHouse(g, x, y) {
    g.fillStyle = PAL.wh;     g.fillRect(x, y + 14, 120, 30);
    g.fillStyle = PAL.whDk;   g.fillRect(x, y + 43, 120, 2);
    g.fillStyle = PAL.whRoof; g.fillRect(x, y + 12, 120, 3);
    g.fillStyle = PAL.wh;     g.fillRect(x + 48, y + 4, 24, 14);
    g.fillStyle = PAL.whRoof; g.fillRect(x + 46, y + 2, 28, 3); g.fillRect(x + 56, y - 4, 8, 8);
    g.fillStyle = PAL.whDk;   g.fillRect(x + 59, y - 4, 2, 8);
    for (let i = 0; i < 4; i++) {
      g.fillStyle = PAL.whDk; g.fillRect(x + 50 + i * 6, y + 6, 2, 12);
    }
    for (let i = 0; i < 12; i++) {
      const cx = x + 6 + i * 9;
      if (cx >= x + 44 && cx <= x + 76) continue;
      g.fillStyle = PAL.whWindow; g.fillRect(cx, y + 22, 5, 6);
      g.fillStyle = PAL.ink;      g.fillRect(cx, y + 22, 5, 1);
    }
    g.fillStyle = PAL.ink; g.fillRect(x + 59, y - 14, 1, 10);
    g.fillStyle = PAL.red; g.fillRect(x + 60, y - 13, 6, 4);
  }

  // -------- Field bounds --------
  function fieldBounds() {
    const skyEnd = Math.floor(H * 0.32);
    return {
      minX: 16,
      maxX: W - 16,
      minY: skyEnd + 50,
      maxY: H - 16,
    };
  }

  // -------- Egg layout --------
  // Eggs sit in a 6×4 grid inside the field, with deterministic jitter so
  // the layout is stable across re-renders of the same page but varies
  // between filers/rooms/pages.
  function layoutEggs(items, room, pageIdx, slug) {
    const b = fieldBounds();
    const cellW = (b.maxX - b.minX) / GRID_COLS;
    const cellH = (b.maxY - b.minY) / GRID_ROWS;
    const rng = mulberry32(hash32(`${slug}|${room}|${pageIdx}`));
    const out = [];
    for (let i = 0; i < items.length && i < EGGS_PER_PAGE; i++) {
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const cx = b.minX + cellW * (col + 0.5);
      const cy = b.minY + cellH * (row + 0.5);
      const jx = (rng() - 0.5) * cellW * 0.45;
      const jy = (rng() - 0.5) * cellH * 0.45;
      out.push({
        x: cx + jx,
        y: cy + jy,
        item: items[i],
        idx: i,
        bob: rng() * Math.PI * 2, // phase for hovering animation
      });
    }
    return out;
  }

  function pageCount() {
    const total = (roomItemsByRoom && roomItemsByRoom[currentRoom] || []).length;
    return Math.max(1, Math.ceil(total / EGGS_PER_PAGE));
  }

  function refreshPage() {
    const items = (roomItemsByRoom && roomItemsByRoom[currentRoom]) || [];
    const start = currentPage * EGGS_PER_PAGE;
    const slice = items.slice(start, start + EGGS_PER_PAGE);
    eggs = layoutEggs(slice, currentRoom, currentPage, activeFiler ? activeFiler.filer_slug : 'none');
    bumpedIdx = -1;
    updateRoomLabel();
    updatePageButtons();
    setInfoEmpty();
  }

  function updateRoomLabel() {
    const total = (roomItemsByRoom && roomItemsByRoom[currentRoom] || []).length;
    document.getElementById('exec-room-label').textContent =
      activeFiler ? ROOM_TITLES[currentRoom] : '—';
    const pages = pageCount();
    document.getElementById('exec-page-label').textContent =
      total === 0
        ? (activeFiler ? 'NO ENTRIES' : '')
        : `PAGE ${currentPage + 1}/${pages} · ${total} ENTRIES`;
    for (const room of ROOMS) {
      const el = document.querySelector(`.exec-room-tab[data-room="${room}"]`);
      if (!el) continue;
      el.classList.toggle('active', room === currentRoom);
      el.disabled = !activeFiler;
      const c = el.querySelector(`[data-count="${room}"]`);
      if (c) c.textContent = activeFiler ? String((roomItemsByRoom[room] || []).length) : '—';
    }
  }

  function updatePageButtons() {
    const pages = pageCount();
    const total = (roomItemsByRoom && roomItemsByRoom[currentRoom] || []).length;
    document.getElementById('exec-prev').disabled = !activeFiler || total === 0 || currentPage === 0;
    document.getElementById('exec-next').disabled = !activeFiler || total === 0 || currentPage >= pages - 1;
  }

  // -------- Player + sprite drawing --------
  function colorsForFiler(slug) {
    const h = hash32(slug || 'guest');
    return {
      suit:   pickFromHash(PAL.suits, h, 1),
      suitDk: pickFromHash(PAL.suitsDk, h, 1),
      skin:   pickFromHash(PAL.skins, h, 7),
      skinDk: pickFromHash(PAL.skinsDk, h, 7),
      tie:    pickFromHash(PAL.ties, h, 13),
      hair:   pickFromHash(PAL.hairs, h, 19),
    };
  }

  function rect(c, x, y, w, h) {
    ctx.fillStyle = c;
    ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  }

  function drawPlayer() {
    const x = player.x | 0;
    const yFeet = player.y | 0;
    const scale = player.scale || 1;
    if (scale !== 1) {
      ctx.save();
      const ax = x + 6;
      ctx.translate(ax, yFeet);
      ctx.scale(scale, scale);
      ctx.translate(-ax, -yFeet);
    }
    const top = yFeet - 26;
    const frame = player.walkPhase & 1;
    const c = player.colors;

    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(x - 2, yFeet, 14, 2);

    if (player.isMaga) {
      // Red MAGA cap. The brim points in the facing direction so the
      // hat reads as turning when the player changes direction.
      const RED = '#c83a3a';
      const RED_DK = '#7a1c1c';
      const WHITE = '#f5efd6';
      rect(RED,    x + 1, top - 1, 10, 4);   // crown
      rect(RED_DK, x + 1, top + 2, 10, 1);   // crown band/shadow
      rect(WHITE,  x + 3, top, 6, 1);        // white band — reads as M-A-G-A
      rect(RED_DK, x + 4, top, 1, 1);        // letter divider hints
      rect(RED_DK, x + 7, top, 1, 1);
      if (player.facing >= 0) {
        rect(RED_DK, x + 9, top + 2, 4, 2);  // brim right
        rect(RED,    x + 9, top + 2, 4, 1);
      } else {
        rect(RED_DK, x - 2, top + 2, 4, 2);  // brim left
        rect(RED,    x - 2, top + 2, 4, 1);
      }
    } else {
      rect(c.hair, x + 2, top, 8, 3);
      rect(c.hair, x + 1, top + 1, 10, 2);
    }

    rect(c.skin, x + 2, top + 3, 8, 5);
    rect(c.skinDk, x + 2, top + 7, 8, 1);
    rect(PAL.ink, x + 1, top + 3, 1, 5);
    rect(PAL.ink, x + 10, top + 3, 1, 5);
    const eyeOff = player.facing < 0 ? 0 : 0;
    rect(PAL.ink, x + 4 + eyeOff, top + 5, 1, 1);
    rect(PAL.ink, x + 7 + eyeOff, top + 5, 1, 1);

    rect(c.skinDk, x + 5, top + 8, 2, 1);
    rect(c.suit, x + 1, top + 9, 10, 8);
    rect(c.suitDk, x + 1, top + 16, 10, 1);
    rect(c.suitDk, x + 5, top + 9, 1, 3);
    rect(c.suitDk, x + 6, top + 9, 1, 3);
    rect(PAL.white, x + 5, top + 9, 2, 1);
    rect(c.tie, x + 5, top + 10, 2, 5);
    rect(c.suitDk, x + 4, top + 11, 1, 1);
    rect(c.suitDk, x + 7, top + 11, 1, 1);

    const armDx = frame === 0 ? 0 : 1;
    rect(c.suit, x, top + 10, 1, 5);
    rect(c.suit, x + 11, top + 10, 1, 5);
    rect(c.skin, x + armDx * 0, top + 14, 1, 1);
    rect(c.skin, x + 11, top + 14 + armDx, 1, 1);

    rect(PAL.ink, x + 1, top + 17, 10, 2);
    rect('#1a1a1a', x + 1, top + 19, 4, 5);
    rect('#1a1a1a', x + 7, top + 19, 4, 5);
    if (frame === 0) {
      rect(PAL.ink, x + 1, top + 23, 4, 2);
      rect(PAL.ink, x + 7, top + 22, 4, 3);
    } else {
      rect(PAL.ink, x + 1, top + 22, 4, 3);
      rect(PAL.ink, x + 7, top + 23, 4, 2);
    }
    if (scale !== 1) ctx.restore();
  }

  function drawEgg(e, hue, t, isBumped) {
    const cx = e.x;
    const cy = e.y + Math.sin(t * 2 + e.bob) * 1.5;
    // Egg body: 10w × 12h, anchored at cx, cy (center)
    const x = (cx - 5) | 0;
    const y = (cy - 6) | 0;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x, y + 12, 10, 2);
    rect(hue.eggDk, x + 1, y + 0, 8, 1);
    rect(hue.egg,   x + 0, y + 1, 10, 10);
    rect(hue.eggDk, x + 0, y + 11, 10, 1);
    rect(hue.eggDk, x + 0, y + 1, 1, 10);
    rect(hue.eggDk, x + 9, y + 1, 1, 10);
    // Highlight specks
    rect(hue.accent, x + 2, y + 2, 2, 1);
    rect(hue.accent, x + 6, y + 5, 1, 1);
    rect(hue.accent, x + 3, y + 8, 1, 1);
    if (isBumped) {
      ctx.strokeStyle = PAL.gold;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 2, y - 2, 14, 16);
    }
  }

  // -------- Update + render --------
  function update(dt, t) {
    // Read keys → velocity
    let vx = 0, vy = 0;
    if (activeFiler) {
      if (keys['ArrowLeft'])  vx -= 1;
      if (keys['ArrowRight']) vx += 1;
      if (keys['ArrowUp'])    vy -= 1;
      if (keys['ArrowDown'])  vy += 1;
    }
    if (vx || vy) {
      const len = Math.hypot(vx, vy) || 1;
      vx = vx / len * PLAYER_SPEED;
      vy = vy / len * PLAYER_SPEED;
      if (vx !== 0) player.facing = vx > 0 ? 1 : -1;
      player.walkT += dt;
      if (player.walkT >= 0.18) { player.walkT = 0; player.walkPhase++; }
    } else {
      player.walkT = 0;
    }
    player.vx = vx; player.vy = vy;
    player.x += vx * dt;
    player.y += vy * dt;

    const b = fieldBounds();
    if (player.x < b.minX) player.x = b.minX;
    if (player.x > b.maxX) player.x = b.maxX;
    if (player.y < b.minY) player.y = b.minY;
    if (player.y > b.maxY) player.y = b.maxY;

    // Egg collision (only the current page's eggs are checked)
    let nearest = -1;
    let bestD = Infinity;
    for (let i = 0; i < eggs.length; i++) {
      const e = eggs[i];
      const dx = e.x - (player.x + 6);
      const dy = e.y - (player.y - 13);
      const d2 = dx * dx + dy * dy;
      if (d2 < 18 * 18 && d2 < bestD) { bestD = d2; nearest = i; }
    }
    if (nearest !== bumpedIdx) {
      bumpedIdx = nearest;
      if (bumpedIdx >= 0) {
        const e = eggs[bumpedIdx];
        const total = (roomItemsByRoom[currentRoom] || []).length;
        const globalIdx = currentPage * EGGS_PER_PAGE + e.idx;
        showInfoFor(e.item, globalIdx, total);
      } else {
        setInfoEmpty();
      }
    }
  }

  function render(t) {
    if (!bgCache || bgCacheRoom !== currentRoom) {
      bgCache = buildBackground(currentRoom);
      bgCacheRoom = currentRoom;
    }
    ctx.drawImage(bgCache, 0, 0);

    if (!activeFiler) {
      // Centered prompt overlay
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(W / 2 - 200, H / 2 - 24, 400, 48);
      ctx.fillStyle = PAL.gold;
      ctx.font = 'bold 10px "Press Start 2P", monospace';
      ctx.textBaseline = 'top';
      const msg = 'PICK A FILER FROM THE ROSTER';
      const m = ctx.measureText(msg);
      ctx.fillText(msg, (W - m.width) / 2, H / 2 - 12);
      ctx.fillStyle = PAL.white;
      ctx.font = '7px "Press Start 2P", monospace';
      const sub = '◀▶ ROOMS · ARROWS MOVE · BUMP EGGS';
      const sm = ctx.measureText(sub);
      ctx.fillText(sub, (W - sm.width) / 2, H / 2 + 4);
      return;
    }

    const hue = ROOM_HUE[currentRoom];

    // Sort: eggs above feet first, then player layered with eggs by y-feet
    const order = eggs
      .map((_, i) => ({ y: eggs[i].y, i, kind: 'egg' }))
      .concat([{ y: player.y, i: -1, kind: 'player' }])
      .sort((a, b) => a.y - b.y);
    for (const o of order) {
      if (o.kind === 'egg') drawEgg(eggs[o.i], hue, t, o.i === bumpedIdx);
      else drawPlayer();
    }

    // Hint label above bumped egg
    if (bumpedIdx >= 0) {
      const e = eggs[bumpedIdx];
      const tag = labelFor(e.item);
      const px = 6;
      ctx.font = `bold ${px}px "Press Start 2P", monospace`;
      const tw = ctx.measureText(tag).width;
      const bx = ((e.x - tw / 2 - 4) | 0);
      const by = ((e.y - 22) | 0);
      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      ctx.fillRect(bx, by, (tw + 8) | 0, 12);
      ctx.fillStyle = hue.accent;
      ctx.fillRect(bx, by + 11, (tw + 8) | 0, 1);
      ctx.fillStyle = PAL.white;
      ctx.fillText(tag, bx + 4, by + 3);
    }
  }

  function labelFor(item) {
    if (!item) return '';
    if (item.kind === 'asset') {
      const t = item.ticker || '';
      const v = item.valueAmt ? fmtMoney(item.valueAmt) : '';
      return [t, v].filter(Boolean).join(' ').slice(0, 24) || (item.title || '').slice(0, 22).toUpperCase();
    }
    if (item.kind === 'income') {
      return (item.incomeAmount || '').slice(0, 22).toUpperCase()
        || (item.title || '').slice(0, 22).toUpperCase();
    }
    if (item.kind === 'liability') {
      return (item.amount || '').slice(0, 22).toUpperCase()
        || (item.liabilityType || '').slice(0, 22).toUpperCase();
    }
    if (item.kind === 'position') {
      return (item.role || item.title || '').slice(0, 22).toUpperCase();
    }
    return '';
  }

  function frame(t) {
    if (!canvas || document.hidden) { raf = 0; return; }
    if (!lastT) lastT = t;
    let dt = (t - lastT) / 1000;
    if (dt > 0.1) dt = 0.1;
    lastT = t;
    update(dt, t / 1000);
    render(t / 1000);
    raf = requestAnimationFrame(frame);
  }

  // -------- Info panel --------
  function setInfoEmpty() {
    const el = document.getElementById('exec-info');
    if (!activeFiler) {
      el.innerHTML = '<div class="exec-info-empty">&#9632; ARROWS TO MOVE &nbsp;&middot;&nbsp; BUMP AN EGG TO INSPECT &nbsp;&middot;&nbsp; 1-4 SWITCH ROOM &#9632;</div>';
      return;
    }
    const total = (roomItemsByRoom[currentRoom] || []).length;
    if (total === 0) {
      el.innerHTML = `<div class="exec-info-empty">NO ${escapeHTML(ROOM_TITLES[currentRoom])} ON FILE</div>`;
      return;
    }
    el.innerHTML = `<div class="exec-info-empty">&#9632; WALK INTO AN EGG TO REVEAL THE ENTRY &#9632;</div>`;
  }

  function showInfoFor(item, idx, total) {
    const el = document.getElementById('exec-info');
    el.innerHTML = renderInfo(item, idx, total);
  }

  const SCHEDULE_LABELS = {
    employment_assets: 'EMPLOYMENT',
    other_assets: 'OTHER',
    spouse_employment_assets: 'SPOUSE EMPLOYMENT',
    compensation_sources: 'COMPENSATION SOURCE',
    positions: 'POSITIONS',
    liabilities: 'LIABILITIES',
  };

  function infoRow(label, value, valueClass) {
    if (value == null || value === '') return '';
    const cls = valueClass ? ` ${valueClass}` : '';
    return `<dt class="exec-info-label">${escapeHTML(label)}</dt>` +
           `<dd class="exec-info-fvalue${cls}">${escapeHTML(String(value))}</dd>`;
  }

  function renderInfo(item, idx, total) {
    if (!item) return '';
    const kindLabel = item.kind.toUpperCase();
    const tag = `<span class="exec-info-tag exec-info-tag--${item.kind}">${escapeHTML(kindLabel)}</span>`;
    const flag = (item.parseQuality && item.parseQuality !== 'ok')
      ? `<span class="exec-info-flag">${escapeHTML(item.parseQuality.toUpperCase())}</span>`
      : '';
    const counter = (typeof idx === 'number' && typeof total === 'number')
      ? `<span class="exec-info-counter">ENTRY ${idx + 1} / ${total}</span>`
      : '';
    const title = escapeHTML(item.title || '(no description)');
    const fields = renderFieldsFor(item);
    const footMeta = [
      item.rowNum ? `ROW ${escapeHTML(item.rowNum)}` : '',
      item.spouse ? 'SPOUSE FILING' : '',
    ].filter(Boolean).join('  &middot;  ');
    const showRaw = item.raw && item.raw !== item.title;
    return `
      <div class="exec-info-head">
        <div class="exec-info-tags">${tag}${flag}</div>
        ${counter}
      </div>
      <div class="exec-info-title">${title}</div>
      ${fields}
      ${showRaw ? `<div class="exec-info-raw">${escapeHTML(item.raw)}</div>` : ''}
      ${footMeta ? `<div class="exec-info-foot">${footMeta}</div>` : ''}
    `;
  }

  function renderFieldsFor(item) {
    const rows = [];
    if (item.kind === 'position') {
      rows.push(infoRow('ROLE', item.role));
      rows.push(infoRow('ORGANIZATION TYPE', item.orgType));
      rows.push(infoRow('LOCATION', item.where));
      if (item.from || item.to) {
        rows.push(infoRow('SPAN', `${item.from || '?'} → ${item.to || '?'}`));
      }
    } else if (item.kind === 'asset') {
      rows.push(infoRow('SCHEDULE', SCHEDULE_LABELS[item.scheduleKey] || ''));
      rows.push(infoRow('TICKER', item.ticker));
      rows.push(infoRow('VALUE', item.value, 'exec-info-fvalue--gold'));
      rows.push(infoRow('INCOME TYPE', item.incomeType));
      rows.push(infoRow('INCOME AMOUNT', item.incomeAmount, 'exec-info-fvalue--gold'));
      rows.push(infoRow('EIF', item.eif));
    } else if (item.kind === 'income') {
      rows.push(infoRow('SOURCE', SCHEDULE_LABELS[item.scheduleKey] || ''));
      rows.push(infoRow('TICKER', item.ticker));
      rows.push(infoRow('TYPE', item.incomeType));
      rows.push(infoRow('AMOUNT', item.incomeAmount, 'exec-info-fvalue--gold'));
    } else if (item.kind === 'liability') {
      rows.push(infoRow('TYPE', item.liabilityType));
      rows.push(infoRow('AMOUNT', item.amount, 'exec-info-fvalue--gold'));
      rows.push(infoRow('RATE', item.rate));
      rows.push(infoRow('TERM', item.term));
      rows.push(infoRow('YEAR INCURRED', item.yearIncurred));
    }
    const filled = rows.filter(Boolean);
    return filled.length ? `<dl class="exec-info-fields">${filled.join('')}</dl>` : '';
  }

  // -------- Roster --------
  function filterPredicate(f, q) {
    const name = (f.filer_name || '').toLowerCase();
    if (/periodic\s+transaction\s+report/.test(name)) return false;
    if (name.includes('annual report to congress on white house staff')) return false;
    if (!q) return true;
    const pos = (f.position_line || '').toLowerCase();
    return name.includes(q) || pos.includes(q) ||
      (f.tickers || []).some(t => (t || '').toLowerCase().includes(q));
  }

  function applyFilter(query) {
    lastQuery = (query || '').trim().toLowerCase();
    filtered = allFilings.filter(f => filterPredicate(f, lastQuery));
    filtered.sort((a, b) => (b.total_estimated_value || 0) - (a.total_estimated_value || 0));
    renderRoster();
  }

  function renderRoster() {
    const list = document.getElementById('exec-list');
    list.innerHTML = '';
    for (const f of filtered) {
      const li = document.createElement('li');
      li.className = 'exec-roster-row';
      li.dataset.slug = f.filer_slug;
      li.setAttribute('role', 'option');
      if (activeFiler && activeFiler.filer_slug === f.filer_slug) {
        li.classList.add('selected');
      }
      const total = fmtMoney(f.total_estimated_value);
      const name = (f.filer_name || '?').replace(/\s*\(.*?\)\s*$/, '');
      li.innerHTML = `
        <span class="exec-roster-name">${escapeHTML(name)}</span>
        <span class="exec-roster-total">${total}</span>
      `;
      li.addEventListener('click', () => selectFiler(f));
      list.appendChild(li);
    }
  }

  function appendFilings(newOnes) {
    const seen = new Set(allFilings.map(f => f.filer_slug));
    const fresh = (newOnes || []).filter(f => f.filer_slug && !seen.has(f.filer_slug));
    if (!fresh.length) return;
    allFilings = allFilings.concat(fresh);
    applyFilter(lastQuery);
  }

  // -------- Selection / disclosure load --------
  async function selectFiler(filerSummary) {
    if (activeFiler && activeFiler.filer_slug === filerSummary.filer_slug) return;
    activeFiler = filerSummary;
    disclosure = null;
    roomItemsByRoom = { positions: [], assets: [], income: [], liabilities: [] };
    currentRoom = 'positions';
    currentPage = 0;
    eggs = [];
    bumpedIdx = -1;
    player.colors = colorsForFiler(filerSummary.filer_slug);
    player.isMaga = (filerSummary.filer_slug === 'president_donald_j_trump' ||
                     filerSummary.filer_slug === 'vice_president_jd_vance');
    player.scale = player.isMaga ? 2 : 1;
    const b = fieldBounds();
    player.x = (b.minX + b.maxX) / 2;
    player.y = b.maxY - 8;

    // Header
    document.getElementById('exec-current-name').textContent = (filerSummary.filer_name || '').replace(/\s*\(.*?\)\s*$/, '');
    document.getElementById('exec-current-pos').textContent = filerSummary.position_line || '';

    renderRoster();
    setInfoLoading();

    try {
      const r = await fetch(`/api/executive/${encodeURIComponent(filerSummary.filer_slug)}`);
      if (!r.ok) throw new Error('lookup failed');
      const data = await r.json();
      // Discard any lingering selection that changed during the fetch
      if (!activeFiler || activeFiler.filer_slug !== filerSummary.filer_slug) return;
      disclosure = data;
      roomItemsByRoom = buildRoomItems(data);
      // Wire PDF button
      const pdf = document.getElementById('exec-pdf');
      if (data.pdf_url) {
        pdf.hidden = false;
        pdf.href = data.pdf_url;
      } else {
        pdf.hidden = true;
        pdf.removeAttribute('href');
      }
      // Pick the first non-empty room as the entry room
      const firstNonEmpty = ROOMS.find(r => (roomItemsByRoom[r] || []).length) || 'positions';
      currentRoom = firstNonEmpty;
      currentPage = 0;
      bgCache = null; // force redraw with the new room banner
      refreshPage();
      canvas.focus();
      // Surface unparsed-PDF state explicitly (Trump/Vance fall back to PDF)
      const ps = data.parse_status;
      if (ps && ps !== 'ok') {
        const msg = {
          layout_unsupported: 'PDF LAYOUT NOT MACHINE-READABLE',
          scanned_no_text: 'SCANNED PDF WITHOUT EXTRACTABLE TEXT',
          download_failed: 'PDF DOWNLOAD FAILED — TRY AGAIN LATER',
        }[ps] || `PARSE ${ps.toUpperCase()}`;
        document.getElementById('exec-info').innerHTML =
          `<div class="exec-info-warn">${escapeHTML(msg)} — USE OPEN PDF</div>`;
      }
    } catch (e) {
      if (activeFiler && activeFiler.filer_slug === filerSummary.filer_slug) {
        document.getElementById('exec-info').innerHTML =
          '<div class="exec-info-warn">FAILED TO LOAD DISCLOSURE</div>';
      }
    }
  }

  function setInfoLoading() {
    document.getElementById('exec-info').innerHTML =
      '<div class="exec-info-empty">LOADING DISCLOSURE&hellip;</div>';
  }

  // -------- Room / page navigation --------
  function switchRoom(room) {
    if (!activeFiler) return;
    if (!ROOM_TITLES[room]) return;
    if (currentRoom === room) return;
    currentRoom = room;
    currentPage = 0;
    bgCache = null;
    refreshPage();
  }
  function goPage(delta) {
    if (!activeFiler) return;
    const pages = pageCount();
    const next = Math.max(0, Math.min(pages - 1, currentPage + delta));
    if (next === currentPage) return;
    currentPage = next;
    refreshPage();
    // Reposition player to opposite edge to read as "entering" the new page
    const b = fieldBounds();
    player.x = delta > 0 ? b.minX + 8 : b.maxX - 8;
  }

  // -------- Wire up --------
  function init() {
    canvas = document.getElementById('field');
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    document.getElementById('exec-prev').addEventListener('click', () => goPage(-1));
    document.getElementById('exec-next').addEventListener('click', () => goPage(1));

    for (const tab of document.querySelectorAll('.exec-room-tab')) {
      tab.addEventListener('click', () => switchRoom(tab.dataset.room));
    }

    let searchT = 0;
    document.getElementById('exec-search').addEventListener('input', (e) => {
      const q = e.target.value;
      clearTimeout(searchT);
      searchT = setTimeout(() => applyFilter(q), 120);
    });

    document.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.key.startsWith('Arrow')) {
        keys[e.key] = true;
        // Suppress page scroll while exploring
        if (activeFiler) e.preventDefault();
      }
      if (e.key === '1') { switchRoom('positions');   e.preventDefault(); }
      if (e.key === '2') { switchRoom('assets');      e.preventDefault(); }
      if (e.key === '3') { switchRoom('income');      e.preventDefault(); }
      if (e.key === '4') { switchRoom('liabilities'); e.preventDefault(); }
      if (e.key === 'PageDown' || e.key === ']') { goPage(1);  e.preventDefault(); }
      if (e.key === 'PageUp'   || e.key === '[') { goPage(-1); e.preventDefault(); }
    });
    document.addEventListener('keyup', (e) => {
      if (e.key.startsWith('Arrow')) keys[e.key] = false;
    });
    canvas.addEventListener('blur', () => {
      // Drop held-key state if focus leaves the canvas — prevents the
      // player from drifting forever if the user tabs away mid-stride.
      for (const k of Object.keys(keys)) keys[k] = false;
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !raf) { lastT = 0; raf = requestAnimationFrame(frame); }
    });

    if (!raf) raf = requestAnimationFrame(frame);
    streamFilings();
  }

  // -------- Stream filings (page-of-50) --------
  async function streamFilings() {
    const status = document.getElementById('exec-stream-status');
    const BACKOFFS = [4000, 8000, 16000, 32000, 64000];
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      let data = null;
      for (let attempt = 0; attempt <= BACKOFFS.length && !data; attempt++) {
        try {
          const r = await fetch(`/api/executive?limit=${STREAM_PAGE}&offset=${offset}`);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          data = await r.json();
        } catch (e) {
          if (attempt >= BACKOFFS.length) break;
          await new Promise(res => setTimeout(res, BACKOFFS[attempt]));
        }
      }
      if (!data) {
        status.textContent = allFilings.length ? `${allFilings.length} LOADED · UPSTREAM SLOW` : 'FAILED TO LOAD';
        return;
      }
      const batch = data.filings || [];
      if (typeof data.total === 'number') total = data.total;
      appendFilings(batch);
      status.textContent = `${allFilings.length}${Number.isFinite(total) ? ` / ${total}` : ''} LOADED`;
      if (batch.length < STREAM_PAGE) break;
      offset += STREAM_PAGE;
    }
    status.textContent = `${allFilings.length} FILERS`;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // --- Embed hooks (mirror app.js) ---
  function postParent(msg) {
    if (window.parent === window) return;
    window.parent.postMessage(msg, '*');
  }
  function announceLocation() {
    postParent({ type: 'politicians:location', path: location.pathname, hash: location.hash });
  }
  window.addEventListener('hashchange', () => {
    postParent({ type: 'politicians:hash', value: location.hash });
    announceLocation();
  });
  document.addEventListener('click', (e) => {
    if (window.parent === window) return;
    const inBanner = !!e.target.closest('.banner');
    const isAppNav = !!e.target.closest('.exec-nav');
    const area = (inBanner && !isAppNav) ? 'chrome' : 'app';
    postParent({ type: 'politicians:click', area });
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announceLocation);
  } else {
    announceLocation();
  }
})();
