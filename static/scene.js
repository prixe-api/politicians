// Zelda-style auction scene with per-state backgrounds.
// Politician is a neutral silhouette (grey fedora + coat); transaction type is
// conveyed through the carried item, bubbles, and the state banner color.
(function () {
  const W = 540;
  const H = 220;

  const PAL = {
    grass:    '#1a5c2e',
    grassDk:  '#0e3320',
    grassLt:  '#2e8849',
    dirt:     '#a57139',
    dirtLt:   '#d4a867',
    dirtDk:   '#6a4620',
    stone:    '#cfbb90',
    stoneDk:  '#7a6e47',
    wood:     '#6b4822',
    woodLt:   '#8c5e2f',
    gold:     '#e8c547',
    goldDk:   '#a9892e',
    ink:      '#0d0d0d',
    white:    '#f5efd6',
    paper:    '#ecdca2',
    red:      '#e35259',
    green:    '#44d47e',
    // Neutral politician palette
    hat:      '#2a2a2a',
    hatBand:  '#141414',
    face:     '#a88660',
    faceDk:   '#7a5c3e',
    coat:     '#4a4a4a',
    coatDk:   '#2a2a2a',
    pants:    '#141414',
    shoes:    '#141414',
    // Broker palette (fixed character)
    brokerSuit:   '#1c2a56',
    brokerSuitDk: '#0e1632',
    brokerSkin:   '#f4c896',
    brokerSkinDk: '#c98f5a',
    brokerTie:    '#c83a3a',
    brokerHair:   '#141414',
  };

  // World geometry
  const BANK = { x: 40, y: 60, w: 104, h: 104 };
  const DESK = { x: 360, y: 140, w: 120, h: 34 };
  const PATH_Y = 180;
  const POLITICIAN_Y = 166;
  const BANK_DOOR_X = BANK.x + BANK.w / 2 - 6;
  const POL_DESK_STOP = DESK.x - 16;

  // Bubble font size
  const BUBBLE_PX = 8;
  const BUBBLE_LINE_GAP = 4;

  // Canvas/state
  let canvas = null;
  let ctx = null;
  let lastT = 0;
  let running = false;
  let rafId = 0;

  const S = {
    lot: null,
    group: [],
    script: [],
    stepIndex: -1,
    step: null,
    stepT: 0,
    polX: -20,
    polAlpha: 1,
    walkPhase: 0,
    walkPhaseT: 0,
    gavelPhase: 'rest',
    gavelT: 0,
    carried: 'nothing',
    amountLabel: '',
    tickerLabel: '',
    bubble: null,
    flashT: 0,
    isBuy: true,
    txType: null,
    doneFired: false,
    paused: false,
  };

  // -------- Formatters --------
  function fmtMax(n) {
    if (!n && n !== 0) return '$?';
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
    return `$${n}`;
  }

  // -------- Canvas primitives --------
  function rect(color, x, y, w, h) {
    ctx.fillStyle = color;
    ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  }
  function outlineRect(color, x, y, w, h) {
    rect(color, x, y, w, 1);
    rect(color, x, y + h - 1, w, 1);
    rect(color, x, y, 1, h);
    rect(color, x + w - 1, y, 1, h);
  }
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
  function wrapText(s, maxW, px, bold = false) {
    const prev = ctx.font;
    ctx.font = `${bold ? 'bold ' : ''}${px}px "Press Start 2P", monospace`;
    const words = String(s || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const cand = cur ? cur + ' ' + w : w;
      if (ctx.measureText(cand).width > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = cand;
      }
    }
    if (cur) lines.push(cur);
    ctx.font = prev;
    return lines;
  }
  function skyGradient(top, bot, yStart = 0, yEnd = 100) {
    for (let y = yStart; y < yEnd; y++) {
      const t = (y - yStart) / (yEnd - yStart);
      const r = lerpChan(top, bot, t, 0);
      const g = lerpChan(top, bot, t, 1);
      const b = lerpChan(top, bot, t, 2);
      rect(`rgb(${r},${g},${b})`, 0, y, W, 1);
    }
  }
  function hex2rgb(h) {
    const n = parseInt(h.replace('#', ''), 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  function lerpChan(a, b, t, ch) {
    const A = hex2rgb(a), B = hex2rgb(b);
    return Math.round(A[ch] + (B[ch] - A[ch]) * t);
  }

  // -------- Public API --------
  function init(el) {
    canvas = el;
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    running = true;
    if (typeof document !== 'undefined' && !init._visBound) {
      init._visBound = true;
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { lastT = 0; requestFrame(); }
      });
    }
    render();
    requestFrame();
  }

  function setLot(t) {
    // Accept either a single transaction object or an array of transactions
    // (group: same politician on the same transaction_date).
    const group = Array.isArray(t) ? t.slice() : (t ? [t] : []);
    S.group = group;
    S.lot = group[0] || null;
    S.doneFired = false;
    S.polX = -18;
    S.polAlpha = 1;
    S.carried = 'nothing';
    S.amountLabel = '';
    S.tickerLabel = '';
    S.bubble = null;
    S.gavelPhase = 'rest';
    S.gavelT = 0;
    S.flashT = 0;
    S.paused = false;
    S.isBuy = (S.lot && S.lot.transaction_type === 'purchase');
    S.txType = S.lot ? S.lot.transaction_type : null;
    S.script = group.length ? buildScript(group) : [];
    S.stepIndex = -1;
    advance();
    lastT = 0;
    requestFrame();
  }

  function isIdle() { return S.stepIndex >= S.script.length; }
  function setPaused(v) {
    const next = !!v;
    if (S.paused === next) return;
    S.paused = next;
    if (!S.paused) { lastT = 0; requestFrame(); }
  }

  // Short type hints used when the asset_type isn't a standard stock
  const TYPE_SHORT = {
    OP: 'OPT',   CS: 'BOND',  GS: 'GBOND', MF: 'FUND',
    ET: 'ETF',   HN: 'HF',    PS: 'PS',    RS: 'RS',
    OT: '',      BA: 'BANK',  FA: 'FX',    SA: 'SAV',
    VS: 'VAR',   VA: 'ANN',   DN: 'DIG',   CT: 'CRYP',
    FI: 'FI',    IF: 'IDX',
  };

  function tickerOf(t) {
    if (!t) return '?';
    const type = (t.asset_type || '').toUpperCase();
    if (t.ticker) {
      const base = t.ticker.toUpperCase();
      if (type === 'ST' || !TYPE_SHORT[type]) return base.slice(0, 8);
      return (base.slice(0, 5) + '-' + TYPE_SHORT[type]).slice(0, 10);
    }
    const first = (t.asset_name || '?').replace(/[^A-Za-z0-9]/g, ' ').trim().split(/\s+/)[0] || '?';
    return first.toUpperCase().slice(0, 10);
  }

  // Classify the filer's free-text `description` so we can tailor dialogue.
  // Returns { kind, ...fields } or null if nothing interesting detected.
  // More specific matches run first so they win over generic "advisor" catch-all.
  function parseDescription(desc) {
    if (!desc) return null;
    const s = String(desc).trim();

    // --- Option mechanics (long form) ---
    let m = s.match(/Exercised\s+([\d,]+)\s+call\s+option.*?strike\s+price\s+of\s+\$?([\d,.]+)/i);
    if (m) return { kind: 'exerciseCall', count: m[1], strike: m[2] };

    m = s.match(/Exercised\s+([\d,]+)\s+put\s+option.*?strike\s+price\s+of\s+\$?([\d,.]+)/i);
    if (m) return { kind: 'exercisePut', count: m[1], strike: m[2] };

    m = s.match(/Purchased\s+([\d,]+)\s+call\s+option.*?strike\s+price\s+of\s+\$?([\d,.]+)/i);
    if (m) return { kind: 'buyCall', count: m[1], strike: m[2] };

    m = s.match(/Purchased\s+([\d,]+)\s+put\s+option.*?strike\s+price\s+of\s+\$?([\d,.]+)/i);
    if (m) return { kind: 'buyPut', count: m[1], strike: m[2] };

    m = s.match(/Sold\s+([\d,]+)\s+call\s+option.*?strike\s+price\s+of\s+\$?([\d,.]+)/i);
    if (m) return { kind: 'sellCall', count: m[1], strike: m[2] };

    // --- Option mechanics (Gottheimer-style short form: "Call options; Strike price $325; Expires ...") ---
    m = s.match(/call\s+option[s;,]?\s*strike\s+price\s*\$?([\d,.]+)/i);
    if (m) return { kind: 'buyCallShort', strike: m[1] };

    m = s.match(/put\s+option[s;,]?\s*strike\s+price\s*\$?([\d,.]+)/i);
    if (m) return { kind: 'buyPutShort', strike: m[1] };

    // --- Corporate actions ---
    if (/received\s+(?:thru|through|via)\s+merger|received\s+.*as\s+(?:a\s+)?result\s+of\s+merger|merger\s+shares\s+received/i.test(s)) {
      return { kind: 'mergerIn' };
    }
    if (/surrendered\s+(?:thru|through|via)\s+merger|surrendered\s+in\s+(?:the\s+)?merger/i.test(s)) {
      return { kind: 'mergerOut' };
    }
    if (/spin-?off/i.test(s)) {
      const parent = s.match(/(?:from|of)\s+([A-Z][A-Za-z.& ]{2,30})(?:\s+Corporation|\s+Inc|\s+Company|\.|,|$)/);
      return { kind: 'spinoff', parent: parent ? parent[1].trim() : null };
    }
    if (/directors?\s+executed|corporate\s+action|reorganization/i.test(s)) {
      return { kind: 'corporateAction' };
    }

    // --- Dividends / DRIPs ---
    // "Dividend reinvestment" or the filer's common typo "Divided reinvestment"
    if (/div(?:idend|ided)\s+reinvestment|DRIP\b/i.test(s)) {
      return { kind: 'divReinvest' };
    }

    // --- Structured products (Biggs pattern) ---
    if (/structured\s+(?:investment\s+)?(?:product|note)/i.test(s)) {
      const under = s.match(/based\s+on\s+\(?\s*([A-Z]{2,6})/);
      const basket = s.match(/\(\s*([A-Z]{2,6}(?:\s*&\s*[A-Z]{2,6}){0,3})\s*\)/);
      return { kind: 'structured', ref: under ? under[1] : (basket ? basket[1].replace(/\s+/g, '') : null) };
    }

    // --- Charitable transfers ---
    if (/Donor-?Advised\s+Fund|DAF\b|charity|charitable/i.test(s)) {
      m = s.match(/(?:Contribution of|of)\s+([\d,]+)\s+shares/i);
      return { kind: 'daf', count: m ? m[1] : null };
    }

    // --- Foreign ticker hint (Cisneros pattern: "Ticker 9988 HK") ---
    m = s.match(/^Ticker\s+([A-Z0-9.]{2,10}(?:\s+[A-Z]{2,3})?)\.?$/i);
    if (m) return { kind: 'foreignTicker', symbol: m[1].trim().toUpperCase() };

    // --- Paired / linked entries ---
    if (/see\s+.?(?:sale|purchase|exchange).?\s+transaction/i.test(s)) {
      return { kind: 'paired' };
    }

    // --- Low value disclosure ---
    if (/value\s*(?:is|was|after)?\s*(?:<|less than|under|below)\s*\$?\s*1[\s,]?000/i.test(s)) {
      return { kind: 'lowValue' };
    }

    // --- Share-count filings ---
    m = s.match(/Purchased\s+([\d,]+)\s+shares?/i);
    if (m) return { kind: 'buyShares', count: m[1] };

    m = s.match(/Sold\s+([\d,]+)\s+shares?/i);
    if (m) return { kind: 'sellShares', count: m[1] };

    if (/cash\s+in\s+lieu|fractional\s+shares?/i.test(s)) {
      return { kind: 'cashInLieu' };
    }

    // --- Generic advisor / managed / rebalancing (catch-all, must be last) ---
    if (/advisor|professionally\s+managed|managed\s+account|rebalanc/i.test(s)) {
      return { kind: 'advisor' };
    }

    return null;
  }

  // Politician's speech — prefers context from description when available.
  function speechLines(t, isBuy) {
    const ticker = tickerOf(t);
    const ctx = parseDescription(t.description);

    if (ctx) {
      switch (ctx.kind) {
        case 'exerciseCall':
          return [`EXERCISE MY`, `${ticker} CALLS`, `AT $${ctx.strike}!`];
        case 'exercisePut':
          return [`EXERCISE MY`, `${ticker} PUTS`, `AT $${ctx.strike}!`];
        case 'buyCall':
          return [`${ctx.count} CALLS ON`, `${ticker}`, `@ $${ctx.strike}!`];
        case 'buyPut':
          return [`${ctx.count} PUTS ON`, `${ticker}`, `@ $${ctx.strike}!`];
        case 'sellCall':
          return [`WRITE ${ctx.count}`, `${ticker} CALLS`, `@ $${ctx.strike}!`];
        case 'buyCallShort':
          return [`CALLS ON`, `${ticker}`, `@ $${ctx.strike}!`];
        case 'buyPutShort':
          return [`PUTS ON`, `${ticker}`, `@ $${ctx.strike}!`];
        case 'buyShares':
          return [`BUY ${ctx.count}`, `SHARES OF`, `${ticker}!`];
        case 'sellShares':
          return [`SELL ${ctx.count}`, `SHARES OF`, `${ticker}!`];
        case 'daf':
          return ctx.count
            ? [`GIFT ${ctx.count}`, `${ticker} SHARES`, `TO MY DAF`]
            : [`GIFT ${ticker}`, `TO MY DAF`];
        case 'spinoff':
          return ctx.parent
            ? [`${ticker} SPUN`, `OUT FROM`, ctx.parent.toUpperCase()]
            : [`${ticker} WAS`, `SPUN OFF!`];
        case 'mergerIn':
          return [`RECEIVE ${ticker}`, `VIA MERGER!`];
        case 'mergerOut':
          return [`SURRENDER`, `${ticker}`, `IN MERGER!`];
        case 'corporateAction':
          return [`CORPORATE`, `ACTION ON`, `${ticker}!`];
        case 'divReinvest':
          return [`REINVEST`, `${ticker}`, `DIVIDEND!`];
        case 'structured':
          return ctx.ref
            ? [`STRUCTURED`, `NOTE ON`, `${ctx.ref}!`]
            : [`STRUCTURED`, `PRODUCT!`];
        case 'foreignTicker':
          return [`OVERSEAS`, `BUY:`, ctx.symbol];
        case 'advisor':
          return isBuy
            ? [`MY ADVISOR`, `BOUGHT ${ticker}`]
            : [`MY ADVISOR`, `SOLD ${ticker}`];
        case 'lowValue':
          return isBuy ? [`SMALL BUY`, `${ticker}`] : [`SMALL SALE`, `${ticker}`];
        case 'paired':
          return isBuy
            ? [`TAKE ${ticker}`, `(PAIRED)`]
            : [`DROP ${ticker}`, `(PAIRED)`];
        case 'cashInLieu':
          return [`FRACTIONAL`, `${ticker} &`, `CASH!`];
      }
    }

    // Default: short ticker call, or wrapped asset name when no ticker
    if (t.ticker) {
      return isBuy ? ["I'LL TAKE", ticker + '!'] : ['CASH OUT', ticker + '!'];
    }
    const verb = isBuy ? "I'LL TAKE" : 'SELL';
    const name = (t.asset_name || ticker).toUpperCase();
    const wrapped = wrapText(name, 360, BUBBLE_PX, true);
    const maxLines = 5;
    const capped = wrapped.slice(0, maxLines);
    if (wrapped.length > maxLines) {
      capped[maxLines - 1] = capped[maxLines - 1].replace(/.{0,3}$/, '...');
    }
    return [verb, ...capped];
  }

  // Broker's reply — mirrors the transaction context so the exchange reads
  // like a real dialogue rather than a single barked "SOLD!".
  function brokerReplyLines(t, isBuy) {
    const ctx = parseDescription(t.description);
    if (ctx) {
      switch (ctx.kind) {
        case 'exerciseCall':
        case 'exercisePut':
          return [`STRIKE $${ctx.strike}`, 'SETTLED!'];
        case 'buyCall':
        case 'buyPut':
          return [`${ctx.count} CONTRACTS`, 'WRITTEN!'];
        case 'buyCallShort':
        case 'buyPutShort':
          return [`STRIKE $${ctx.strike}`, 'WRITTEN!'];
        case 'sellCall':
          return ['PREMIUM', 'COLLECTED!'];
        case 'buyShares':
          return [`${ctx.count} SHARES`, 'FILLED!'];
        case 'sellShares':
          return [`${ctx.count} SHARES`, isBuy ? 'DELIVERED!' : 'UNLOADED!'];
        case 'daf':
          return ['NOBLE', 'CAUSE!'];
        case 'spinoff':
          return ['SPINOFF', 'RECORDED.'];
        case 'mergerIn':
          return ['MERGER', 'SETTLED!'];
        case 'mergerOut':
          return ['SHARES', 'SURRENDERED.'];
        case 'corporateAction':
          return ['NOTED.', 'FILED!'];
        case 'divReinvest':
          return ['DRIP', 'BOOKED!'];
        case 'structured':
          return ['NOTE', 'ISSUED!'];
        case 'foreignTicker':
          return ['CROSS-', 'BORDER!'];
        case 'advisor':
          return ['AS USUAL,', 'GOOD SIR.'];
        case 'lowValue':
          return ['LOGGED.'];
        case 'paired':
          return ['LINKED', 'ENTRY!'];
        case 'cashInLieu':
          return ['BOOKED!'];
      }
    }
    return [isBuy ? 'SOLD!' : 'DEAL!'];
  }

  function lastName(full) {
    const cleaned = (full || '').replace(/^Hon\.?\s+/i, '').trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    const last = parts[parts.length - 1] || 'REP';
    return last.toUpperCase().replace(/[^A-Z.]/g, '').slice(0, 10);
  }

  // Randomized broker greeting + follow-up. Each returns an array of 1-2 lines.
  const GREETINGS = [
    (n) => ['HELLO', `REP. ${n}!`],
    (n) => ['GOOD', `MORNING ${n}!`],
    (n) => ['HOWYA', `DOIN\' ${n}?`],
    (n) => ['WELCOME', 'BACK!'],
    (n) => [`AH, ${n}!`],
    (n) => [`REP.`, `${n}!`],
    (n) => ['HIYA', `${n}!`],
    (n) => ['GOOD DAY', `${n}!`],
    (n) => ['MORNIN\'', `${n}!`],
    (n) => ['HEY THERE', `${n}!`],
    (n) => [`GREETINGS`, `${n}.`],
    (n) => ['LOOK', `WHO\'S IN!`],
  ];
  const FOLLOWUPS = [
    ['HOW CAN', 'I HELP?'],
    ["WHAT'LL", 'IT BE?'],
    ['BUYING?', 'SELLING?'],
    ['YOUR', 'USUAL?'],
    ['WHAT CAN', 'I DO?'],
    ['ORDERS', 'TODAY?'],
    ['READY TO', 'TRADE?'],
    ['HOW CAN', 'I HELP?'],
  ];
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  // Epilogue intro titles (rotates to feel fresh)
  const EPILOGUE_INTROS = [
    '\u2605  BASED ON A TRUE STORY  \u2605',
    '\u2605  FROM THE PUBLIC RECORD  \u2605',
    '\u2605  AS DISCLOSED  \u2605',
    '\u2605  FROM THE FILINGS  \u2605',
    '\u2605  PER THE PTR  \u2605',
  ];
  // Epilogue lead lines — introduce who filed and when before the description
  const EPILOGUE_LEADS = [
    (n, d) => `${n} reported on ${d}...`,
    (n, d) => `As disclosed in ${n}'s ${d} filing:`,
    (n, d) => `${n}'s ${d} PTR stated:`,
    (n, d) => `On ${d}, ${n} noted:`,
    (n, d) => `Filed by ${n} on ${d}:`,
    (n, d) => `Per ${n}'s ${d} disclosure:`,
    (n, d) => `In a ${d} report, ${n} wrote:`,
    (n, d) => `${n} reported this on ${d}:`,
    (n, d) => `The ${d} filing from ${n} read:`,
    (n, d) => `According to ${n}'s ${d} filing:`,
  ];

  function buildScript(group) {
    // Sort purchases first, then sales (stable)
    const sorted = group.slice().sort((a, b) => {
      const ap = a.transaction_type === 'purchase' ? 0 : 1;
      const bp = b.transaction_type === 'purchase' ? 0 : 1;
      return ap - bp;
    });
    const purchases = sorted.filter(t => t.transaction_type === 'purchase');
    const sales = sorted.filter(t => t.transaction_type !== 'purchase');
    const totalBuyMax = purchases.reduce((s, t) => s + (t.amount_max || 0), 0);
    const totalSaleMax = sales.reduce((s, t) => s + (t.amount_max || 0), 0);

    const script = [];

    // 1) If buying, grab cash from the bank first.
    if (purchases.length) {
      script.push({ type: 'walk', to: BANK_DOOR_X + 2 });
      script.push({ type: 'enterBank' });
      script.push({
        type: 'inBank', duration: 1.8,
        bubble: { who: 'bank', lines: ['COUNTING', fmtMax(totalBuyMax)] },
      });
      script.push({
        type: 'exitBank',
        carried: 'bag',
        amountLabel: '\u2666 ' + fmtMax(totalBuyMax),
        txType: 'purchase',
      });
    } else if (sales.length) {
      // Walk in already holding the first stock
      const first = sales[0];
      script.push({
        type: 'setCarried',
        carried: 'stock',
        tickerLabel: '\u2605 ' + tickerOf(first),
        txType: first.transaction_type,
      });
    }

    // 2) Walk to the broker
    script.push({ type: 'walk', to: POL_DESK_STOP });

    // 2b) Broker greets the politician by name
    const nm = lastName(sorted[0].politician);
    script.push({ type: 'speak', duration: 1.6, who: 'broker', lines: pick(GREETINGS)(nm) });
    script.push({ type: 'speak', duration: 1.4, who: 'broker', lines: pick(FOLLOWUPS) });

    // 3) Work through every transaction at the desk
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      const isBuy = t.transaction_type === 'purchase';
      const tkr = tickerOf(t);
      const amount = fmtMax(t.amount_max);

      if (i > 0) {
        script.push({ type: 'speak', duration: 1.2, who: 'broker', lines: ['ANYTHING', 'ELSE?'] });
        script.push({ type: 'speak', duration: 1.0, who: 'politician', lines: ['YES...'] });
      }

      // Pre-transaction carry: bag for buys, stock for sells
      script.push({
        type: 'setCarried',
        carried: isBuy ? 'bag' : 'stock',
        amountLabel: isBuy ? '\u2666 ' + amount : '',
        tickerLabel: !isBuy ? '\u2605 ' + tkr : '',
        txType: t.transaction_type,
      });

      // Politician speech — context-aware from description when available
      const lines = speechLines(t, isBuy);
      const speakDur = Math.max(1.5, 1.0 + lines.length * 0.45);
      script.push({
        type: 'speak', duration: speakDur, who: 'politician',
        lines,
      });

      // Slam
      script.push({ type: 'slam' });

      // Broker confirmation — mirrors the transaction context
      const reply = brokerReplyLines(t, isBuy);
      const replyDur = Math.max(1.1, 0.7 + reply.length * 0.5);
      script.push({
        type: 'speak', duration: replyDur, who: 'broker',
        lines: reply,
      });

      // Hand-off
      script.push({
        type: 'swap',
        carried: isBuy ? 'stock' : 'bag',
        tickerLabel: isBuy ? '\u2605 ' + tkr : '',
        amountLabel: !isBuy ? '\u2666 ' + amount : '',
        txType: t.transaction_type,
      });

      script.push({ type: 'pause', duration: 0.5 });
    }

    // 4) Broker farewell, then bank visit to deposit if we sold anything
    script.push({ type: 'speak', duration: 1.0, who: 'broker', lines: ['GOOD DAY!'] });

    if (sales.length) {
      script.push({ type: 'walk', to: BANK_DOOR_X + 2 });
      script.push({ type: 'enterBank' });
      script.push({
        type: 'inBank', duration: 1.7,
        bubble: { who: 'bank', lines: ['DEPOSIT', fmtMax(totalSaleMax)] },
      });
      script.push({
        type: 'exitBank',
        carried: 'nothing',
        amountLabel: '',
        tickerLabel: '',
        txType: null,
      });
      script.push({ type: 'pause', duration: 0.4 });
    }

    // 5) Exit
    script.push({ type: 'walk', to: W + 30 });

    // 6) Epilogue — movie-credits style cards for any transaction with a
    //    non-null `description` field.
    const withDesc = sorted.filter(t => t.description && String(t.description).trim());
    if (withDesc.length) {
      script.push({ type: 'pause', duration: 0.25 });
      script.push({ type: 'epilogue', phase: 'intro', duration: 2.4, title: pick(EPILOGUE_INTROS) });
      for (const t of withDesc) {
        const desc = String(t.description).trim().slice(0, 520);
        const readTime = Math.max(4.2, 2.8 + desc.length / 42);
        const name = (t.politician || 'the member').trim();
        const filed = t.filing_date || t.notification_date || '?';
        const dirLabel = t.transaction_type === 'purchase' ? 'Purchase'
          : (t.transaction_type || '').startsWith('sale') ? 'Sale'
          : (t.transaction_type || 'Trade').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        script.push({
          type: 'epilogue', phase: 'entry', duration: readTime + 1.5,
          lead: pick(EPILOGUE_LEADS)(name, filed),
          assetName: t.asset_name || tickerOf(t),
          ticker: tickerOf(t),
          dirLabel,
          amount: fmtMax(t.amount_max),
          description: desc,
        });
      }
      script.push({ type: 'epilogue', phase: 'outro', duration: 1.2 });
    }

    return script;
  }

  function advance() {
    S.stepIndex++;
    S.step = S.script[S.stepIndex] || null;
    S.stepT = 0;
    if (!S.step) {
      S.bubble = null;
      if (!S.doneFired && canvas) {
        S.doneFired = true;
        canvas.dispatchEvent(new CustomEvent('scene-done'));
      }
      return;
    }
    if (S.step.carried !== undefined) S.carried = S.step.carried;
    if (S.step.amountLabel !== undefined) S.amountLabel = S.step.amountLabel;
    if (S.step.tickerLabel !== undefined) S.tickerLabel = S.step.tickerLabel;
    if (S.step.txType !== undefined) S.txType = S.step.txType;

    switch (S.step.type) {
      case 'speak':
        S.bubble = { who: S.step.who, lines: S.step.lines };
        break;
      case 'inBank':
        S.polAlpha = 0;
        S.bubble = S.step.bubble || null;
        break;
      case 'slam':
        S.bubble = null;
        S.gavelPhase = 'raised';
        S.gavelT = 0;
        break;
      default:
        if (!['inBank', 'speak'].includes(S.step.type)) S.bubble = null;
    }
  }

  function requestFrame() {
    if (!running || !ctx) return;
    if (S.paused) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (rafId) return;
    rafId = requestAnimationFrame(loop);
  }

  function needsFrame() {
    if (S.paused) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    if (S.step) return true;
    if (S.flashT > 0) return true;
    return false;
  }

  function loop(now) {
    rafId = 0;
    const dt = lastT ? Math.min(0.08, (now - lastT) / 1000) : 0;
    lastT = now;
    update(dt);
    render();
    if (needsFrame()) requestFrame();
  }

  function update(dt) {
    if (S.paused) return;  // freeze all scene animation while paused
    S.walkPhaseT += dt;
    if (S.walkPhaseT >= 0.16) {
      S.walkPhaseT = 0;
      S.walkPhase = (S.walkPhase + 1) % 2;
    }
    if (S.flashT > 0) S.flashT = Math.max(0, S.flashT - dt);
    if (!S.step) return;
    S.stepT += dt;
    S.gavelT += dt;

    const step = S.step;
    switch (step.type) {
      case 'walk': {
        const speed = 60;
        const dir = Math.sign(step.to - S.polX);
        if (dir === 0) { advance(); break; }
        S.polX += dir * speed * dt;
        if ((dir > 0 && S.polX >= step.to) || (dir < 0 && S.polX <= step.to)) {
          S.polX = step.to;
          advance();
        }
        break;
      }
      case 'enterBank': {
        const d = 0.45;
        S.polAlpha = Math.max(0, 1 - S.stepT / d);
        S.polX = Math.min(BANK_DOOR_X + 4, S.polX + 8 * dt);
        if (S.stepT >= d) { S.polAlpha = 0; advance(); }
        break;
      }
      case 'inBank': {
        S.polAlpha = 0;
        if (S.stepT >= step.duration) advance();
        break;
      }
      case 'exitBank': {
        const d = 0.45;
        S.polAlpha = Math.min(1, S.stepT / d);
        if (S.stepT < 0.05) S.polX = BANK_DOOR_X + 2;
        S.polX += 14 * dt;
        if (S.stepT >= d) { S.polAlpha = 1; advance(); }
        break;
      }
      case 'speak': {
        if (S.stepT >= step.duration) advance();
        break;
      }
      case 'slam': {
        if (S.stepT < 0.35) {
          S.gavelPhase = 'raised';
        } else if (S.stepT < 0.55) {
          if (S.gavelPhase !== 'slam') S.flashT = 0.3;
          S.gavelPhase = 'slam';
        } else {
          S.gavelPhase = 'rest';
        }
        if (S.stepT >= 0.85) { S.gavelPhase = 'rest'; advance(); }
        break;
      }
      case 'swap':
        if (S.stepT < 0.05) S.flashT = 0.2;
        advance();
        break;
      case 'setCarried':
        advance();
        break;
      case 'pause':
        if (S.stepT >= (step.duration || 0.5)) advance();
        break;
      case 'epilogue':
        if (S.stepT >= (step.duration || 3.0)) advance();
        break;
      default: advance();
    }
  }

  // -------- Shared grass/path tufts --------
  const TUFTS = (() => {
    const arr = [];
    let seed = 1337;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0, (seed >>> 16) / 65535);
    for (let i = 0; i < 44; i++) {
      arr.push({
        x: (rnd() * (W + 20)) | 0,
        y: (190 + rnd() * 28) | 0,
        s: rnd() < 0.3 ? 'rock' : (rnd() < 0.5 ? 'tuft2' : 'tuft1'),
      });
    }
    for (let i = 0; i < 16; i++) {
      arr.push({
        x: (rnd() * W) | 0,
        y: (140 + rnd() * 16) | 0,
        s: 'tuft1',
      });
    }
    return arr;
  })();

  function drawGrassAndPath() {
    rect(PAL.grassDk, 0, 100, W, 22);
    rect(PAL.grass, 0, 122, W, H - 122);
    ctx.fillStyle = PAL.grassLt;
    for (let y = 128; y < H; y += 4) {
      for (let x = (y % 8); x < W; x += 8) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
    rect(PAL.dirtDk, 0, PATH_Y - 2, W, 1);
    rect(PAL.dirt, 0, PATH_Y - 1, W, 14);
    rect(PAL.dirtLt, 0, PATH_Y - 1, W, 1);
    ctx.fillStyle = PAL.dirtDk;
    for (let x = 0; x < W; x += 6) {
      ctx.fillRect(x + ((x * 7) % 3), PATH_Y + 3 + ((x * 11) % 6), 1, 1);
    }
    rect(PAL.dirtDk, 0, PATH_Y + 12, W, 1);
    for (const t of TUFTS) {
      if (t.s === 'tuft1') {
        ctx.fillStyle = PAL.grassLt;
        ctx.fillRect(t.x, t.y, 2, 1);
        ctx.fillRect(t.x - 1, t.y + 1, 4, 1);
        ctx.fillStyle = PAL.grassDk;
        ctx.fillRect(t.x + 1, t.y + 2, 1, 1);
      } else if (t.s === 'tuft2') {
        ctx.fillStyle = PAL.grassLt;
        ctx.fillRect(t.x, t.y, 3, 1);
        ctx.fillRect(t.x + 1, t.y + 1, 1, 1);
      } else {
        ctx.fillStyle = PAL.stoneDk;
        ctx.fillRect(t.x, t.y + 1, 3, 2);
        ctx.fillStyle = PAL.stone;
        ctx.fillRect(t.x + 1, t.y, 2, 1);
      }
    }
  }

  // ==========================================================================
  //                        M O T I F   L I B R A R Y
  // ==========================================================================

  // ---- Shared motif helpers ----
  function drawStars(n = 30, yMax = 50, color = PAL.white) {
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const x = (i * 73 + 13) % W;
      const y = (i * 31 + 5) % yMax;
      ctx.fillRect(x, y, 1, 1);
      if (i % 5 === 0) ctx.fillRect(x - 1, y, 1, 1);
    }
  }

  function drawMountainRange(color = '#1a3a36', capColor = '#e8ecf0') {
    for (let i = 0; i < 7; i++) {
      const cx = i * 90 + 30;
      const peakH = 24 + (i % 3) * 6;
      ctx.fillStyle = color;
      for (let y = 0; y < peakH; y++) {
        const w = (peakH - y) * 2;
        ctx.fillRect(cx - w, 100 - y, w * 2, 1);
      }
    }
    ctx.fillStyle = capColor;
    for (let i = 0; i < 7; i++) {
      const cx = i * 90 + 30;
      const peakH = 24 + (i % 3) * 6;
      for (let y = 0; y < 4; y++) {
        const w = Math.min((peakH - y) * 2, 6);
        ctx.fillRect(cx - w, 100 - peakH + y + 3, w * 2, 1);
      }
    }
  }

  function drawPineTree(x, topY, h = 30, trunk = PAL.wood) {
    rect(trunk, x + 3, topY + h - 5, 2, 6);
    ctx.fillStyle = '#1a4a2a';
    for (let i = 0; i < 4; i++) {
      const layerY = topY + i * (h / 4);
      const layerW = Math.round((i + 1) * 2.5);
      ctx.fillRect(x + 4 - layerW, layerY, layerW * 2, Math.ceil(h / 4));
    }
    ctx.fillStyle = '#2a6f3c';
    ctx.fillRect(x + 3, topY + 2, 1, h - 8);
  }

  function drawPineForest(yBase = 70, count = 14) {
    for (let i = 0; i < count; i++) {
      const x = i * 40 + ((i * 17) % 20);
      const y = yBase - ((i * 7) % 10);
      drawPineTree(x, y, 24 + ((i * 3) % 10));
    }
  }

  function drawBigSun(cx, cy, body = '#ffd84a', rays = '#ffeea8') {
    ctx.fillStyle = rays;
    for (let a = 0; a < 12; a++) {
      const rad = a * Math.PI / 6;
      const x = cx + Math.cos(rad) * 18;
      const y = cy + Math.sin(rad) * 18;
      ctx.fillRect(x - 1, y - 1, 3, 3);
    }
    ctx.fillStyle = body;
    ctx.fillRect(cx - 12, cy - 12, 24, 24);
    ctx.fillStyle = '#fff094';
    ctx.fillRect(cx - 10, cy - 12, 20, 2);
    ctx.fillStyle = '#f5a83e';
    ctx.fillRect(cx - 12, cy + 8, 24, 3);
    // simple happy face
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(cx - 5, cy - 3, 2, 2);
    ctx.fillRect(cx + 3, cy - 3, 2, 2);
    ctx.fillRect(cx - 4, cy + 4, 8, 1);
    ctx.fillRect(cx - 4, cy + 3, 1, 1);
    ctx.fillRect(cx + 3, cy + 3, 1, 1);
  }

  function drawPalm(x, topY, small = false) {
    const s = small ? 0.8 : 1;
    rect('#6d4221', x + 3, topY + 10, 3, 36 * s);
    ctx.fillStyle = '#4a2a10';
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(x + 3, topY + 14 + i * 4, 3, 1);
    }
    ctx.fillStyle = '#2e8849';
    ctx.fillRect(x - 8, topY + 8, 24, 2);
    ctx.fillRect(x - 5, topY + 6, 18, 2);
    ctx.fillRect(x - 2, topY + 4, 12, 2);
    ctx.fillRect(x + 1, topY + 2, 8, 2);
    ctx.fillStyle = '#1a5c2e';
    ctx.fillRect(x - 6, topY + 10, 6, 2);
    ctx.fillRect(x + 7, topY + 10, 7, 2);
    ctx.fillStyle = '#4a2a10';
    ctx.fillRect(x + 6, topY + 11, 2, 2);
    ctx.fillRect(x, topY + 11, 2, 2);
  }

  function drawCrab(x, y) {
    ctx.fillStyle = '#c83a3a';
    ctx.fillRect(x + 3, y + 2, 8, 3);
    ctx.fillRect(x + 2, y + 3, 10, 2);
    ctx.fillStyle = '#8a2832';
    ctx.fillRect(x + 3, y + 4, 8, 1);
    ctx.fillStyle = '#e35259';
    ctx.fillRect(x + 4, y + 2, 6, 1);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x + 5, y, 1, 2);
    ctx.fillRect(x + 8, y, 1, 2);
    ctx.fillRect(x + 5, y, 2, 1);
    ctx.fillRect(x + 8, y, 2, 1);
    ctx.fillStyle = '#c83a3a';
    ctx.fillRect(x + 1, y + 5, 2, 1);
    ctx.fillRect(x + 11, y + 5, 2, 1);
    ctx.fillRect(x, y + 6, 2, 1);
    ctx.fillRect(x + 12, y + 6, 2, 1);
    ctx.fillRect(x, y + 1, 3, 2);
    ctx.fillRect(x + 11, y + 1, 3, 2);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x, y + 2, 1, 1);
    ctx.fillRect(x + 13, y + 2, 1, 1);
  }

  function drawSailboat(x, y) {
    rect('#6d4221', x, y + 6, 10, 2);
    rect('#4a2a10', x + 1, y + 8, 8, 1);
    ctx.fillStyle = PAL.white;
    for (let i = 0; i < 6; i++) ctx.fillRect(x + 4, y + i, i + 2, 1);
    rect(PAL.ink, x + 4, y, 1, 7);
  }

  function drawPeach(x, y) {
    ctx.fillStyle = '#2e8849';
    ctx.fillRect(x + 3, y, 3, 2);
    ctx.fillStyle = '#1a5c2e';
    ctx.fillRect(x + 3, y + 1, 3, 1);
    ctx.fillStyle = '#f4a86b';
    ctx.fillRect(x, y + 2, 8, 6);
    ctx.fillStyle = '#e88550';
    ctx.fillRect(x, y + 3, 1, 4);
    ctx.fillRect(x + 7, y + 3, 1, 4);
    ctx.fillRect(x, y + 7, 8, 1);
    ctx.fillStyle = '#d46838';
    ctx.fillRect(x + 3, y + 2, 1, 6);
  }

  function drawPeachTree(x, topY) {
    rect('#4a2a10', x + 5, topY + 12, 3, 18);
    rect('#6a4030', x + 5, topY + 12, 1, 18);
    ctx.fillStyle = '#1a5c2e';
    ctx.fillRect(x - 4, topY + 4, 20, 10);
    ctx.fillRect(x - 2, topY + 2, 16, 4);
    ctx.fillRect(x + 2, topY, 8, 4);
    ctx.fillStyle = '#2a6f3c';
    ctx.fillRect(x - 2, topY + 4, 3, 3);
    ctx.fillRect(x + 10, topY + 4, 3, 3);
    ctx.fillStyle = '#f4a86b';
    ctx.fillRect(x, topY + 5, 2, 2);
    ctx.fillRect(x + 6, topY + 3, 2, 2);
    ctx.fillRect(x + 10, topY + 7, 2, 2);
    ctx.fillRect(x + 2, topY + 9, 2, 2);
  }

  function drawCactus(x, y) {
    ctx.fillStyle = '#2e8849';
    ctx.fillRect(x + 3, y, 3, 20);
    ctx.fillRect(x, y + 8, 3, 2);
    ctx.fillRect(x, y + 4, 2, 6);
    ctx.fillRect(x + 6, y + 6, 3, 2);
    ctx.fillRect(x + 7, y + 2, 2, 6);
    ctx.fillStyle = '#1a5c2e';
    ctx.fillRect(x + 3, y, 1, 20);
    ctx.fillRect(x, y + 4, 1, 6);
    ctx.fillRect(x + 7, y + 2, 1, 6);
    ctx.fillStyle = '#f5efd6';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(x + 3, y + 3 + i * 5, 1, 1);
      ctx.fillRect(x + 5, y + 3 + i * 5, 1, 1);
    }
    ctx.fillStyle = '#f5a83e';
    ctx.fillRect(x + 3, y, 3, 2);
  }

  function drawMesa(x, y, w = 60, h = 24) {
    ctx.fillStyle = '#a55030';
    ctx.fillRect(x, y + 4, w, h);
    ctx.fillStyle = '#c86844';
    ctx.fillRect(x, y + 4, w, 2);
    ctx.fillStyle = '#7a3820';
    ctx.fillRect(x, y + h + 2, w, 2);
    ctx.fillStyle = '#8a4424';
    ctx.fillRect(x, y + 10, w, 1);
    ctx.fillRect(x, y + 18, w, 1);
  }

  function drawBarn(x, y) {
    ctx.fillStyle = '#8a2832';
    for (let i = 0; i < 10; i++) {
      ctx.fillRect(x + 10 - i, y + 15 - i, 40 + i * 2, 1);
    }
    ctx.fillStyle = '#c83a3a';
    ctx.fillRect(x, y + 15, 60, 30);
    ctx.fillStyle = '#6a2028';
    ctx.fillRect(x, y + 44, 60, 1);
    ctx.fillStyle = '#f5efd6';
    ctx.fillRect(x + 2, y + 16, 1, 28);
    ctx.fillRect(x + 30, y + 16, 1, 28);
    ctx.fillRect(x + 58, y + 16, 1, 28);
    ctx.fillStyle = '#3a1010';
    ctx.fillRect(x + 22, y + 25, 16, 20);
    ctx.fillStyle = '#f5efd6';
    ctx.fillRect(x + 6, y + 22, 6, 6);
    ctx.fillRect(x + 48, y + 22, 6, 6);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x + 9, y + 22, 1, 6);
    ctx.fillRect(x + 6, y + 25, 6, 1);
  }

  function drawCornStalk(x, y) {
    ctx.fillStyle = '#1a5c2e';
    ctx.fillRect(x + 2, y, 1, 20);
    ctx.fillStyle = '#2e8849';
    ctx.fillRect(x, y + 3, 5, 1);
    ctx.fillRect(x, y + 8, 5, 1);
    ctx.fillRect(x, y + 13, 5, 1);
    ctx.fillRect(x, y + 4, 1, 1);
    ctx.fillRect(x + 4, y + 4, 1, 1);
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect(x + 2, y + 6, 1, 3);
    ctx.fillRect(x + 2, y + 11, 1, 3);
  }

  function drawOilDerrick(x, topY) {
    ctx.fillStyle = '#1a1a1a';
    const h = 50;
    for (let i = 0; i <= h; i++) {
      const frac = i / h;
      const halfW = Math.round(10 - frac * 7);
      ctx.fillRect(x - halfW, topY + i, 1, 1);
      ctx.fillRect(x + halfW, topY + i, 1, 1);
    }
    for (let i = 0; i < 5; i++) {
      const frac = i / 5;
      const halfW = Math.round(10 - frac * 7);
      ctx.fillRect(x - halfW, topY + i * 10, halfW * 2, 1);
      if (i > 0) {
        for (let j = -halfW; j <= halfW; j += 4) {
          ctx.fillRect(x + j, topY + i * 10 - 5, 1, 5);
        }
      }
    }
    // pump jack head
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(x - 6, topY - 4, 12, 3);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x - 6, topY - 4, 2, 3);
  }

  function drawCapitolDome(cx, baseY) {
    ctx.fillStyle = '#cfbb90';
    ctx.fillRect(cx - 30, baseY, 60, 20);
    ctx.fillStyle = '#7a6e47';
    ctx.fillRect(cx - 30, baseY, 60, 1);
    ctx.fillRect(cx - 30, baseY + 19, 60, 1);
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(cx - 24 + i * 12, baseY + 4, 1, 14);
    }
    ctx.fillStyle = '#cfbb90';
    ctx.fillRect(cx - 20, baseY - 14, 40, 14);
    ctx.fillStyle = '#7a6e47';
    ctx.fillRect(cx - 20, baseY - 14, 40, 1);
    ctx.fillRect(cx - 20, baseY - 1, 40, 1);
    for (let y = 0; y < 20; y++) {
      const w = Math.round(Math.sqrt(Math.max(0, 20 * 20 - y * y))) * 2;
      ctx.fillStyle = '#cfbb90';
      ctx.fillRect(cx - w / 2, baseY - 14 - y, w, 1);
    }
    ctx.fillStyle = '#e5d4a4';
    for (let y = 0; y < 20; y++) {
      const w = Math.round(Math.sqrt(Math.max(0, 20 * 20 - y * y))) * 2;
      ctx.fillRect(cx - w / 2 + 1, baseY - 14 - y, 2, 1);
    }
    ctx.fillStyle = '#7a6e47';
    ctx.fillRect(cx - 3, baseY - 38, 6, 4);
    ctx.fillStyle = '#e8c547';
    ctx.fillRect(cx - 1, baseY - 44, 2, 6);
  }

  function drawFlag(x, topY) {
    ctx.fillStyle = '#6d4221';
    ctx.fillRect(x, topY, 1, 32);
    ctx.fillStyle = '#c83a3a';
    ctx.fillRect(x + 1, topY + 2, 18, 3);
    ctx.fillStyle = '#f5efd6';
    ctx.fillRect(x + 1, topY + 5, 18, 2);
    ctx.fillRect(x + 1, topY + 9, 18, 2);
    ctx.fillStyle = '#c83a3a';
    ctx.fillRect(x + 1, topY + 7, 18, 2);
    ctx.fillRect(x + 1, topY + 11, 18, 1);
    ctx.fillStyle = '#1a3a7c';
    ctx.fillRect(x + 1, topY + 2, 8, 6);
    ctx.fillStyle = '#f5efd6';
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillRect(x + 2 + i * 2, topY + 3 + j * 2, 1, 1);
      }
    }
  }

  function drawCitySkyline() {
    const bs = [
      [16, 44, 32], [52, 52, 36], [94, 30, 40], [130, 65, 28], [164, 42, 50],
      [222, 54, 32], [266, 72, 30], [308, 46, 40], [352, 62, 30], [392, 36, 46],
      [444, 54, 40], [490, 56, 34],
    ];
    for (const [x, h, w] of bs) {
      ctx.fillStyle = '#0a0e20';
      ctx.fillRect(x, 100 - h, w, h);
      ctx.fillStyle = '#1a1e30';
      ctx.fillRect(x, 100 - h, w, 2);
      ctx.fillStyle = '#ffd84a';
      for (let wy = 100 - h + 5; wy < 100; wy += 4) {
        for (let wx = x + 2; wx < x + w - 2; wx += 4) {
          if (((wx * wy * 37) & 0x1ff) > 140) ctx.fillRect(wx, wy, 2, 1);
        }
      }
      if (h > 55) {
        ctx.fillStyle = '#c83a3a';
        ctx.fillRect(x + w / 2 - 1, 100 - h - 4, 2, 4);
      }
    }
  }

  function drawVolcano(cx, topY) {
    ctx.fillStyle = '#2a1a1a';
    for (let y = 0; y < 60; y++) {
      const w = y + 16;
      ctx.fillRect(cx - w, topY + y, w * 2, 1);
    }
    ctx.fillStyle = '#4a2a1a';
    for (let y = 0; y < 60; y++) {
      const w = y + 16;
      ctx.fillRect(cx - w, topY + y, 3, 1);
    }
    ctx.fillStyle = '#6a2820';
    ctx.fillRect(cx - 10, topY, 20, 4);
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect(cx - 3, topY - 6, 6, 8);
    ctx.fillStyle = '#e88550';
    ctx.fillRect(cx - 4, topY - 4, 8, 4);
    ctx.fillStyle = '#c83a3a';
    ctx.fillRect(cx - 2, topY, 4, 40);
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect(cx - 1, topY + 6, 2, 24);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(cx - 4, topY - 14, 8, 4);
    ctx.fillRect(cx - 6, topY - 18, 12, 4);
    ctx.fillRect(cx - 3, topY - 22, 8, 4);
  }

  function drawTornadoFunnel(cx, topY) {
    for (let y = 0; y < 80; y++) {
      const w = 2 + (y / 10) * 2;
      const offset = Math.sin(y / 4) * 4;
      ctx.fillStyle = '#3a3a3e';
      ctx.fillRect(cx - w + offset, topY + y, w * 2, 1);
      ctx.fillStyle = '#5a5a5e';
      ctx.fillRect(cx - w + offset, topY + y, 1, 1);
    }
    ctx.fillStyle = '#6a6a6e';
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(cx - 14 + i * 5, topY + 90 + (i % 3), 3, 1);
    }
  }

  function drawGatewayArch(cx, baseY) {
    ctx.fillStyle = '#b0b4b8';
    const width = 80;
    const height = 80;
    for (let y = 0; y < height; y++) {
      const t = y / height;
      const curve = Math.sin((1 - t) * Math.PI / 2);
      const halfSpan = Math.round(curve * width / 2);
      ctx.fillRect(cx - halfSpan - 2, baseY - y, 3, 1);
      ctx.fillRect(cx + halfSpan - 1, baseY - y, 3, 1);
    }
    ctx.fillStyle = '#f0f2f4';
    for (let y = 0; y < height; y++) {
      const t = y / height;
      const curve = Math.sin((1 - t) * Math.PI / 2);
      const halfSpan = Math.round(curve * width / 2);
      ctx.fillRect(cx - halfSpan - 1, baseY - y, 1, 1);
      ctx.fillRect(cx + halfSpan, baseY - y, 1, 1);
    }
  }

  function drawRushmore(cx, baseY) {
    ctx.fillStyle = '#5a5040';
    for (let y = 0; y < 50; y++) {
      const w = 100 + y;
      ctx.fillRect(cx - w / 2, baseY + y, w, 1);
    }
    ctx.fillStyle = '#7a6e5a';
    for (let y = 0; y < 10; y++) {
      const w = 100 + y;
      ctx.fillRect(cx - w / 2, baseY + y, w, 1);
    }
    const faces = [cx - 36, cx - 12, cx + 12, cx + 30];
    for (const fx of faces) {
      ctx.fillStyle = '#4a3a2a';
      ctx.fillRect(fx - 8, baseY + 4, 14, 16);
      ctx.fillStyle = '#8a7a68';
      ctx.fillRect(fx - 5, baseY + 6, 8, 10);
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(fx - 3, baseY + 10, 1, 1);
      ctx.fillRect(fx + 1, baseY + 10, 1, 1);
      ctx.fillRect(fx - 2, baseY + 14, 4, 1);
    }
  }

  function drawSpaceNeedle(cx, baseY) {
    ctx.fillStyle = '#9a9e9e';
    const baseH = 70;
    for (let y = 0; y < baseH; y++) {
      const t = y / baseH;
      const w = Math.round(10 - t * 6);
      ctx.fillRect(cx - w / 2, baseY + y, w, 1);
    }
    ctx.fillStyle = PAL.ink;
    for (let y = 0; y < baseH; y += 8) {
      ctx.fillRect(cx - 5, baseY + y, 10, 1);
    }
    // Disc
    ctx.fillStyle = '#c83a3a';
    ctx.fillRect(cx - 16, baseY - 6, 32, 6);
    ctx.fillStyle = '#e35259';
    ctx.fillRect(cx - 14, baseY - 6, 28, 2);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(cx - 16, baseY, 32, 1);
    // Antenna
    ctx.fillStyle = '#9a9e9e';
    ctx.fillRect(cx - 1, baseY - 26, 2, 20);
    ctx.fillStyle = '#e8c547';
    ctx.fillRect(cx, baseY - 30, 1, 4);
  }

  function drawHorse(x, baseY) {
    ctx.fillStyle = '#6a3a1a';
    ctx.fillRect(x + 4, baseY, 22, 10);
    ctx.fillRect(x + 22, baseY - 6, 8, 8);
    ctx.fillRect(x + 26, baseY - 10, 4, 6);
    ctx.fillStyle = '#4a2a10';
    ctx.fillRect(x + 26, baseY - 12, 2, 4);
    ctx.fillRect(x + 28, baseY - 12, 2, 4);
    ctx.fillRect(x + 2, baseY + 2, 4, 2);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x + 28, baseY - 8, 1, 1);
    // legs
    ctx.fillStyle = '#4a2a10';
    ctx.fillRect(x + 6, baseY + 10, 2, 8);
    ctx.fillRect(x + 12, baseY + 10, 2, 8);
    ctx.fillRect(x + 20, baseY + 10, 2, 8);
    ctx.fillRect(x + 24, baseY + 10, 2, 8);
  }

  function drawLighthouse(x, topY) {
    ctx.fillStyle = '#f5efd6';
    ctx.fillRect(x, topY + 10, 12, 40);
    ctx.fillStyle = '#c83a3a';
    ctx.fillRect(x, topY + 10, 12, 6);
    ctx.fillRect(x, topY + 22, 12, 6);
    ctx.fillRect(x, topY + 34, 12, 6);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x + 4, topY + 42, 4, 8);
    // top
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(x - 2, topY + 4, 16, 6);
    ctx.fillStyle = '#e8c547';
    ctx.fillRect(x + 2, topY, 8, 6);
    ctx.fillStyle = '#ffeea8';
    ctx.fillRect(x + 2, topY, 8, 2);
    // light rays
    ctx.fillStyle = 'rgba(255,220,120,0.3)';
    ctx.fillRect(x - 30, topY + 1, 30, 4);
    ctx.fillRect(x + 12, topY + 1, 30, 4);
    // base rock
    ctx.fillStyle = '#5a5040';
    ctx.fillRect(x - 4, topY + 50, 20, 6);
  }

  function drawCheeseWedge(x, y) {
    ctx.fillStyle = '#ffd84a';
    for (let i = 0; i < 12; i++) {
      ctx.fillRect(x, y + i, 20 - i, 1);
    }
    ctx.fillStyle = '#f5a83e';
    ctx.fillRect(x, y + 12, 8, 1);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(x + 3, y + 3, 2, 2);
    ctx.fillRect(x + 8, y + 6, 2, 2);
  }

  // ---- Motif draw functions ----
  // Each draws sky (y 0-100) and may draw ground decorators later via .ground()

  const MOTIFS = {
    mountains: {
      sky() {
        skyGradient('#0d2320', '#2a3a4a');
        drawStars(20, 45);
        drawMountainRange('#1a3a36', '#e8ecf0');
      },
    },
    pines: {
      sky() {
        skyGradient('#0d1e15', '#2a3a2a');
        drawStars(18, 45, '#c0e0c0');
        drawPineForest(65, 15);
      },
    },
    desert: {
      sky() {
        skyGradient('#532a10', '#e8a060');
        drawBigSun(80, 30, '#ffb94a', '#ff9848');
        drawMesa(180, 60, 80, 28);
        drawMesa(320, 70, 60, 20);
        drawMesa(420, 68, 70, 22);
      },
      ground() {
        drawCactus(180, 148);
        drawCactus(460, 146);
        drawCactus(20, 150);
      },
    },
    redrock: {
      sky() {
        skyGradient('#3a2a1a', '#ffa858');
        drawMesa(40, 55, 110, 40);
        drawMesa(200, 50, 130, 45);
        drawMesa(380, 60, 120, 35);
        drawBigSun(470, 22, '#ffdc6a');
      },
    },
    sunshine: {
      sky() {
        skyGradient('#ff6a28', '#ffd84a');
        drawBigSun(260, 30);
        drawPalm(30, 40);
        drawPalm(490, 44);
        drawPalm(100, 55, true);
        drawPalm(440, 55, true);
      },
      ground() {
        // tiny shells
        for (const [x, y] of [[30, 210], [220, 214], [480, 212]]) {
          ctx.fillStyle = '#ffb898';
          ctx.fillRect(x, y, 4, 3);
          ctx.fillStyle = '#e88870';
          ctx.fillRect(x + 1, y + 1, 2, 1);
        }
      },
    },
    tropical: {
      sky() {
        skyGradient('#0a9aca', '#3acae8');
        drawBigSun(90, 28, '#ffe454', '#ffc44a');
        drawPalm(20, 48);
        drawPalm(460, 52);
        drawPalm(500, 56, true);
        // ocean line
        rect('#2a78b4', 0, 100, W, 1);
      },
    },
    peach: {
      sky() {
        skyGradient('#3a1a2a', '#f4a0a0');
        // rolling hills
        ctx.fillStyle = '#2a5a32';
        for (let i = 0; i < 5; i++) {
          const cx = i * 120 + 40;
          const h = 22 + i * 3;
          for (let y = 0; y < h; y++) {
            ctx.fillRect(cx - (h - y) * 2, 100 - y, (h - y) * 4, 1);
          }
        }
        drawPeachTree(60, 50);
        drawPeachTree(220, 48);
        drawPeachTree(380, 52);
        drawPeachTree(460, 50);
      },
      ground() {
        drawPeach(60, 198);
        drawPeach(240, 204);
        drawPeach(480, 200);
        drawPeach(170, 210);
        drawPeach(350, 212);
      },
    },
    crabs: {
      sky() {
        rect('#1a3a5a', 0, 0, W, 60);
        rect('#234a72', 0, 60, W, 40);
        ctx.fillStyle = '#4a7090';
        for (let x = 0; x < W; x += 8) {
          ctx.fillRect(x + ((x * 3) % 5), 68 + ((x * 7) % 8), 4, 1);
          ctx.fillRect(x + ((x * 5) % 6), 82 + ((x * 3) % 6), 3, 1);
          ctx.fillRect(x + ((x * 7) % 3), 94 + ((x * 11) % 4), 3, 1);
        }
        drawSailboat(80, 72);
        drawSailboat(400, 76);
      },
      ground() {
        drawCrab(60, 210);
        drawCrab(200, 204);
        drawCrab(300, 214);
        drawCrab(490, 208);
      },
    },
    volcano: {
      sky() {
        skyGradient('#3a1a1a', '#e04830');
        drawVolcano(230, 40);
        drawPalm(60, 60);
        drawPalm(480, 60, true);
      },
    },
    skyline: {
      sky() {
        skyGradient('#0d1632', '#4a3a5a');
        drawStars(26, 35);
        // moon
        ctx.fillStyle = '#e5e8f0';
        ctx.fillRect(450, 14, 14, 14);
        ctx.fillStyle = '#c0c4d0';
        ctx.fillRect(450, 14, 4, 4);
        ctx.fillRect(458, 20, 3, 3);
        drawCitySkyline();
      },
    },
    capitol: {
      sky() {
        skyGradient('#1a2a4a', '#e8a858');
        drawStars(16, 50);
        drawCapitolDome(270, 58);
        drawFlag(80, 50);
        drawFlag(440, 52);
      },
    },
    corn: {
      sky() {
        skyGradient('#2a1a3a', '#ffae6a');
        drawBigSun(440, 34, '#ffd84a', '#ffb050');
        drawBarn(230, 50);
      },
      ground() {
        for (let i = 0; i < 18; i++) {
          const x = (i * 30) + ((i * 5) % 8);
          const y = 198 + ((i * 7) % 14);
          drawCornStalk(x, y);
        }
      },
    },
    tornado: {
      sky() {
        rect('#2a2a2e', 0, 0, W, 60);
        rect('#4a4a4e', 0, 60, W, 40);
        ctx.fillStyle = '#ffd84a';
        ctx.fillRect(140, 18, 2, 8);
        ctx.fillRect(138, 26, 4, 2);
        ctx.fillRect(136, 28, 2, 8);
        ctx.fillRect(138, 36, 2, 2);
        // barn being swept
        ctx.fillStyle = '#8a2832';
        ctx.fillRect(480, 88, 12, 6);
        ctx.fillStyle = '#c83a3a';
        ctx.fillRect(480, 94, 12, 4);
        drawTornadoFunnel(300, 18);
      },
    },
    oil: {
      sky() {
        skyGradient('#6a3a28', '#ffa858');
        drawBigSun(80, 32, '#ffa030', '#ff7820');
        drawOilDerrick(220, 34);
        drawOilDerrick(350, 30);
        drawOilDerrick(460, 38);
        // longhorn skull on fence
        ctx.fillStyle = '#f5efd6';
        ctx.fillRect(120, 78, 12, 8);
        ctx.fillRect(112, 80, 4, 2);
        ctx.fillRect(132, 80, 4, 2);
        ctx.fillStyle = PAL.ink;
        ctx.fillRect(122, 81, 1, 1);
        ctx.fillRect(128, 81, 1, 1);
      },
    },
    arch: {
      sky() {
        skyGradient('#1a2a4a', '#3aaae8');
        drawStars(12, 40);
        // distant city
        ctx.fillStyle = '#1a1e30';
        for (const [x, h, w] of [[30, 22, 14], [48, 28, 16], [68, 18, 12], [86, 26, 14], [430, 22, 14], [450, 30, 18], [474, 20, 14], [496, 26, 16]]) {
          ctx.fillRect(x, 100 - h, w, h);
        }
        drawGatewayArch(260, 100);
      },
    },
    rushmore: {
      sky() {
        skyGradient('#1a2a4a', '#6a88a8');
        drawStars(12, 35);
        drawRushmore(270, 30);
      },
    },
    spaceneedle: {
      sky() {
        skyGradient('#0d1e2a', '#2a3a56');
        drawStars(20, 40);
        drawMountainRange('#1a2a2a', '#d0d4e0');
        drawSpaceNeedle(430, 90);
      },
    },
    aurora: {
      sky() {
        rect('#0d0d22', 0, 0, W, 100);
        // aurora bands (additive-ish)
        for (let i = 0; i < 5; i++) {
          const y = 8 + i * 12;
          const color = ['#44d47e', '#7a5bff', '#2a9acf'][i % 3];
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = color;
          for (let x = 0; x < W; x += 2) {
            const h = Math.max(1, Math.round(5 + Math.sin(x / 22 + i * 1.7) * 5));
            ctx.fillRect(x, y, 2, h);
          }
        }
        ctx.globalAlpha = 1;
        drawStars(40, 60);
        drawPineForest(72, 16);
      },
    },
    lakes: {
      sky() {
        skyGradient('#0d2a3a', '#5a8aa0');
        ctx.fillStyle = '#1a4a5a';
        ctx.fillRect(0, 76, W, 24);
        ctx.fillStyle = '#3a7088';
        for (let x = 0; x < W; x += 10) {
          ctx.fillRect(x + ((x * 3) % 5), 80 + ((x * 11) % 18), 4, 1);
        }
        // far shore pines
        for (let i = 0; i < 18; i++) {
          drawPineTree(i * 30 + ((i * 7) % 8), 50 - ((i % 3) * 2), 20);
        }
      },
    },
    horse: {
      sky() {
        skyGradient('#1a3a2e', '#9adc9e');
        drawBigSun(90, 30, '#ffe9a4', '#ffcf68');
        // rolling bluegrass hills
        ctx.fillStyle = '#3a7a48';
        for (let i = 0; i < 6; i++) {
          const cx = i * 100 + 30;
          const h = 24 + (i % 2) * 6;
          for (let y = 0; y < h; y++) {
            ctx.fillRect(cx - (h - y) * 2, 100 - y, (h - y) * 4, 1);
          }
        }
        // white fence
        for (let x = 0; x < W; x += 14) {
          ctx.fillStyle = '#f5efd6';
          ctx.fillRect(x + 1, 76, 2, 14);
          ctx.fillStyle = '#c0b68c';
          ctx.fillRect(x + 1, 90, 2, 1);
        }
        ctx.fillStyle = '#f5efd6';
        ctx.fillRect(0, 80, W, 2);
        ctx.fillRect(0, 86, W, 2);
        drawHorse(280, 70);
      },
    },
    lighthouse: {
      sky() {
        skyGradient('#0d1e3a', '#5a88c8');
        drawStars(16, 40);
        // ocean
        rect('#1a3a5a', 0, 70, W, 30);
        ctx.fillStyle = '#4a7090';
        for (let x = 0; x < W; x += 8) {
          ctx.fillRect(x + ((x * 3) % 5), 78 + ((x * 7) % 8), 3, 1);
          ctx.fillRect(x + ((x * 5) % 6), 90 + ((x * 3) % 4), 2, 1);
        }
        drawLighthouse(60, 34);
      },
    },
    cheese: {
      sky() {
        skyGradient('#0d2320', '#7aaac4');
        drawStars(12, 40);
        drawMountainRange('#1a3a2a', '#d0e8d0');
        // dairy billboard
        ctx.fillStyle = '#f5efd6';
        ctx.fillRect(320, 40, 70, 30);
        ctx.fillStyle = '#6d4221';
        ctx.fillRect(320, 40, 70, 2);
        ctx.fillRect(320, 68, 70, 2);
        ctx.fillRect(320, 40, 2, 30);
        ctx.fillRect(388, 40, 2, 30);
        drawCheeseWedge(340, 45);
      },
    },
    maple: {
      sky() {
        skyGradient('#2a1a10', '#c86428');
        // autumn trees
        for (let i = 0; i < 10; i++) {
          const x = i * 52 + ((i * 7) % 15);
          const topY = 50 - ((i % 3) * 4);
          ctx.fillStyle = '#6d4221';
          ctx.fillRect(x + 8, topY + 20, 3, 22);
          ctx.fillStyle = (i % 3 === 0) ? '#c83a3a' : ((i % 3 === 1) ? '#e88550' : '#ffd84a');
          ctx.fillRect(x, topY + 6, 20, 16);
          ctx.fillRect(x + 2, topY + 2, 16, 4);
          ctx.fillRect(x + 6, topY, 10, 2);
        }
      },
    },
  };

  // -------- State → motif map --------
  const STATE_MOTIF = {
    AL: 'pines',    AK: 'aurora',   AZ: 'desert',   AR: 'pines',
    CA: 'sunshine', CO: 'mountains',CT: 'skyline',  DE: 'crabs',
    FL: 'sunshine', GA: 'peach',    HI: 'volcano',  ID: 'mountains',
    IL: 'skyline',  IN: 'corn',     IA: 'corn',     KS: 'tornado',
    KY: 'horse',    LA: 'oil',      ME: 'lighthouse', MD: 'crabs',
    MA: 'skyline',  MI: 'lakes',    MN: 'lakes',    MS: 'pines',
    MO: 'arch',     MT: 'mountains',NE: 'corn',     NV: 'desert',
    NH: 'mountains',NJ: 'skyline',  NM: 'desert',   NY: 'skyline',
    NC: 'pines',    ND: 'corn',     OH: 'corn',     OK: 'tornado',
    OR: 'pines',    PA: 'skyline',  RI: 'skyline',  SC: 'pines',
    SD: 'rushmore', TN: 'horse',    TX: 'oil',      UT: 'redrock',
    VT: 'maple',    VA: 'pines',    WA: 'spaceneedle', WV: 'pines',
    WI: 'cheese',   WY: 'mountains',DC: 'capitol',  PR: 'tropical',
    VI: 'tropical', GU: 'tropical', AS: 'tropical', MP: 'tropical',
  };

  function stateCode() {
    const sd = (S.lot && S.lot.state_district) || '';
    return (sd.slice(0, 2) || '').toUpperCase();
  }

  function currentMotifName() {
    const code = stateCode();
    if (STATE_MOTIF[code]) return STATE_MOTIF[code];
    // Senate transactions don't carry a state_district — show the Capitol
    // dome backdrop instead of falling back to generic mountains.
    if (S.lot && S.lot.chamber === 'senate') return 'capitol';
    return 'mountains';
  }

  // -------- Motif caching --------
  // Sky layer cached per motif (static). Ground decorators drawn fresh each frame
  // because they overlap with the grass tufts and we redraw grass every frame.
  const skyCache = {};
  function skyCanvas(name) {
    if (skyCache[name]) return skyCache[name];
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = false;
    const savedCtx = ctx;
    ctx = cx;
    // Draw only sky portion (y 0-100)
    const motif = MOTIFS[name] || MOTIFS.mountains;
    motif.sky();
    ctx = savedCtx;
    skyCache[name] = c;
    return c;
  }

  // -------- Bank / Desk / Broker / Politician --------
  function drawBank() {
    const { x, y, w, h } = BANK;
    rect('rgba(0,0,0,0.45)', x + 4, y + h - 2, w + 2, 6);
    rect(PAL.stoneDk, x, y + 18, w, h - 20);
    rect(PAL.stone, x + 4, y + 22, w - 8, h - 28);
    rect(PAL.stoneDk, x - 4, y + h - 6, w + 8, 6);
    rect(PAL.stone, x - 4, y + h - 6, w + 8, 1);

    const colXs = [x + 8, x + 32, x + w - 36, x + w - 12];
    for (const cx of colXs) {
      rect(PAL.stone, cx, y + 22, 6, h - 28);
      rect(PAL.stoneDk, cx, y + 22, 1, h - 28);
      rect(PAL.stoneDk, cx + 5, y + 22, 1, h - 28);
      rect(PAL.stoneDk, cx - 1, y + 20, 8, 2);
      rect(PAL.stoneDk, cx - 1, y + h - 10, 8, 2);
    }

    ctx.fillStyle = PAL.stone;
    for (let i = 0; i < 14; i++) {
      ctx.fillRect(x + 14 + i, y + 18 - i, w - 28 - 2 * i, 1);
    }
    rect(PAL.stoneDk, x + 14, y + 18, w - 28, 1);

    rect(PAL.ink, x + 20, y + 20, w - 40, 10);
    rect(PAL.gold, x + 22, y + 22, w - 44, 6);
    textCentered('\u25C6 BANK \u25C6', x + w / 2, y + 22, PAL.ink, 6, true);

    // Doorway
    rect(PAL.ink, x + w / 2 - 8, y + h - 32, 16, 26);
    const doorClosed = S.step && (S.step.type === 'inBank' || (S.step.type === 'enterBank' && S.stepT > 0.2));
    if (doorClosed) {
      rect(PAL.wood, x + w / 2 - 7, y + h - 30, 14, 24);
      rect(PAL.woodLt, x + w / 2 - 7, y + h - 30, 14, 1);
      rect(PAL.goldDk, x + w / 2 + 3, y + h - 19, 2, 2);
    }

    const winY = y + 48;
    for (const wx of [x + 14, x + w - 22]) {
      rect(PAL.ink, wx, winY, 8, 12);
      rect('#1c2a56', wx + 1, winY + 1, 6, 10);
      rect(PAL.ink, wx + 4, winY, 1, 12);
      rect(PAL.ink, wx, winY + 5, 8, 1);
    }

    if (S.step && S.step.type === 'inBank') {
      const pulse = 0.4 + 0.25 * Math.sin(S.stepT * 8);
      ctx.fillStyle = `rgba(232, 197, 71, ${pulse})`;
      ctx.fillRect(x + w / 2 - 7, y + h - 30, 14, 24);
    }
  }

  function drawDesk() {
    const { x, y, w, h } = DESK;
    rect(PAL.wood, x, y, w, 5);
    rect(PAL.woodLt, x, y, w, 1);
    rect(PAL.wood, x + 2, y + 5, w - 4, h - 5);
    rect(PAL.woodLt, x + 2, y + 5, w - 4, 1);
    outlineRect(PAL.ink, x, y, w, h);
    rect(PAL.ink, x + 14, y + 12, 60, 12);
    rect(PAL.gold, x + 16, y + 14, 56, 8);
    textCentered('BROKER', x + 44, y + 15, PAL.ink, 6, true);
    rect(PAL.ink, x + w - 30, y + 12, 22, 6);
    rect(PAL.white, x + w - 28, y + 13, 18, 4);
    const tape = ['$ $ $', 'TRADE', 'OPEN'][Math.floor(S.walkPhaseT * 4) % 3] || '';
    text(tape, x + w - 26, y + 13, PAL.ink, 5, true);
  }

  function drawBroker() {
    const { x, y } = DESK;
    const bx = x + 14;
    const by = y - 26;
    rect(PAL.brokerSuit, bx + 1, by + 10, 10, 16);
    rect(PAL.brokerSuitDk, bx + 1, by + 10, 10, 1);
    outlineRect(PAL.ink, bx, by + 10, 12, 16);
    rect(PAL.brokerTie, bx + 5, by + 11, 2, 10);
    rect(PAL.brokerSkinDk, bx + 4, by + 8, 4, 2);
    rect(PAL.brokerSkin, bx + 3, by + 2, 6, 7);
    outlineRect(PAL.ink, bx + 2, by + 1, 8, 9);
    rect(PAL.ink, bx + 4, by + 4, 1, 1);
    rect(PAL.ink, bx + 7, by + 4, 1, 1);
    rect(PAL.brokerSkinDk, bx + 5, by + 6, 2, 1);
    rect(PAL.brokerHair, bx + 3, by + 1, 6, 1);
    rect(PAL.brokerHair, bx + 2, by + 2, 1, 2);
    rect(PAL.brokerHair, bx + 9, by + 2, 1, 2);

    drawBrokerArm(bx, by);
  }

  function drawBrokerArm(bx, by) {
    const phase = S.gavelPhase;
    if (phase === 'slam') {
      rect(PAL.brokerSuit, bx + 11, by + 12, 4, 3);
      rect(PAL.brokerSkin, bx + 15, by + 13, 2, 2);
      drawGavel(bx + 17, by + 12, Math.PI * 0.55);
      if (S.gavelT < 0.18) drawImpact(bx + 24, by + 24);
    } else if (phase === 'raised') {
      rect(PAL.brokerSuit, bx + 11, by + 4, 4, 6);
      rect(PAL.brokerSkin, bx + 14, by + 2, 3, 3);
      drawGavel(bx + 18, by - 2, -Math.PI * 0.2);
    } else {
      rect(PAL.brokerSuit, bx + 11, by + 14, 4, 4);
      rect(PAL.brokerSkin, bx + 15, by + 16, 2, 2);
    }
    rect(PAL.brokerSuit, bx - 2, by + 14, 3, 6);
  }

  function drawGavel(x, y, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle || 0);
    ctx.fillStyle = PAL.wood;
    ctx.fillRect(-3, -3, 10, 6);
    ctx.fillStyle = PAL.woodLt;
    ctx.fillRect(-3, -3, 10, 1);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(-3, -3, 10, 1);
    ctx.fillRect(-3, 2, 10, 1);
    ctx.fillRect(-3, -3, 1, 6);
    ctx.fillRect(6, -3, 1, 6);
    ctx.fillStyle = PAL.wood;
    ctx.fillRect(1, 3, 2, 12);
    ctx.fillStyle = PAL.woodLt;
    ctx.fillRect(1, 3, 1, 12);
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(0, 3, 1, 12);
    ctx.fillRect(3, 3, 1, 12);
    ctx.restore();
  }

  function drawImpact(x, y) {
    const t = S.gavelT;
    const r = Math.min(12, 3 + t * 50);
    ctx.fillStyle = PAL.gold;
    for (const a of [-1.4, -0.4, 0.4, 1.4]) {
      const dx = Math.cos(a) * r;
      const dy = Math.sin(a) * r;
      ctx.fillRect((x + dx) | 0, (y + dy) | 0, 2, 2);
    }
    ctx.fillStyle = PAL.white;
    ctx.fillRect(x - 1, y - 1, 3, 3);
  }

  // -------- Politician (neutral) --------
  function drawPolitician(x, yFeet) {
    if (S.polAlpha <= 0.01) return;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = S.polAlpha;

    const top = yFeet - 28;
    const frame = S.walkPhase;

    ctx.fillStyle = `rgba(0,0,0,${0.4 * S.polAlpha})`;
    ctx.fillRect(x - 2, yFeet, 16, 2);

    // Fedora
    rect(PAL.hat, x + 3, top, 6, 2);
    rect(PAL.hat, x + 2, top + 2, 8, 3);
    rect(PAL.hatBand, x + 2, top + 4, 8, 1);
    rect(PAL.hat, x - 1, top + 5, 14, 2);
    rect(PAL.ink, x - 1, top + 5, 14, 1);
    rect(PAL.ink, x - 1, top + 6, 14, 1);

    // Face in shadow
    rect(PAL.face, x + 3, top + 7, 6, 4);
    rect(PAL.faceDk, x + 3, top + 7, 6, 1);
    outlineRect(PAL.ink, x + 2, top + 7, 8, 4);
    rect(PAL.ink, x + 4, top + 8, 1, 1);
    rect(PAL.ink, x + 7, top + 8, 1, 1);

    // Coat
    rect(PAL.coatDk, x + 4, top + 11, 4, 1);
    rect(PAL.coat, x + 2, top + 12, 8, 7);
    rect(PAL.coatDk, x + 2, top + 18, 8, 1);
    outlineRect(PAL.ink, x + 1, top + 12, 10, 7);
    rect(PAL.coatDk, x + 5, top + 12, 1, 4);
    rect(PAL.coatDk, x + 6, top + 12, 1, 4);

    // Arms
    rect(PAL.coat, x + 1, top + 13, 2, 4);
    rect(PAL.face, x + 1, top + 17, 2, 1);
    rect(PAL.coat, x + 9, top + 13, 2, 4);
    rect(PAL.face, x + 9, top + 17, 2, 1);

    // Pants + legs
    rect(PAL.pants, x + 2, top + 19, 8, 2);
    if (frame === 0) {
      rect(PAL.shoes, x + 2, top + 21, 3, 5);
      rect(PAL.shoes, x + 7, top + 21, 3, 4);
    } else {
      rect(PAL.shoes, x + 2, top + 21, 3, 4);
      rect(PAL.shoes, x + 7, top + 21, 3, 5);
    }
    rect(PAL.ink, x + 1, top + 25, 4, 1);
    rect(PAL.ink, x + 7, top + 25, 4, 1);

    // Carried item
    if (S.carried === 'bag') drawMoneyBag(x + 10, top + 16);
    else if (S.carried === 'stock') drawStockNotes(x + 10, top + 15);

    ctx.globalAlpha = prev;
  }

  function drawMoneyBag(x, y) {
    rect(PAL.ink, x - 1, y - 2, 7, 2);
    rect(PAL.woodLt, x, y - 1, 5, 1);
    rect(PAL.ink, x - 2, y, 9, 9);
    rect(PAL.wood, x - 1, y + 1, 7, 7);
    rect(PAL.woodLt, x - 1, y + 1, 7, 1);
    rect(PAL.gold, x + 1, y + 3, 3, 4);
    textCentered('$', x + 2, y + 3, PAL.ink, 6, true);
  }

  function drawStockNotes(x, y) {
    rect(PAL.ink, x - 1, y - 1, 11, 11);
    rect(PAL.paper, x, y, 9, 9);
    rect(PAL.goldDk, x, y, 9, 1);
    rect(PAL.goldDk, x, y + 8, 9, 1);
    rect(PAL.ink, x + 1, y + 2, 7, 1);
    rect(PAL.ink, x + 1, y + 4, 5, 1);
    rect(PAL.ink, x + 1, y + 6, 6, 1);
    rect(PAL.goldDk, x + 6, y + 1, 3, 2);
  }

  // -------- Banners & tags --------
  function drawStateBanner(cx, y) {
    if (!S.lot || S.polAlpha < 0.1) return;
    const sd = S.lot.state_district || '';
    const chamber = (S.lot.chamber || '').toLowerCase();
    let label = sd;
    if (!label && chamber === 'senate') label = 'SENATE';
    if (!label) return;
    const tt = S.txType || (S.lot && S.lot.transaction_type);
    const color = tt === 'purchase' ? PAL.green
      : (tt || '').startsWith('sale') ? PAL.red
      : PAL.gold;
    ctx.font = 'bold 7px "Press Start 2P", monospace';
    const tw = Math.max(34, ctx.measureText(label).width + 12);
    const bx = cx - tw / 2;
    rect(PAL.wood, cx - 1, y + 4, 2, 10);
    rect(PAL.ink, cx - 2, y + 4, 1, 10);
    rect(PAL.ink, bx - 1, y - 1, tw + 2, 14);
    rect(color, bx, y, tw, 12);
    rect(PAL.ink, bx, y, tw, 1);
    rect(PAL.ink, bx, y + 11, tw, 1);
    textCentered(label, cx, y + 3, PAL.ink, 7, true);
  }

  function drawCarriedLabel(polX, yFeet) {
    if (S.polAlpha < 0.4) return;
    const label = S.carried === 'bag' ? S.amountLabel
      : S.carried === 'stock' ? S.tickerLabel : '';
    if (!label) return;
    drawTag(polX + 14, yFeet - 28, label, S.carried === 'bag' ? PAL.gold : PAL.paper);
  }

  function drawTag(x, y, label, bg) {
    ctx.font = 'bold 7px "Press Start 2P", monospace';
    const tw = ctx.measureText(label).width + 10;
    rect(PAL.ink, x, y - 1, tw + 2, 12);
    rect(bg, x + 1, y, tw, 10);
    text(label, x + 5, y + 2, PAL.ink, 7, true);
  }

  // -------- Speech bubbles --------
  function drawBubble(anchorX, anchorY, lines) {
    ctx.font = `bold ${BUBBLE_PX}px "Press Start 2P", monospace`;
    const widths = lines.map(l => ctx.measureText(l).width);
    const maxW = Math.max(...widths);
    const w = Math.max(64, maxW + 18);
    const h = lines.length * (BUBBLE_PX + BUBBLE_LINE_GAP) + 12;

    let x = anchorX - w / 2;
    if (x < 4) x = 4;
    if (x + w > W - 4) x = W - 4 - w;
    const y = Math.max(2, anchorY - h - 14);

    rect('rgba(0,0,0,0.5)', x + 3, y + 3, w, h);
    rect(PAL.white, x, y, w, h);
    outlineRect(PAL.ink, x, y, w, h);
    // soften corners (pixel bevels)
    rect(PAL.paper, x, y, 1, 1);
    rect(PAL.paper, x + w - 1, y, 1, 1);
    rect(PAL.paper, x, y + h - 1, 1, 1);
    rect(PAL.paper, x + w - 1, y + h - 1, 1, 1);
    rect(PAL.ink, x + 1, y, 1, 1);
    rect(PAL.ink, x + w - 2, y, 1, 1);
    rect(PAL.ink, x, y + 1, 1, 1);
    rect(PAL.ink, x + w - 1, y + 1, 1, 1);
    rect(PAL.ink, x + 1, y + h - 1, 1, 1);
    rect(PAL.ink, x + w - 2, y + h - 1, 1, 1);
    rect(PAL.ink, x, y + h - 2, 1, 1);
    rect(PAL.ink, x + w - 1, y + h - 2, 1, 1);

    drawBubbleTail(x, y, w, h, anchorX, anchorY);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lw = ctx.measureText(line).width;
      text(line, x + (w - lw) / 2, y + 6 + i * (BUBBLE_PX + BUBBLE_LINE_GAP), PAL.ink, BUBBLE_PX, true);
    }
  }

  function drawBubbleTail(bx, by, bw, bh, ax, ay) {
    const baseY = by + bh;
    const baseCenter = Math.min(Math.max(bx + 14, ax), bx + bw - 14);
    const baseHalf = 6;
    const steps = Math.max(4, ay - baseY);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const rowY = baseY + i;
      const cxLine = baseCenter + (ax - baseCenter) * t;
      const halfW = Math.max(0, Math.round(baseHalf * (1 - t)));
      rect(PAL.white, cxLine - halfW, rowY, halfW * 2 + 1, 1);
      rect(PAL.ink, cxLine - halfW, rowY, 1, 1);
      rect(PAL.ink, cxLine + halfW, rowY, 1, 1);
    }
    rect(PAL.white, baseCenter - baseHalf + 1, baseY, baseHalf * 2 - 1, 1);
  }

  function bubbleAnchor(who) {
    if (who === 'politician') return { x: (S.polX | 0) + 6, y: POLITICIAN_Y - 30 };
    if (who === 'broker') return { x: DESK.x + 22, y: DESK.y - 22 };
    if (who === 'bank') return { x: BANK.x + BANK.w / 2, y: BANK.y + 4 };
    return { x: W / 2, y: 40 };
  }

  // -------- Render --------
  function render() {
    if (!ctx) return;
    const motifName = currentMotifName();
    const motif = MOTIFS[motifName] || MOTIFS.mountains;
    // Sky from cache
    ctx.drawImage(skyCanvas(motifName), 0, 0);
    // Shared grass/path
    drawGrassAndPath();
    // Ground motif decorators (on top of grass)
    if (motif.ground) motif.ground();

    drawBank();
    drawDesk();
    drawBroker();

    if (S.lot) {
      drawPolitician(S.polX | 0, POLITICIAN_Y);
      drawStateBanner((S.polX | 0) + 6, POLITICIAN_Y - 48);
      drawCarriedLabel(S.polX | 0, POLITICIAN_Y);
    }

    if (S.bubble) {
      const a = bubbleAnchor(S.bubble.who);
      drawBubble(a.x, a.y, S.bubble.lines);
    }

    if (S.flashT > 0) {
      ctx.fillStyle = `rgba(255, 240, 160, ${S.flashT * 0.45})`;
      ctx.fillRect(0, 0, W, H);
    }

    drawEpilogueOverlay();
  }

  function drawEpilogueOverlay() {
    if (!S.step || S.step.type !== 'epilogue') return;
    const step = S.step;
    const t = S.stepT;
    const total = step.duration || 3.0;
    const fadeIn = 0.55;
    const fadeOut = 0.55;
    let alpha = 1;
    if (t < fadeIn) alpha = t / fadeIn;
    else if (t > total - fadeOut) alpha = Math.max(0, (total - t) / fadeOut);

    // Black curtain
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.92})`;
    ctx.fillRect(0, 0, W, H);

    // Faint grain so it doesn't feel empty
    if (alpha > 0.1) {
      ctx.globalAlpha = alpha * 0.07;
      ctx.fillStyle = PAL.white;
      for (let i = 0; i < 50; i++) {
        const x = ((i * 97 + (S.walkPhaseT * 50 | 0)) % W) | 0;
        const y = ((i * 53) % H) | 0;
        ctx.fillRect(x, y, 1, 1);
      }
      ctx.globalAlpha = 1;
    }

    ctx.globalAlpha = alpha;
    if (step.phase === 'intro') {
      textCentered(step.title || '\u2605  BASED ON A TRUE STORY  \u2605',
        W / 2, H / 2 - 4, PAL.gold, 10, true);
    } else if (step.phase === 'entry') {
      // Wrap and lay out once per step — these inputs don't change while
      // the card is on screen, but render() runs every frame.
      let layout = step._layout;
      if (!layout) {
        const leadLines = wrapText(step.lead || '', W - 70, 8, true).slice(0, 3);
        const leadLineH = 12;
        const leadTopY = 16;
        const leadBottom = leadTopY + leadLines.length * leadLineH;
        const attrBotY = H - 12;
        const asset = step.assetName || step.ticker || '?';
        const assetTrim = asset.length > 56 ? asset.slice(0, 53) + '...' : asset;
        const attrTop = attrBotY - 26;
        const lineH = 14;
        const avail = Math.max(20, attrTop - leadBottom - 12);
        const descLines = wrapText(`\u201C${step.description}\u201D`, W - 64, 9, false);
        const maxLines = Math.max(1, Math.floor(avail / lineH));
        const shown = descLines.slice(0, maxLines);
        if (descLines.length > maxLines) shown[maxLines - 1] = shown[maxLines - 1].slice(0, -3) + '...';
        const descTotalH = shown.length * lineH;
        const descTop = leadBottom + 10 + Math.max(0, (avail - descTotalH) / 2);
        layout = step._layout = {
          leadLines, leadLineH, leadTopY,
          amtLine: `UP TO ${step.amount}  \u00B7  ${step.dirLabel || 'Trade'}`,
          assetLine: `\u2014 ${assetTrim}`,
          attrBotY,
          shown, descTop, lineH,
        };
      }
      for (let i = 0; i < layout.leadLines.length; i++) {
        textCentered(layout.leadLines[i], W / 2, layout.leadTopY + i * layout.leadLineH, PAL.gold, 8, true);
      }
      textCentered(layout.amtLine, W / 2, layout.attrBotY - 10, PAL.paper, 7, true);
      textCentered(layout.assetLine, W / 2, layout.attrBotY - 22, PAL.paper, 7, false);
      for (let i = 0; i < layout.shown.length; i++) {
        textCentered(layout.shown[i], W / 2, layout.descTop + i * layout.lineH, PAL.white, 9, false);
      }
    } else if (step.phase === 'outro') {
      textCentered('\u2605', W / 2, H / 2 - 4, PAL.gold, 12, true);
    }
    ctx.globalAlpha = 1;
  }

  window.Scene = { init, setLot, isIdle, setPaused };
})();
