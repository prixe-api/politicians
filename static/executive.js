// Executive Wing — pixel field where 278e filers wander with their
// estimated holdings floating overhead. Click a sprite for full disclosure.
(function () {
  const W = 720;
  const H = 360;
  const PAGE_SIZE = 20;

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
    ties:  ['#c83a3a', '#1c4a8c', '#e8c547', '#5a2a8c', '#2a8c5a', '#2a8c8c', '#8c5a2a'],
    hairs: ['#141414', '#3a2a1a', '#7a5a3a', '#a88860', '#d4b878'],
  };

  // Conversation pairs: [opener, reply]. When two filers bump into each
  // other on the lawn we pick one pair and play it back as a turn —
  // opener over speaker A for the first half of the interaction, brief
  // silent beat, then reply over speaker B for the second half. This
  // reads as a coherent exchange instead of a random utterance shared
  // between two people. Organized by topic so the back-and-forth makes
  // sense within a single conversation. Drawn from a shuffle bag
  // (`pickConversation`) so the same scene never repeats a pair.
  const CONVERSATIONS = [
    // ----- Greetings & farewells -----
    ["Cheers!", "Cheers!"],
    ["Howdy.", "Howdy yourself."],
    ["Morning!", "Morning."],
    ["Afternoon.", "And to you."],
    ["Top of the morning.", "And to you."],
    ["Good to see you.", "Likewise."],
    ["Long time, no see.", "Been a while."],
    ["Where've you been?", "Around."],
    ["Welcome back.", "Glad to be back."],
    ["Catch you later.", "Until next time."],

    // ----- Compliments / schmooze -----
    ["Looking sharp today.", "Trying my best."],
    ["Nice tie.", "Same to you."],
    ["Nice cufflinks.", "Anniversary gift."],
    ["Sharp suit.", "Bespoke, naturally."],
    ["Solid handshake.", "Years of practice."],
    ["Liked your op-ed.", "Appreciate it."],
    ["Great speech.", "Too kind."],
    ["Saw you on TV.", "Don't remind me."],
    ["Solid testimony.", "Brutal hearing."],
    ["Bold move.", "We'll see."],
    ["Smart play.", "Got lucky."],

    // ----- Family & life -----
    ["How's the family?", "Surviving. You?"],
    ["How's the kid?", "Growing fast."],
    ["How's the dog?", "Still chewing things."],
    ["Holding up?", "Just barely."],

    // ----- POTUS / West Wing shop talk -----
    ["How's POTUS?", "Restless."],
    ["POTUS just signed.", "About time."],
    ["Saw POTUS today.", "What's the mood?"],
    ["OMB blocked it.", "Of course they did."],
    ["OMB approved.", "Finally."],
    ["Counsel signed off.", "Big news."],
    ["Ethics flagged it.", "Uh oh."],
    ["Memo's circulating.", "Saw it. Yikes."],
    ["Cabinet pushback?", "Predictably."],
    ["Trust the plan.", "Always."],
    ["Saw the deck.", "Tell me they fixed slide 7."],
    ["SitRoom in 10.", "On my way."],

    // ----- Schedule / logistics -----
    ["Got a sec?", "Walk with me."],
    ["Briefing at noon.", "I'll be there."],
    ["Reschedule it.", "Already did."],
    ["Calendar's slammed.", "Same here."],
    ["Skip the briefing?", "I wish."],
    ["State dinner Thursday.", "Wouldn't miss it."],
    ["Cabinet meeting moved.", "To when?"],
    ["Mess hall menu?", "Disappointing, as always."],
    ["Pool spray at 11.", "Good luck out there."],
    ["Marine One inbound.", "Heard the rotor."],
    ["Inbox is bombing.", "Drowning here too."],

    // ----- Press / comms -----
    ["Press is brutal.", "When isn't it."],
    ["Off the record?", "Always."],
    ["Don't quote me.", "Wouldn't dream of it."],
    ["Background only.", "Got it."],
    ["Comms is on it.", "Hope so."],
    ["Sunday show prep.", "Brutal weekend."],
    ["Bad headline today.", "Saw it."],
    ["Talking points memo.", "Read it twice."],
    ["Twitter's a mess.", "It always is."],
    ["Press conference soon.", "I'll watch."],

    // ----- Hill mechanics -----
    ["Whip count's tight.", "Always is."],
    ["Markup tomorrow.", "Buckle up."],
    ["Floor vote Friday.", "Cutting it close."],
    ["Senate hearing prep.", "Brutal week."],
    ["Brief the Hill.", "I'll handle it."],
    ["Recess hits Friday.", "Thank god."],

    // ----- Disclosures / ethics (these are 278e filers, after all) -----
    ["Form 278 due.", "Already filed."],
    ["Saw your filing.", "Don't judge."],
    ["Big numbers!", "Good year, I guess."],
    ["Quite a portfolio.", "Inherited, mostly."],
    ["Blind trust, ha.", "Allegedly."],
    ["Recused myself.", "Wise."],
    ["Conflict cleared.", "Took forever."],
    ["Trust filed.", "About time."],

    // ----- Markets — macro -----
    ["Fed's hawkish.", "Predictable."],
    ["Powell's pivoting.", "About time."],
    ["Yields moved.", "Saw that."],
    ["Curve inverted.", "Recession bait."],
    ["Rate cut Q3?", "Wouldn't bet on it."],
    ["CPI prints today.", "Fingers crossed."],
    ["Jobs report Friday.", "Will be huge."],
    ["Crude's ripping.", "Geopolitics."],
    ["Banks are nervous.", "Should be."],
    ["Liquidity's tight.", "Brutal tape."],
    ["Markets are thin.", "Whippy day."],
    ["Vol's spiking.", "Hedge anyway."],

    // ----- Markets — equity -----
    ["Long the SPY.", "Brave."],
    ["Mag 7 carry.", "Until it doesn't."],
    ["AI bubble?", "Depends on the day."],
    ["NVDA again?", "Of course."],
    ["Tech earnings next week.", "Buckle up."],
    ["Small caps lagging.", "As always."],
    ["Value rotation?", "Maybe finally."],
    ["Quality's broken.", "Sad chart."],
    ["Tail hedge worth it?", "Always."],
    ["Wide moat play.", "Boring but solid."],
    ["Crypto's down.", "Buying it."],
    ["ETH's flying.", "Late to that party."],

    // ----- Trader-bro patter -----
    ["Buy the dip!", "Always."],
    ["Sell the news.", "Rookie move."],
    ["Buy the rumor.", "And sell the fact."],
    ["Bullish.", "Bearish, frankly."],
    ["Diamond hands.", "Until I'm not."],
    ["To the moon!", "Or zero."],
    ["Got any tips?", "Not from me."],
    ["Hot stock?", "Couldn't say."],
    ["NFA, but...", "I'll bite."],
    ["Stonks only go up.", "Until they don't."],
    ["Probably nothing.", "Probably everything."],
    ["Big if true.", "Source?"],

    // ----- Trumpisms (POTUS himself is a 278e filer) -----
    ["Many people are saying.", "Tremendous."],
    ["Believe me.", "I do."],
    ["Bigly day.", "Tremendous."],
    ["Best, perhaps ever.", "No doubt."],
    ["Sad!", "Very sad."],
    ["Very nice, very nice.", "The best."],
    ["MAGA.", "MAGA."],
    ["Nobody knew it was so complicated.", "Indeed."],

    // ----- Internet / meme -----
    ["Based.", "Cringe."],
    ["Mid energy.", "Skill issue."],
    ["Touch grass.", "I'm trying."],
    ["It's giving panic.", "Big yikes."],
    ["L take.", "W take, actually."],
    ["Bestie, no.", "Bestie, yes!"],
    ["We are so back.", "It's so over."],
    ["Trust me bro.", "Source: vibes."],
    ["No cap.", "On god."],
    ["This you?", "Couldn't be me."],

    // ----- Vague / filler responses -----
    ["Hmm.", "Indeed."],
    ["Quite.", "Right on."],
    ["We'll see.", "Stay tuned."],
    ["Roger that.", "Copy."],
    ["10-4.", "Affirmative."],
    ["Watch this space.", "Will do."],
    ["Splendid.", "Capital."],
    ["Off the cuff?", "Always."],

    // ----- Weather / lawn small talk -----
    ["Beautiful weather.", "For now."],
    ["Hot one today.", "Brutal."],
    ["Cold front coming.", "Heard that."],
    ["Cherry blossoms!", "Almost peak."],
    ["Garden looks nice.", "Doesn't it."],
    ["Spring's here.", "Finally."],
    ["Rain expected.", "Bring an umbrella."],
    ["Forecast looks good.", "Knock on wood."],

    // ----- DC dining -----
    ["Le Diplomate?", "Friday works."],
    ["Old Ebbitt?", "Booked."],
    ["Joe's Steak?", "Always solid."],
    ["Cafe Milano tonight?", "Count me in."],
    ["1789 reservation?", "Locked in."],
    ["Hay-Adams brunch?", "Sunday?"],
    ["Cosmos Club?", "Member's table."],
    ["Open bar at the thing?", "Hope so."],
    ["Need a coffee.", "Mess is open."],

    // ----- Vacation / travel -----
    ["Vacation when?", "Never, apparently."],
    ["Mar-a-Lago weekend?", "Tempting."],
    ["Camp David?", "Wish."],
    ["Bedminster?", "Maybe August."],
    ["Beach in August?", "If we survive."],
    ["Skiing this winter?", "Aspen, probably."],
  ];

  // ---- Compatibility shim: a few old code paths reference QUOTES.
  // Keep it as a flat list of every line so anything still calling the
  // old single-utterance API still works. Prefer `pickConversation()`.
  const QUOTES = CONVERSATIONS.flat();

  // Shuffle bag of conversation pairs — guarantees no repeats within
  // a scene. Reset on `loadPage()` so each fresh page starts with a
  // complete deck. Pop returns `[opener, reply]`.
  let conversationBag = [];

  function pickConversation() {
    if (conversationBag.length === 0) {
      conversationBag = CONVERSATIONS.slice();
      for (let i = conversationBag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = conversationBag[i]; conversationBag[i] = conversationBag[j]; conversationBag[j] = tmp;
      }
    }
    return conversationBag.pop();
  }

  // Scene state
  let canvas = null;
  let ctx = null;
  let raf = 0;
  let lastT = 0;
  let allFilings = [];
  let filtered = [];
  let viewPage = 0;        // current page index into `filtered`
  let sprites = [];
  // Arrival queue: filings waiting to walk on from off-screen. Drained by
  // `update()` on a fixed cadence so sprites stream in instead of popping
  // into existence all at once when data lands.
  let pendingArrivals = [];
  let arrivalCooldown = 0;             // seconds until next sprite spawns
  const ARRIVAL_INTERVAL = 0.12;       // ~8 sprites/sec; ~24s for 200 filers
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
    const scale = s.scale || 1;

    // For 2× principals (Trump / Vance) we anchor the canvas transform
    // at the bottom-center of the sprite so the feet stay planted on
    // the lawn while the rest of the figure grows upward and outward.
    if (scale !== 1) {
      ctx.save();
      const ax = x + 6;
      ctx.translate(ax, yFeet);
      ctx.scale(scale, scale);
      ctx.translate(-ax, -yFeet);
    }

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

    if (scale !== 1) ctx.restore();
  }

  function drawSpriteLabels(s, isHover) {
    const scale = s.scale || 1;
    const x = s.x | 0;
    const top = (s.y | 0) - 26 * scale;
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
    // POTUS / VPOTUS render at 2× — they're the principals and should
    // read as such from across the lawn.
    const slug = filing.filer_slug || '';
    const scale = (slug === 'president_donald_j_trump' || slug === 'vice_president_jd_vance') ? 2 : 1;
    return {
      filing,
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      walkPhase: 0,
      walkT: rng() * 0.25,
      changeIn: 1.5 + rng() * 3,
      state: 'wander',     // 'wander' | 'interact' | 'enter'
      stateT: 0,
      partnerIdx: -1,
      targetX: x,
      targetY: y,
      colors,
      scale,
      bubbleText: '',
      seed: h,
    };
  }

  // Wraps `makeSprite` and overrides spawn position to just off the left
  // edge of the canvas. The sprite walks toward its deterministic
  // (filing-slug-hashed) target inside the field; once it's close enough,
  // `update()` flips it to the normal 'wander' state.
  function makeEnteringSprite(filing) {
    const s = makeSprite(filing);
    const b = fieldBounds();
    s.targetX = s.x;
    s.targetY = s.y;
    s.x = b.minX - 24;             // off-screen to the left
    s.state = 'enter';
    s.stateT = 0;
    const dx = s.targetX - s.x;
    const dy = s.targetY - s.y;
    const d = Math.hypot(dx, dy) || 1;
    const speed = 26 + Math.random() * 10;   // px/sec — brisker than wandering
    s.vx = (dx / d) * speed;
    s.vy = (dy / d) * speed;
    return s;
  }

  // -------- Update loop --------
  function update(dt) {
    const b = fieldBounds();

    // Drain the arrival queue at a fixed cadence so filers stream in.
    if (pendingArrivals.length > 0) {
      arrivalCooldown -= dt;
      let spawned = false;
      while (arrivalCooldown <= 0 && pendingArrivals.length > 0) {
        sprites.push(makeEnteringSprite(pendingArrivals.shift()));
        arrivalCooldown += ARRIVAL_INTERVAL;
        spawned = true;
      }
      if (spawned) updatePagerText();
    }

    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      s.walkT += dt;
      if (s.walkT >= 0.22) { s.walkT = 0; s.walkPhase++; }

      // 'enter' — walking on from off-screen toward the deterministic target.
      // Bounds reflection is intentionally skipped here so x can climb up
      // from negative without bouncing back off the left wall.
      if (s.state === 'enter') {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const ddx = s.targetX - s.x;
        const ddy = s.targetY - s.y;
        if (ddx * ddx + ddy * ddy < 36) {
          s.state = 'wander';
          const a = Math.random() * Math.PI * 2;
          const sp = 8 + Math.random() * 10;
          s.vx = Math.cos(a) * sp;
          s.vy = Math.sin(a) * sp;
          s.changeIn = 1.5 + Math.random() * 3;
        }
        continue;
      }

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

    // Pair detection — when two sprites get close, occasionally start
    // an interaction (face each other and exchange a quote). Detection
    // radius scales with the larger of the two sprites so the 2×
    // principals don't get walked-through silently.
    for (let i = 0; i < sprites.length; i++) {
      const a = sprites[i];
      if (a.state !== 'wander') continue;
      for (let j = i + 1; j < sprites.length; j++) {
        const c = sprites[j];
        if (c.state !== 'wander') continue;
        const dx = a.x - c.x;
        const dy = a.y - c.y;
        const r = 14 * Math.max(a.scale || 1, c.scale || 1);
        if (dx * dx + dy * dy < r * r && Math.random() < 0.05) {
          // Each interaction is one [opener, reply] pair. The opener
          // shows above sprite A for the first half, then a short
          // silent beat, then the reply shows above sprite B. Total
          // duration scales with the longer of the two utterances so
          // a wordy line still has time to be read.
          const pair = pickConversation();
          const opener = pair[0];
          const reply = pair[1];
          const lengthBoost = (opener.length + reply.length) * 0.025;
          const dur = 3.4 + lengthBoost + Math.random() * 0.6;
          a.state = 'interact'; a.stateT = dur; a.stateT0 = dur; a.partnerIdx = j; a.bubbleText = opener;
          c.state = 'interact'; c.stateT = dur; c.stateT0 = dur; c.partnerIdx = i; c.bubbleText = reply;
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

    // Interacting pairs play back a turn-based exchange. The opener
    // (sprite at lower index, set at interaction-start) shows for the
    // first ~45% of the duration; a short silent beat; then the reply
    // shows for the last ~45%. The bubble anchors above whichever
    // sprite is currently speaking so it's clear who said what.
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      if (s.state !== 'interact' || s.partnerIdx <= i) continue;
      const p = sprites[s.partnerIdx];
      const dur = s.stateT0 || 1;
      const progress = 1 - s.stateT / dur;     // 0 → 1 over interaction
      let speaker = null;
      if (progress < 0.45)       speaker = s;
      else if (progress > 0.55)  speaker = p;
      // 0.45..0.55 is intentionally silent — natural beat between turns
      if (!speaker) continue;
      const sc = speaker.scale || 1;
      const topSpeaker = (speaker.y | 0) - 26 * sc;
      const cx = (speaker.x | 0) + 6;
      const cy = topSpeaker - 14;
      drawChatBubble(cx, cy, speaker.bubbleText || '...');
    }
  }

  function wrapBubbleText(s, maxW, px) {
    const words = String(s || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const cand = cur ? cur + ' ' + w : w;
      if (measure(cand, px, true) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = cand;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function drawChatBubble(cx, cy, txt) {
    const PX = 7;
    const padX = 5;
    const padY = 6;       // a touch taller — gives the text more room
    const lineH = PX + 5; // bumped from PX+3 so multi-line bubbles breathe
    const lines = wrapBubbleText(txt, 130, PX);
    const lineWs = lines.map(l => measure(l, PX, true));
    const w = Math.max(16, Math.ceil(Math.max.apply(null, lineWs)) + padX * 2);
    const h = lines.length * lineH - 2 + padY * 2;
    // Clamp the bubble inside the canvas so a quote doesn't get cut off
    const x0 = Math.max(2, Math.min(W - w - 2, cx - w / 2)) | 0;
    const y0 = Math.max(2, cy - h) | 0;

    rect('rgba(0,0,0,0.4)', x0 + 1, y0 + 1, w, h);
    rect(PAL.paper, x0, y0, w, h);
    rect(PAL.ink, x0, y0, w, 1);
    rect(PAL.ink, x0, y0 + h - 1, w, 1);
    rect(PAL.ink, x0, y0, 1, h);
    rect(PAL.ink, x0 + w - 1, y0, 1, h);
    // Tail pointing toward the speakers
    const tailX = Math.max(x0 + 2, Math.min(x0 + w - 4, (cx | 0) - 1));
    rect(PAL.ink, tailX, y0 + h, 2, 1);

    for (let i = 0; i < lines.length; i++) {
      textCentered(lines[i], x0 + w / 2, y0 + padY + i * lineH, PAL.ink, PX, true);
    }
  }

  function pickSpriteAt(px, py) {
    // Search top-down (highest y last) so foreground wins.
    let pick = -1;
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      const sc = s.scale || 1;
      const x = s.x | 0;
      const yFeet = s.y | 0;
      const top = yFeet - 26 * sc;
      // Sprite anchor is at x+6 (bottom-center). Width grows outward
      // from there with scale. Vertical hit zone extends 24px above
      // the head for the floating label.
      const halfW = 6 * sc + 3;
      if (px >= x + 6 - halfW && px <= x + 6 + halfW
          && py >= top - 24 && py <= yFeet + 2) {
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
  // Window `filtered` to PAGE_SIZE entries and queue them onto the
  // lawn from off-screen. Streaming background fetches keep growing
  // `filtered`, but the visible scene is bounded to one page so the
  // grass doesn't turn into a stampede. Prev/next + arrow keys cycle
  // through pages.
  function pageCount() {
    return Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  }

  function loadPage(idx) {
    const pages = pageCount();
    viewPage = ((idx % pages) + pages) % pages;
    const start = viewPage * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);
    sprites = [];
    pendingArrivals = slice;
    arrivalCooldown = 0;
    conversationBag = []; // fresh shuffle for the new scene; no repeated exchanges
    updatePagerText();
    renderRoster();
  }

  // Re-load the current page in place. Used when the filter changes
  // (resets to page 0) or when a brand-new streamed batch happens to
  // change which filers fall on the visible page.
  function reloadCurrentPage() {
    loadPage(viewPage);
  }

  function updatePagerText() {
    const total = filtered.length;
    const pages = pageCount();
    const start = viewPage * PAGE_SIZE;
    const end = Math.min(start + PAGE_SIZE, total);
    const pageEl = document.getElementById('exec-page');
    const rangeEl = document.getElementById('exec-range');
    if (total === 0) {
      pageEl.textContent = 'NO MATCHES';
      rangeEl.textContent = '0';
    } else {
      pageEl.textContent = `PAGE ${viewPage + 1}/${pages}`;
      rangeEl.textContent = `${start + 1}-${end} OF ${total}`;
    }
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
  let lastQuery = '';

  function filterPredicate(f, q) {
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
  }

  function sortByTotalDesc(a, b) {
    return (b.total_estimated_value || 0) - (a.total_estimated_value || 0);
  }

  function applyFilter(query) {
    lastQuery = (query || '').trim().toLowerCase();
    filtered = allFilings.filter(f => filterPredicate(f, lastQuery));
    filtered.sort(sortByTotalDesc);
    loadPage(0);
  }

  // Called after each streamed page lands. Dedupes by slug and appends
  // new matches to `filtered` (kept sorted by total desc). Refreshes
  // the pager + roster so the user sees the new page count and
  // top-holdings list update, but does NOT pull the user off their
  // current page — the lawn stays stable while data streams in.
  function appendFilings(newOnes) {
    const seen = new Set(allFilings.map(f => f.filer_slug));
    const fresh = (newOnes || []).filter(f => f.filer_slug && !seen.has(f.filer_slug));
    if (!fresh.length) return;
    allFilings = allFilings.concat(fresh);
    const matching = fresh.filter(f => filterPredicate(f, lastQuery));
    if (matching.length) {
      filtered = filtered.concat(matching);
      filtered.sort(sortByTotalDesc);
    }
    updatePagerText();
    renderRoster();
    reconcileVisiblePage();
  }

  // Bring the visible page (sprites on lawn + pending arrivals) in
  // line with the current top-N of `filtered`. Streaming is sorted by
  // total desc but data arrives in upstream order (alphabetical), so a
  // late-arriving high-value filer (e.g. Trump, who's in offset ~150)
  // would otherwise never reach page 1 unless the user manually
  // navigated away and back. This preserves continuity for filers who
  // are still on the page (they keep their positions and walk-cycle)
  // while displacing the ones that just lost their spot.
  function reconcileVisiblePage() {
    const start = viewPage * PAGE_SIZE;
    const newSlice = filtered.slice(start, start + PAGE_SIZE);
    if (newSlice.length === 0) return;
    const newSlugs = new Set(newSlice.map(f => f.filer_slug));

    sprites = sprites.filter(s => newSlugs.has(s.filing.filer_slug));
    pendingArrivals = pendingArrivals.filter(f => newSlugs.has(f.filer_slug));

    const known = new Set(
      sprites.map(s => s.filing.filer_slug).concat(
        pendingArrivals.map(f => f.filer_slug)
      )
    );
    for (const f of newSlice) {
      if (!known.has(f.filer_slug)) pendingArrivals.push(f);
    }
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

    document.getElementById('exec-prev').addEventListener('click', () => loadPage(viewPage - 1));
    document.getElementById('exec-next').addEventListener('click', () => loadPage(viewPage + 1));
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
      if (e.key === 'ArrowLeft') loadPage(viewPage - 1);
      if (e.key === 'ArrowRight') loadPage(viewPage + 1);
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !raf) { lastT = 0; raf = requestAnimationFrame(frame); }
    });

    if (!raf) raf = requestAnimationFrame(frame);
    streamFilings();
  }

  // Fetch filings one page-of-50 at a time, appending each batch to the
  // arrival queue. Sequential — firing pages in parallel risks blowing
  // the upstream's PDF-scrape budget. Each page is retried with
  // exponential backoff (4s → 64s, ~2min total) because cold scrapes
  // routinely 504 through the API Gateway: the upstream keeps caching
  // PDFs in the background during failed requests, so a later attempt
  // for the same offset usually succeeds once enough rows are warm.
  // Stops when `total` is reached or the upstream returns a short page.
  async function streamFilings() {
    const PAGE = 50;
    const BACKOFFS = [4000, 8000, 16000, 32000, 64000]; // ~2min/page budget
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      let data = null;
      for (let attempt = 0; attempt <= BACKOFFS.length && !data; attempt++) {
        try {
          const r = await fetch(`/api/executive?limit=${PAGE}&offset=${offset}`);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          data = await r.json();
        } catch (e) {
          if (attempt >= BACKOFFS.length) break;
          await new Promise(res => setTimeout(res, BACKOFFS[attempt]));
        }
      }
      if (!data) {
        // Wedged page after exhausting retries. Surface the partial
        // state — sprites that already arrived keep animating, and a
        // refresh after the upstream warms picks up the rest.
        if (allFilings.length === 0) {
          text('FAILED TO LOAD', W / 2, H / 2, PAL.red, 10, true);
        }
        return;
      }
      const batch = data.filings || [];
      if (typeof data.total === 'number') total = data.total;
      appendFilings(batch);
      if (batch.length < PAGE) break;
      offset += PAGE;
    }
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
