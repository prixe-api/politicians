<p align="center">
  <img src="./static/logo.svg" alt="The Legend of Stocks seal" width="200" height="200">
</p>

<h1 align="center">The Legend of Stocks</h1>

A pixel-art exploration of U.S. politician financial disclosures, built on
top of the [Prixe](https://prixe.io) Politicians API. Two pages, both
Zelda-flavoured:

**House & Senate** (`/`) — auction-block simulation. Every few seconds a
politician walks across a state-themed backdrop, visits the bank and the
broker's desk, and the gavel comes down. Same-day filings by the same
politician are collapsed into one scripted scene with "anything else?"
broker prompts. When the politician leaves, a movie-credits epilogue prints
the filing's `description` text, verbatim.

**The Executive Wing** (`/executive`) — interactive exploration of White
House OGE 278e annual disclosures. Pick a filer from the roster; arrow keys
walk them across a pixel lawn studded with easter eggs — positions held,
assets, income, and liabilities. Bump an egg to inspect the entry in the
panel below. High-volume filers (Trump's ~3,800 asset rows) paginate within
each room. Trump and Vance render with MAGA caps.

It is a toy. It is also a reasonable starting point for anyone who wants a
compact, self-hosted disclosure visualizer — the API wrapper, the caching
layer, the grouped animation, the deep-link URL routing, and the
arrow-key field renderer are all yours to rip apart.

## Features

- **Auction-block simulation** — an animated HTML Canvas scene per filing:
  bank visit, broker's desk, gavel slam, speech bubbles, epilogue card with
  the filer's verbatim description.
- **Executive Wing exploration** — separate page (`/executive`) for OGE 278e
  White House disclosures. Roster-driven selection, arrow-key navigation,
  color-coded easter eggs across four rooms (positions / assets / income /
  liabilities). High-volume filers paginate. Unparseable PDFs (some scanned
  filings) link out to the upstream original.
- **20 state-themed backdrops** — mountains for CO, peaches for GA, crabs for
  MD, sunshine for FL, volcanoes for HI, Gateway Arch for MO, Rushmore for SD,
  Space Needle for WA, etc. Every 50 states + DC + territories mapped.
- **Same-day trade grouping** — one continuous scene per `(politician,
  transaction_date)`. Purchases first, then sales. Broker randomly greets by
  name: `HOWYA DOIN' GOTTHEIMER?`, `AH, PELOSI!`, `WELCOME BACK!`.
- **Per-state, per-date, per-asset deep links** — `#/politician/<slug>`,
  `#/politician/<slug>/<yyyy_mm_dd>`, and
  `#/politician/<slug>/<yyyy_mm_dd>/<asset_slug>` all filter the feed and the
  animation.
- **Holdings drill-down** — click any politician name to see their net
  trading activity for the year (round-trips clearly marked).
- **Resilient API wrapper** — single-flight TTL cache, retry with backoff,
  auto-fallback year when the current year hasn't populated yet, background
  warm-up on boot.
- **Single-process** — Flask serves both the API and the static assets. No
  nginx, no reverse proxy, no build step.

## Prerequisites

- A Prixe API key with a **Pro+ subscription** — the upstream endpoints this
  app uses (`/api/politicians`, `/api/politicians/list`,
  `/api/politicians/holdings`, `/api/politicians/executive_disclosures`) all
  require it. Sign up at [prixe.io](https://prixe.io).
- Either Docker (recommended) or Python 3.12.

The app covers both chambers. **House** disclosures date back to 2008;
**Senate** disclosures to 2012 (the electronic-filing rollout date). A small
share of Senate PTRs are scanned-image "paper" filings that Prixe cannot yet
OCR — those are transparently skipped by the upstream and surfaced as an
`errors[]` entry on the response. Senate transactions have `state_district`
and `notification_date` fields set to `null` (the Senate eFD system doesn't
expose those fields); the scene falls back to a Capitol motif for them.

## Configuration

Create a `.env` file in the project root:

```
PRIXE_API_KEY=your_key_here
```

That is the only required environment variable.

## Quick start with Docker

```bash
git clone <your-fork-url> politicians
cd politicians
echo "PRIXE_API_KEY=your_key_here" > .env
docker compose up -d --build
```

Then open [http://localhost:8088](http://localhost:8088).

The default compose file publishes port **8088** on the host (internal 8000).
Change the left side of `"8088:8000"` in `docker-compose.yml` if that port is
already taken.

To tail logs: `docker compose logs -f`. To stop: `docker compose down`.

## Running without Docker

The app runs on Python 3.12 with three dependencies. Use a project-local venv:

```bash
git clone <your-fork-url> politicians
cd politicians
echo "PRIXE_API_KEY=your_key_here" > .env

python3 -m venv venv
./venv/bin/pip install -r requirements.txt

# Dev mode (auto-reload, single thread)
PRIXE_API_KEY=$(grep PRIXE_API_KEY .env | cut -d= -f2) ./venv/bin/python app.py

# Or prod mode (same config the container uses)
PRIXE_API_KEY=$(grep PRIXE_API_KEY .env | cut -d= -f2) \
  ./venv/bin/gunicorn --bind 0.0.0.0:8000 --workers 1 --threads 8 --timeout 120 app:app
```

Then open [http://localhost:8000](http://localhost:8000).

## URL routing

The main page accepts optional hash-based filters. All three segments are
optional after the politician slug:

| URL | What it shows |
|---|---|
| `/` | All latest filings across politicians |
| `#/politician/hon_nancy_pelosi` | Latest filings for one politician |
| `#/politician/hon_sheri_biggs/2026_03_04` | One politician, one date |
| `#/politician/hon_sheri_biggs/2026_03_04/iShares_Bitcoin_Trust_ETF` | One specific trade |
| `#/politician/hon_nancy_pelosi/NVDA` | Latest trades of one asset by one politician |
| `/executive` | The Executive Wing — pick an OGE 278e filer and walk their disclosure |

The asset segment is slugified: lowercase + any non-alphanumeric run becomes
`_`. Both asset names and tickers are valid.

## Keyboard shortcuts

Index page (`/`):

- **←** / **→** — previous / next filing group
- **Space** — pause / resume rotation
- **Esc** — close the holdings modal

Executive Wing (`/executive`):

- **↑** **↓** **←** **→** — walk the lawn
- **1** / **2** / **3** / **4** — switch room (positions / assets / income / liabilities)
- **[** / **]** (or **PageUp** / **PageDown**) — flip pages within a room

## API endpoints

The Flask app exposes a small JSON API if you want to reuse the backend
without the frontend:

| Endpoint | Description |
|---|---|
| `GET /api/health` | Liveness probe |
| `GET /api/latest?year=&politician=&start_date=&end_date=&asset_slug=&limit=&pool=` | Latest transactions with optional filters |
| `GET /api/directory?year=` | Index of filers for the year |
| `GET /api/holdings?politician=&year=` | Net disclosed activity by asset |
| `GET /api/executive?politician=&ticker=&report_type=&limit=&offset=` | Paginated 278e filer summaries |
| `GET /api/executive/<filer_slug>` | Full 278e disclosure for one filer |

All dates are `YYYY-MM-DD`. `politician` is a slug (preferred) or a
case-insensitive substring of the full name.

## Project structure

```
.
├── app.py              # Flask app — API + static serving
├── requirements.txt    # flask, requests, gunicorn
├── Dockerfile          # python:3.12-slim + gunicorn
├── docker-compose.yml  # single service, port 8088:8000
├── static/
│   ├── index.html      # House & Senate shell
│   ├── executive.html  # Executive Wing shell
│   ├── styles.css      # NES/Zelda palette, CRT scanlines
│   ├── scene.js        # Index pixel-art canvas + scripted scenes
│   ├── app.js          # Index data fetching, grouping, routing, holdings modal
│   └── executive.js    # Executive Wing roster + arrow-key field renderer
└── .env                # your Prixe key (gitignored)
```

## Tech stack

- **Backend:** Flask + gunicorn, `requests` for Prixe calls, in-memory
  single-flight TTL cache, background warm-up thread on boot.
- **Frontend:** vanilla HTML/CSS/JavaScript. No build step, no framework.
  Canvas 2D for the pixel-art scene (offscreen-cached per-state backgrounds),
  Press Start 2P font from Google Fonts.

No database. No queue. No external services beyond Prixe.

## Memory

Expect ~40 MB RSS in normal use; 80–150 MB under heavy use with many unique
filtered queries in the cache. A 256 MB container limit is comfortable
headroom.

## Contributing

Fork it, hack it, open a PR if you want to. The code is deliberately small
and framework-free so it stays approachable. Good places to start if you
are looking:

- **More states, more motifs** — `scene.js` has ~20 state-themed backgrounds;
  add per-district or per-party variations.
- **Speech variety** — the broker greetings and politician lines are
  template-based; more variants always welcome.
- **Per-room decoration on `/executive`** — every room shares the same
  White House lawn. Differentiating positions / assets / income /
  liabilities visually (props, palette, parallax) would help orient.
- **Egg variety** — eggs are color-coded but otherwise identical. Distinct
  sprites per item kind (a podium for positions, a coin pile for assets,
  etc.) would make the lawn read at a glance.
- **Visited-egg memory** — the Executive Wing lawn doesn't track which
  eggs you've inspected. Persisting that across sessions would help when
  walking long rooms (Trump has ~138 pages of assets).
- **Accessibility** — neither canvas has ARIA output yet. Both pages fetch
  their data first, so a screen-reader-friendly transcript would be
  straightforward to add.

No CLA, no copyright assignment. The project is public domain (see below),
so you keep your own copyright on your contribution and release it under
the same terms when you submit a PR.

## License

[The Unlicense](./LICENSE) — released to the public domain. Do anything
you want with this code: run it, fork it, sell it, change it, remove
attribution, incorporate it into a proprietary product. No warranty of
any kind.

## Acknowledgements

- **Disclosure data:** [Prixe](https://prixe.io) — their Politicians API
  wraps and parses House PTR PDFs from
  [disclosures-clerk.house.gov](https://disclosures-clerk.house.gov).
- **Font:** [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P)
  by CodeMan38, licensed under the SIL Open Font License.
- **Aesthetic:** The Legend of Zelda (NES, 1986), the tradition of
  Saturday-morning pixel art, and a general weakness for auctioneer's
  gavels.
