// Executive Wing — pixel field where 278e filers wander with their
// estimated holdings floating overhead. Click a sprite for full disclosure.
(function () {
  const W = 720;
  const H = 360;
  const PAGE_SIZE = 15;

  const PAL = {
    // Sky / lawn
    skyTop:   '#7cb8e0',
    skyMid:   '#bfdcef',
    skyBot:   '#e6efe2',
    grass:    '#3c8a3a',
    grassDk:  '#205a25',
    grassLt:  '#5cae4d',
    grassTuft:'#1a4a1c',
    // Path / fence
    path:     '#c9a76a',
    pathDk:   '#90703f',
    fence:    '#f0e4c3',
    fenceDk:  '#7a6e47',
    // White house
    wh:       '#f0e7d0',
    whDk:     '#a89a76',
    whRoof:   '#3a4856',
    whWindow: '#7fb8d8',
    // Tree
    leaf:     '#2a6a2a',
    leafDk:   '#0e3416',
    leafLt:   '#4ea64a',
    trunk:    '#5a3a1a',
    // Common
    ink:      '#0d0d0d',
    paper:    '#ecdca2',
    gold:     '#e8c547',
    goldDk:   '#a9892e',
    red:      '#c83a3a',
    white:    '#f5efd6',
    // Sprite palettes (varied by hash)
    suits: ['#1c2a56', '#3a3a3a', '#2a1f1a', '#4a3a2a', '#1f2a1f', '#2a2a3f'],
    suitsDk: ['#0e1632', '#1a1a1a', '#180f0a', '#2a1f15', '#10180f', '#15151f'],
    skins: ['#9a9a9a'],
    skinsDk: ['#6a6a6a'],
    ties:  ['#c83a3a', '#1c4a8c', '#e8c547', '#5a2a8c', '#2a8c5a', '#8c5a2a'],
    hairs: ['#141414', '#3a2a1a', '#7a5a3a', '#a88860', '#d4b878'],
  };

  // Scene state
  let canvas = null;
  let ctx = null;
  let raf = 0;
  let lastT = 0;
  let allFilings = [];
  let filtered = [];
  let pageIndex = 0;
  let sprites = [];
  let lastClickHit = null;
  let bgCache = null;       // offscreen background canvas
  const hoverState = { x: -1, y: -1, idx: -1 };

  // -------- Canvas primitives --------
  function rect(c, x, y, w, h) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); }
  function rectOn(g, c, x, y, w, h) { g.fillStyle = c; g.fillRect(x | 0, y | 0, w | 0, h | 0); }
  function text(s, x, y, color, px = 6, bold = false) {
    ctx.fillStyle = color;
    ctx.font = `${bold ? 'bold ' : ''}${px}px "Press Start 2P", monospace`;
    ctx.textBaseline = 'top';
    ctx.fillText(s, x | 0, y | 0);
  }
  function textCentered(s, cx, y, color, px = 6, bold = false) {
    ctx.fillStyle = color;
    ctx.font = `${bold ? 'bold ' : ''}${px}px "Press Start 2P", monospace`;
    ctx.textBaseline = 'top';
    const m = ctx.measureText(s);
    ctx.fillText(s, (cx - m.width / 2) | 0, y | 0);
  }
  function measure(s, px, bold = false) {
    ctx.font = `${bold ? 'bold ' : ''}${px}px "Press Start 2P", monospace`;
    return ctx.measureText(s).width;
  }

  // -------- Hash helpers (deterministic per slug) --------
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

  // -------- Money formatting --------
  function fmtMoney(n) {
    if (!n || !Number.isFinite(n)) return '$0';
    if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
    return `$${Math.round(n)}`;
  }

  function lastNameOf(filerName) {
    if (!filerName) return '?';
    // "Adams, Patrick" → "ADAMS"; "President Donald J. Trump" → "TRUMP"
    const comma = filerName.indexOf(',');
    let s = comma > 0 ? filerName.slice(0, comma) : filerName;
    s = s.replace(/^(Vice President|President|Hon\.?|Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Senator|Rep\.?)\s+/i, '');
    if (comma < 0) {
      // No comma — last whitespace-delimited word is the surname
      const parts = s.trim().split(/\s+/);
      s = parts[parts.length - 1] || s;
    }
    return s.trim().toUpperCase().slice(0, 12);
  }

  // -------- Background (drawn once per resize) --------
  function buildBackground() {
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const g = off.getContext('2d');
    g.imageSmoothingEnabled = false;

    // Sky gradient (top 35%)
    const skyEnd = Math.floor(H * 0.35);
    for (let y = 0; y < skyEnd; y++) {
      const t = y / skyEnd;
      const r = Math.round(0x7c + (0xbf - 0x7c) * t);
      const gg = Math.round(0xb8 + (0xdc - 0xb8) * t);
      const b = Math.round(0xe0 + (0xef - 0xe0) * t);
      rectOn(g, `rgb(${r},${gg},${b})`, 0, y, W, 1);
    }

    // Sun
    rectOn(g, '#ffe07a', 590, 28, 24, 24);
    rectOn(g, '#ffd84a', 594, 32, 16, 16);
    // Clouds
    drawCloudOn(g, 80, 50);
    drawCloudOn(g, 280, 35);
    drawCloudOn(g, 460, 60);

    // Lawn band
    rectOn(g, PAL.grass, 0, skyEnd, W, H - skyEnd);
    // Tufts of darker/lighter grass
    const seedRand = mulberry32(0xC0FFEE);
    for (let i = 0; i < 240; i++) {
      const x = Math.floor(seedRand() * W);
      const y = skyEnd + Math.floor(seedRand() * (H - skyEnd));
      const which = seedRand();
      const c = which < 0.5 ? PAL.grassDk : (which < 0.85 ? PAL.grassLt : PAL.grassTuft);
      rectOn(g, c, x, y, 2, 1);
      rectOn(g, c, x + 1, y - 1, 1, 1);
    }

    // White house, base sinks slightly into the lawn so it reads as planted
    // rather than floating at the horizon line.
    drawWhiteHouse(g, W / 2 - 60, skyEnd - 40);

    // Reflecting pool / path strip
    rectOn(g, PAL.path, 0, skyEnd + 30, W, 6);
    rectOn(g, PAL.pathDk, 0, skyEnd + 30, W, 1);
    rectOn(g, PAL.pathDk, 0, skyEnd + 35, W, 1);

    // Trees
    drawTreeOn(g, 36, skyEnd + 20);
    drawTreeOn(g, W - 48, skyEnd + 18);
    drawTreeOn(g, 165, skyEnd + 6);
    drawTreeOn(g, W - 165, skyEnd + 8);

    // Fence sliver across bottom
    for (let x = 0; x < W; x += 12) {
      rectOn(g, PAL.fence, x + 2, H - 14, 2, 8);
      rectOn(g, PAL.fenceDk, x + 2, H - 14, 2, 1);
    }
    rectOn(g, PAL.fence, 0, H - 8, W, 2);
    rectOn(g, PAL.fenceDk, 0, H - 8, W, 1);

    return off;
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

  function drawCloudOn(g, x, y) {
    rectOn(g, '#ffffff', x + 4, y, 18, 4);
    rectOn(g, '#ffffff', x, y + 2, 26, 4);
    rectOn(g, '#ffffff', x + 6, y + 4, 14, 2);
    rectOn(g, '#e6efe2', x, y + 5, 26, 1);
  }

  function drawTreeOn(g, x, baseY) {
    rectOn(g, PAL.trunk, x - 2, baseY - 8, 4, 14);
    rectOn(g, PAL.leafDk, x - 12, baseY - 30, 24, 6);
    rectOn(g, PAL.leaf,   x - 14, baseY - 26, 28, 14);
    rectOn(g, PAL.leafLt, x - 10, baseY - 24, 8, 4);
    rectOn(g, PAL.leafLt, x + 2,  baseY - 22, 6, 3);
    rectOn(g, PAL.leafDk, x - 14, baseY - 14, 28, 2);
  }

  function drawWhiteHouse(g, x, y) {
    // Body
    rectOn(g, PAL.wh, x, y + 14, 120, 30);
    rectOn(g, PAL.whDk, x, y + 43, 120, 2);
    // Roof
    rectOn(g, PAL.whRoof, x - 2, y + 12, 124, 3);
    // Center portico
    rectOn(g, PAL.wh, x + 48, y + 4, 24, 14);
    rectOn(g, PAL.whRoof, x + 46, y + 2, 28, 3);
    rectOn(g, PAL.whRoof, x + 56, y - 4, 8, 8);
    rectOn(g, PAL.whDk, x + 59, y - 4, 2, 8);
    // Columns
    for (let i = 0; i < 4; i++) {
      rectOn(g, PAL.whDk, x + 50 + i * 6, y + 6, 2, 12);
    }
    // Windows
    for (let i = 0; i < 12; i++) {
      const cx = x + 6 + i * 9;
      if (cx >= x + 44 && cx <= x + 76) continue;
      rectOn(g, PAL.whWindow, cx, y + 22, 5, 6);
      rectOn(g, PAL.ink, cx, y + 22, 5, 1);
    }
    // Flag
    rectOn(g, PAL.ink, x + 59, y - 14, 1, 10);
    rectOn(g, PAL.red, x + 60, y - 13, 6, 4);
  }

  // -------- Sprite drawing (12 wide × 26 tall, feet at yFeet) --------
  function drawSprite(s, isHover) {
    const x = s.x | 0;
    const yFeet = s.y | 0;
    const top = yFeet - 26;
    const frame = s.walkPhase & 1;
    const suit = s.colors.suit;
    const suitDk = s.colors.suitDk;
    const skin = s.colors.skin;
    const skinDk = s.colors.skinDk;
    const tie = s.colors.tie;
    const hair = s.colors.hair;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fillRect(x - 2, yFeet, 14, 2);

    // Hair / hat
    rect(hair, x + 2, top, 8, 3);
    rect(hair, x + 1, top + 1, 10, 2);

    // Head
    rect(skin, x + 2, top + 3, 8, 5);
    rect(skinDk, x + 2, top + 7, 8, 1);
    rect(PAL.ink, x + 1, top + 3, 1, 5);
    rect(PAL.ink, x + 10, top + 3, 1, 5);
    rect(PAL.ink, x + 4, top + 5, 1, 1);
    rect(PAL.ink, x + 7, top + 5, 1, 1);

    // Neck
    rect(skinDk, x + 5, top + 8, 2, 1);

    // Suit jacket
    rect(suit, x + 1, top + 9, 10, 8);
    rect(suitDk, x + 1, top + 16, 10, 1);
    // Lapels (V)
    rect(suitDk, x + 5, top + 9, 1, 3);
    rect(suitDk, x + 6, top + 9, 1, 3);
    // Shirt + tie
    rect(PAL.white, x + 5, top + 9, 2, 1);
    rect(tie, x + 5, top + 10, 2, 5);
    rect(suitDk, x + 4, top + 11, 1, 1);
    rect(suitDk, x + 7, top + 11, 1, 1);

    // Arms — slight swing based on frame
    const armDx = frame === 0 ? 0 : 1;
    rect(suit, x, top + 10, 1, 5);
    rect(suit, x + 11, top + 10, 1, 5);
    rect(skin, x + armDx * 0, top + 14, 1, 1);
    rect(skin, x + 11, top + 14 + armDx, 1, 1);

    // Pants
    rect(PAL.ink, x + 1, top + 17, 10, 2);
    rect('#1a1a1a', x + 1, top + 19, 4, 5);
    rect('#1a1a1a', x + 7, top + 19, 4, 5);
    // Feet (alternate)
    if (frame === 0) {
      rect(PAL.ink, x + 1, top + 23, 4, 2);
      rect(PAL.ink, x + 7, top + 22, 4, 3);
    } else {
      rect(PAL.ink, x + 1, top + 22, 4, 3);
      rect(PAL.ink, x + 7, top + 23, 4, 2);
    }

    // Layout-unsupported badge (Trump/Vance) — small "PDF" tag
    if (s.filing.parse_status === 'layout_unsupported') {
      rect(PAL.gold, x + 9, top - 1, 6, 4);
      rect(PAL.goldDk, x + 9, top + 2, 6, 1);
      text('PDF', x + 10, top, PAL.ink, 4, true);
    }

    // Hover highlight ring
    if (isHover) {
      ctx.strokeStyle = PAL.gold;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 3, top - 2, 18, 32);
    }
  }

  function drawSpriteLabels(s, isHover) {
    const x = s.x | 0;
    const top = (s.y | 0) - 26;
    const totalLabel = fmtMoney(s.filing.total_estimated_value);
    const nameLabel = lastNameOf(s.filing.filer_name);
    const bigPx = 7;
    const smallPx = 6;

    const tw = Math.max(measure(totalLabel, bigPx, true), measure(nameLabel, smallPx, false));
    const bx = x + 6 - tw / 2 - 3;
    const by = top - 22;
    const bw = tw + 6;
    const bh = 19;

    ctx.fillStyle = isHover ? 'rgba(232, 197, 71, 0.92)' : 'rgba(0,0,0,0.66)';
    ctx.fillRect(bx | 0, by | 0, bw | 0, bh | 0);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(bx | 0, (by + bh) | 0, bw | 0, 1);

    textCentered(totalLabel, x + 6, by + 2, isHover ? PAL.ink : PAL.gold, bigPx, true);
    textCentered(nameLabel, x + 6, by + 11, isHover ? PAL.ink : PAL.white, smallPx, false);
  }

  // -------- Sprite world bounds --------
  function fieldBounds() {
    const skyEnd = Math.floor(H * 0.35);
    return {
      minX: 16,
      maxX: W - 16,
      minY: skyEnd + 50, // below white house & path
      maxY: H - 16,
    };
  }

  function makeSprite(filing) {
    const h = hash32(filing.filer_slug || filing.filer_name || '');
    const b = fieldBounds();
    const rng = mulberry32(h);
    const colors = {
      suit:   pickFromHash(PAL.suits, h, 1),
      suitDk: pickFromHash(PAL.suitsDk, h, 1),
      skin:   pickFromHash(PAL.skins, h, 7),
      skinDk: pickFromHash(PAL.skinsDk, h, 7),
      tie:    pickFromHash(PAL.ties, h, 13),
      hair:   pickFromHash(PAL.hairs, h, 19),
    };
    const x = b.minX + rng() * (b.maxX - b.minX);
    const y = b.minY + rng() * (b.maxY - b.minY);
    const angle = rng() * Math.PI * 2;
    const speed = 8 + rng() * 8; // px/sec
    return {
      filing,
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      walkPhase: 0,
      walkT: rng() * 0.25,
      changeIn: 1.5 + rng() * 3,
      state: 'wander',     // 'wander' | 'interact'
      stateT: 0,
      partnerIdx: -1,
      colors,
      seed: h,
    };
  }

  // -------- Update loop --------
  function update(dt) {
    const b = fieldBounds();
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      s.walkT += dt;
      if (s.walkT >= 0.22) { s.walkT = 0; s.walkPhase++; }

      if (s.state === 'interact') {
        s.stateT -= dt;
        if (s.stateT <= 0) {
          // resume wandering with a small kick away from partner
          const partner = sprites[s.partnerIdx];
          if (partner) {
            const dx = s.x - partner.x;
            const dy = s.y - partner.y;
            const d = Math.hypot(dx, dy) || 1;
            const sp = 10 + Math.random() * 6;
            s.vx = (dx / d) * sp;
            s.vy = (dy / d) * sp;
          } else {
            const a = Math.random() * Math.PI * 2;
            s.vx = Math.cos(a) * 12;
            s.vy = Math.sin(a) * 12;
          }
          s.state = 'wander';
          s.partnerIdx = -1;
          s.changeIn = 1.5 + Math.random() * 3;
        }
        continue; // don't move while interacting
      }

      s.x += s.vx * dt;
      s.y += s.vy * dt;

      // Bounds reflection
      if (s.x < b.minX) { s.x = b.minX; s.vx = Math.abs(s.vx); }
      if (s.x > b.maxX) { s.x = b.maxX; s.vx = -Math.abs(s.vx); }
      if (s.y < b.minY) { s.y = b.minY; s.vy = Math.abs(s.vy); }
      if (s.y > b.maxY) { s.y = b.maxY; s.vy = -Math.abs(s.vy); }

      s.changeIn -= dt;
      if (s.changeIn <= 0) {
        const a = Math.random() * Math.PI * 2;
        const sp = 6 + Math.random() * 12;
        s.vx = Math.cos(a) * sp;
        s.vy = Math.sin(a) * sp;
        s.changeIn = 1.5 + Math.random() * 3;
      }
    }

    // Pair detection — when two sprites get within 14px, occasionally
    // start an interaction (face each other for ~2s).
    for (let i = 0; i < sprites.length; i++) {
      const a = sprites[i];
      if (a.state !== 'wander') continue;
      for (let j = i + 1; j < sprites.length; j++) {
        const c = sprites[j];
        if (c.state !== 'wander') continue;
        const dx = a.x - c.x;
        const dy = a.y - c.y;
        if (dx * dx + dy * dy < 14 * 14 && Math.random() < 0.05) {
          a.state = 'interact'; a.stateT = 1.6 + Math.random() * 1.4; a.partnerIdx = j;
          c.state = 'interact'; c.stateT = a.stateT;                  c.partnerIdx = i;
          a.vx = a.vy = 0;
          c.vx = c.vy = 0;
          break;
        }
      }
    }
  }

  // -------- Render --------
  function render() {
    // Background blit
    if (!bgCache) bgCache = buildBackground();
    ctx.drawImage(bgCache, 0, 0);

    // Sort sprites by Y for fake depth
    const order = sprites
      .map((_, i) => i)
      .sort((a, b) => sprites[a].y - sprites[b].y);

    // Determine hovered sprite
    let hoverIdx = -1;
    if (hoverState.x >= 0 && hoverState.y >= 0) {
      hoverIdx = pickSpriteAt(hoverState.x, hoverState.y);
    }

    for (const i of order) drawSprite(sprites[i], i === hoverIdx);
    for (const i of order) drawSpriteLabels(sprites[i], i === hoverIdx);

    // If interacting pairs, draw a small chat bubble above one
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      if (s.state === 'interact' && s.partnerIdx > i) {
        const p = sprites[s.partnerIdx];
        const cx = ((s.x + p.x) / 2) | 0;
        const cy = (Math.min(s.y, p.y) | 0) - 38;
        drawChatBubble(cx, cy);
      }
    }
  }

  function drawChatBubble(cx, cy) {
    const w = 18, h = 10;
    rect('rgba(0,0,0,0.4)', cx - w / 2 + 1, cy + 1, w, h);
    rect(PAL.paper, cx - w / 2, cy, w, h);
    rect(PAL.ink, cx - w / 2, cy, w, 1);
    rect(PAL.ink, cx - w / 2, cy + h - 1, w, 1);
    rect(PAL.ink, cx - w / 2, cy, 1, h);
    rect(PAL.ink, cx + w / 2 - 1, cy, 1, h);
    rect(PAL.ink, cx - 1, cy + h, 2, 1);
    text('...', cx - 6, cy + 2, PAL.ink, 5, true);
  }

  function pickSpriteAt(px, py) {
    // Search top-down (highest y last) so foreground wins.
    let pick = -1;
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      const x = s.x | 0;
      const yFeet = s.y | 0;
      const top = yFeet - 26;
      if (px >= x - 3 && px <= x + 14 && py >= top - 24 && py <= yFeet + 2) {
        if (pick < 0 || sprites[pick].y < s.y) pick = i;
      }
    }
    return pick;
  }

  // -------- Loop driver --------
  function frame(t) {
    if (!running()) { raf = 0; return; }
    if (!lastT) lastT = t;
    let dt = (t - lastT) / 1000;
    if (dt > 0.1) dt = 0.1;
    lastT = t;
    update(dt);
    render();
    raf = requestAnimationFrame(frame);
  }
  function running() { return !!canvas && !document.hidden; }

  // -------- Page wiring --------
  function loadPage() {
    const start = pageIndex * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);
    sprites = slice.map(makeSprite);
    document.getElementById('exec-page').textContent =
      filtered.length === 0
        ? 'NO MATCHES'
        : `PAGE ${pageIndex + 1}/${Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}`;
    document.getElementById('exec-range').textContent =
      filtered.length === 0
        ? '0'
        : `${start + 1}-${Math.min(start + PAGE_SIZE, filtered.length)} OF ${filtered.length}`;
    renderRoster();
  }

  function renderRoster() {
    const list = document.getElementById('exec-list');
    list.innerHTML = '';
    const shown = filtered.slice(0, 12);
    for (const f of shown) {
      const li = document.createElement('li');
      li.className = 'exec-roster-row';
      li.dataset.slug = f.filer_slug;
      const total = fmtMoney(f.total_estimated_value);
      const name = (f.filer_name || '?').replace(/\s*\(.*?\)\s*$/, '');
      li.innerHTML = `
        <span class="exec-roster-name">${escapeHTML(name)}</span>
        <span class="exec-roster-total">${total}</span>
      `;
      li.addEventListener('click', () => openModal(f.filer_slug));
      list.appendChild(li);
    }
  }

  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // -------- Filtering --------
  function applyFilter(query) {
    const q = (query || '').trim().toLowerCase();
    filtered = allFilings.filter(f => {
      const name = (f.filer_name || '').toLowerCase();
      // Drop PTRs and the meta doc — they aren't 278e annual disclosures.
      // The PTR titles in the wild have inconsistent whitespace so allow
      // any spacing between the words.
      if (/periodic\s+transaction\s+report/.test(name)) return false;
      if (name.includes('annual report to congress on white house staff')) return false;
      if (!q) return true;
      const pos = (f.position_line || '').toLowerCase();
      return name.includes(q) || pos.includes(q) ||
        (f.tickers || []).some(t => (t || '').toLowerCase().includes(q));
    });
    pageIndex = 0;
    loadPage();
  }

  // -------- Modal --------
  async function openModal(slug) {
    const modal = document.getElementById('exec-modal');
    const body = document.getElementById('exec-modal-body');
    modal.classList.add('open');
    body.innerHTML = `<div class="loading">LOADING...</div>`;
    try {
      const r = await fetch(`/api/executive/${encodeURIComponent(slug)}`);
      if (!r.ok) throw new Error('lookup failed');
      const data = await r.json();
      body.innerHTML = renderDisclosure(data);
    } catch (e) {
      body.innerHTML = `<div class="error">FAILED TO LOAD DISCLOSURE</div>`;
    }
  }

  function closeModal() {
    document.getElementById('exec-modal').classList.remove('open');
  }

  const SCHEDULE_TITLES = {
    positions: 'POSITIONS HELD',
    employment_assets: 'EMPLOYMENT ASSETS &amp; INCOME',
    employment_agreements: 'EMPLOYMENT AGREEMENTS',
    compensation_sources: 'COMPENSATION SOURCES',
    spouse_employment_assets: "SPOUSE'S EMPLOYMENT ASSETS",
    other_assets: 'OTHER ASSETS &amp; INCOME',
    transactions: 'TRANSACTIONS',
    liabilities: 'LIABILITIES',
    gifts_travel: 'GIFTS &amp; TRAVEL',
  };

  function renderDisclosure(d) {
    const h = d.header || {};
    const info = h.filer_information || {};
    const total = fmtMoney(d.total_estimated_value);
    const liab = fmtMoney(d.total_liabilities);
    const tickers = (d.tickers || []).slice(0, 30);
    const pdfBtn = d.pdf_url
      ? `<a class="btn-link" href="${escapeHTML(d.pdf_url)}" target="_blank" rel="noopener noreferrer">VIEW ORIGINAL PDF &#9654;</a>`
      : '';

    const unparsedMsg = {
      layout_unsupported: 'PDF LAYOUT NOT MACHINE-READABLE',
      scanned_no_text: 'SCANNED PDF WITHOUT EXTRACTABLE TEXT',
      download_failed: 'PDF DOWNLOAD FAILED &mdash; TRY AGAIN LATER',
    }[d.parse_status];
    if (unparsedMsg) {
      return `
        <h2 class="exec-modal-title">${escapeHTML(d.filer_name || '')}</h2>
        <div class="exec-modal-pos">${escapeHTML(info.position_line || '')}</div>
        <div class="exec-modal-warn">${unparsedMsg} &mdash; OPEN ORIGINAL TO VIEW</div>
        <div class="exec-modal-actions">${pdfBtn}</div>
      `;
    }

    const tickerChips = tickers.length
      ? `<div class="exec-tickers">${tickers.map(t => `<span class="exec-chip">${escapeHTML(t)}</span>`).join('')}</div>`
      : '';

    const schedules = d.schedules || {};
    const sections = Object.keys(SCHEDULE_TITLES)
      .filter(k => (schedules[k] || []).length)
      .map(k => renderSchedule(k, schedules[k]))
      .join('');

    const metaParts = [
      h.report_type && `REPORT: ${escapeHTML(h.report_type)}`,
      h.annual_year && `ANNUAL YEAR: ${escapeHTML(h.annual_year)}`,
      h.date_of_appointment && `APPOINTED: ${escapeHTML(h.date_of_appointment)}`,
      h.appointment_type && `TYPE: ${escapeHTML(h.appointment_type)}`,
    ].filter(Boolean).map(s => `<span>${s}</span>`).join('');

    return `
      <h2 class="exec-modal-title">${escapeHTML(d.filer_name || '')}</h2>
      <div class="exec-modal-pos">${escapeHTML(info.position_line || '')}</div>
      <div class="exec-modal-meta">${metaParts}</div>
      <div class="exec-totals">
        <div class="exec-total-card">
          <div class="exec-total-label">EST. ASSETS</div>
          <div class="exec-total-value">${total}</div>
        </div>
        <div class="exec-total-card">
          <div class="exec-total-label">LIABILITIES</div>
          <div class="exec-total-value">${liab}</div>
        </div>
      </div>
      ${tickerChips}
      <div class="exec-modal-actions">${pdfBtn}</div>
      ${sections}
    `;
  }

  function flagOf(r) {
    return r.parse_quality && r.parse_quality !== 'ok'
      ? `<span class="exec-row-flag">${escapeHTML(r.parse_quality.toUpperCase())}</span>` : '';
  }

  function renderPositionRow(r) {
    const org = escapeHTML(r.description || r.raw || '');
    const role = r.position ? `<b>${escapeHTML(r.position)}</b>` : '';
    const where = r.city_state ? escapeHTML(r.city_state) : '';
    const orgType = r.organization_type ? escapeHTML(r.organization_type) : '';
    const span = (r.from || r.to)
      ? `${escapeHTML(r.from || '?')} &rarr; ${escapeHTML(r.to || '?')}`
      : '';
    const subParts = [role, orgType, where].filter(Boolean).join(' &middot; ');
    return `
      <li class="exec-row">
        <div class="exec-row-main">
          <span class="exec-row-desc">${org}</span>${flagOf(r)}
          ${subParts ? `<div class="exec-row-sub">${subParts}</div>` : ''}
        </div>
        ${span ? `<div class="exec-row-value">${span}</div>` : ''}
      </li>
    `;
  }

  function renderLiabilityRow(r) {
    const desc = escapeHTML(r.description || r.raw || '');
    const type = r.liability_type ? `<b>${escapeHTML(r.liability_type)}</b>` : '';
    const terms = [
      r.rate && `${escapeHTML(r.rate)}`,
      r.term && `${escapeHTML(r.term)}`,
      r.year_incurred && `since ${escapeHTML(r.year_incurred)}`,
    ].filter(Boolean).join(' &middot; ');
    const subParts = [type, terms].filter(Boolean).join(' &middot; ');
    return `
      <li class="exec-row">
        <div class="exec-row-main">
          <span class="exec-row-desc">${desc}</span>${flagOf(r)}
          ${subParts ? `<div class="exec-row-sub">${subParts}</div>` : ''}
        </div>
        ${r.amount ? `<div class="exec-row-value">${escapeHTML(String(r.amount))}</div>` : ''}
      </li>
    `;
  }

  function renderAssetRow(r) {
    const desc = escapeHTML(r.description || r.raw || '');
    const value = r.value || r.amount || '';
    const income = r.income_amount && r.income_amount !== value ? r.income_amount : '';
    const ticker = r.ticker ? `<span class="exec-row-ticker">${escapeHTML(r.ticker)}</span>` : '';
    const eif = r.eif && r.eif !== 'N/A' && r.eif !== 'No' ? `<span class="exec-chip-mini">EIF</span>` : '';
    return `
      <li class="exec-row">
        <div class="exec-row-main">
          ${ticker}<span class="exec-row-desc">${desc}</span>${eif}${flagOf(r)}
          ${income ? `<div class="exec-row-sub">income: ${escapeHTML(String(income))}</div>` : ''}
        </div>
        ${value ? `<div class="exec-row-value">${escapeHTML(String(value))}</div>` : ''}
      </li>
    `;
  }

  const ROW_RENDERERS = {
    positions: renderPositionRow,
    liabilities: renderLiabilityRow,
  };

  function renderSchedule(key, rows) {
    const title = SCHEDULE_TITLES[key];
    const renderRow = ROW_RENDERERS[key] || renderAssetRow;
    const items = rows.map(renderRow).join('');
    return `
      <section class="exec-section">
        <h3 class="exec-section-title">${title} <span class="exec-section-count">(${rows.length})</span></h3>
        <ul class="exec-rows">${items}</ul>
      </section>
    `;
  }

  // -------- Wire up --------
  function init() {
    canvas = document.getElementById('field');
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      hoverState.x = ((e.clientX - r.left) * (W / r.width)) | 0;
      hoverState.y = ((e.clientY - r.top) * (H / r.height)) | 0;
      const idx = pickSpriteAt(hoverState.x, hoverState.y);
      canvas.style.cursor = idx >= 0 ? 'pointer' : 'default';
    });
    canvas.addEventListener('mouseleave', () => {
      hoverState.x = -1; hoverState.y = -1;
      canvas.style.cursor = 'default';
    });
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) * (W / r.width)) | 0;
      const y = ((e.clientY - r.top) * (H / r.height)) | 0;
      const idx = pickSpriteAt(x, y);
      if (idx >= 0) openModal(sprites[idx].filing.filer_slug);
    });

    document.getElementById('exec-prev').addEventListener('click', () => {
      const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      pageIndex = (pageIndex - 1 + pages) % pages;
      loadPage();
    });
    document.getElementById('exec-next').addEventListener('click', () => {
      const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      pageIndex = (pageIndex + 1) % pages;
      loadPage();
    });
    let searchT = 0;
    document.getElementById('exec-search').addEventListener('input', (e) => {
      const q = e.target.value;
      clearTimeout(searchT);
      searchT = setTimeout(() => applyFilter(q), 120);
    });
    document.getElementById('exec-modal-close').addEventListener('click', closeModal);
    document.getElementById('exec-modal').addEventListener('click', (e) => {
      if (e.target.id === 'exec-modal') closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
      if (e.key === 'ArrowLeft') document.getElementById('exec-prev').click();
      if (e.key === 'ArrowRight') document.getElementById('exec-next').click();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !raf) { lastT = 0; raf = requestAnimationFrame(frame); }
    });

    fetch('/api/executive')
      .then(r => r.json())
      .then(d => {
        allFilings = d.filings || [];
        applyFilter('');
        if (!raf) raf = requestAnimationFrame(frame);
      })
      .catch(() => {
        text('FAILED TO LOAD', W / 2, H / 2, PAL.red, 10, true);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // --- Embed hooks (opt-in: only fire when framed) ---
  //
  // Mirror app.js so any embedder can rely on the same protocol regardless
  // of which page is loaded. See app.js for full message-shape rationale.
  // Targets '*' because payloads are non-sensitive; embedders must verify
  // event.origin before acting.
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

  // .exec-nav holds the in-app back link to the index page; without the
  // carve-out, embedders would treat that click as "leave the embedded app"
  // and unmount the iframe before the in-frame nav completes.
  document.addEventListener('click', (e) => {
    if (window.parent === window) return;
    const inBanner = !!e.target.closest('.banner');
    const isAppNav = !!e.target.closest('.exec-nav');
    const area = (inBanner && !isAppNav) ? 'chrome' : 'app';
    postParent({ type: 'politicians:click', area });
  });

  // Announce initial route once the document is parsed so the embedder can
  // sync its URL bar (covers both fresh loads and in-frame navigation from
  // the index page, since the executive page is a full document load).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announceLocation);
  } else {
    announceLocation();
  }
})();
