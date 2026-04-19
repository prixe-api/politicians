<p align="center">
  <img src="./static/logo.svg" alt="The Legend of Stocks seal" width="200" height="200">
</p>

<h1 align="center">The Legend of Stocks</h1>

A pixel-art auction-block simulation of U.S. House of Representatives stock
disclosures, built on top of the [Prixe](https://prixe.io) Politicians API.
Every few seconds, a politician walks across a Zelda-themed backdrop — themed
to their state — visits the bank and the broker's desk, and the gavel comes
down. Same-day filings by the same politician are collapsed into one scripted
scene with "anything else?" broker prompts. When the politician leaves, a
movie-credits epilogue prints the filing's `description` text, verbatim.

It is a toy. It is also a reasonable starting point for anyone who wants a
compact, self-hosted disclosure visualizer — the API wrapper, the caching
layer, the grouped animation, and the deep-link URL routing are all yours to
rip apart.

## Features

- **Auction-block simulation** — an animated HTML Canvas scene per filing:
  bank visit, broker's desk, gavel slam, speech bubbles, epilogue card with
  the filer's verbatim description.
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

- A Prixe API key with a **Pro+ subscription** — the three endpoints this app
  uses (`/api/politicians`, `/api/politicians/list`, `/api/politicians/holdings`)
  all require it. Sign up at [prixe.io](https://prixe.io).
- Either Docker (recommended) or Python 3.12.

The app is **U.S. House only** — Prixe does not index Senate PTRs yet. House
disclosures date back to 2008.

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

The asset segment is slugified: lowercase + any non-alphanumeric run becomes
`_`. Both asset names and tickers are valid.

## Keyboard shortcuts

- **←** / **→** — previous / next filing group
- **Space** — pause / resume rotation
- **Esc** — close the holdings modal

## API endpoints

The Flask app exposes a small JSON API if you want to reuse the backend
without the frontend:

| Endpoint | Description |
|---|---|
| `GET /api/health` | Liveness probe |
| `GET /api/latest?year=&politician=&start_date=&end_date=&asset_slug=&limit=&pool=` | Latest transactions with optional filters |
| `GET /api/directory?year=` | Index of filers for the year |
| `GET /api/holdings?politician=&year=` | Net disclosed activity by asset |

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
│   ├── index.html      # shell
│   ├── styles.css      # NES/Zelda palette, CRT scanlines
│   ├── scene.js        # pixel-art canvas renderer + scripted scenes
│   └── app.js          # data fetching, grouping, routing, holdings modal
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
- **Senate support** — currently blocked upstream; if Prixe adds it, the
  scene machinery should not care.
- **Accessibility** — the canvas scene has no ARIA output yet; the
  data is all fetched first, so a screen-reader-friendly transcript of
  the current lot would be straightforward to add.

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
