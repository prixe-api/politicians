import json
import os
import re
import threading
import time
from collections import OrderedDict
from datetime import datetime

import requests
from flask import Flask, jsonify, request, send_from_directory

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(s: str | None) -> str:
    return _SLUG_RE.sub("_", (s or "").lower()).strip("_")

PRIXE_BASE = os.environ.get("PRIXE_BASE", "https://api.prixe.io").rstrip("/")
API_KEY = os.environ.get("PRIXE_API_KEY")
if not API_KEY:
    raise RuntimeError("PRIXE_API_KEY not set in environment")

HTTP_TIMEOUT = 75        # per-attempt upstream timeout (API Gateway caps around 29s, but some paths return faster after warm)
MAX_ATTEMPTS = 3         # upstream retry budget per logical call
TRANSIENT_STATUSES = {429, 502, 503, 504}

# Input size caps (defence-in-depth against oversized inputs)
MAX_STR_LEN = 200
MIN_YEAR = 2008

# Cache bounds — LRU eviction once either limit is exceeded.
# Entries are approximated by the byte length of their JSON serialization,
# computed once at insertion time. The byte budget is the dominant guard;
# the entry cap protects against a flood of tiny values.
MAX_CACHE_ENTRIES = int(os.environ.get("MAX_CACHE_ENTRIES", "200"))
MAX_CACHE_BYTES = int(os.environ.get("MAX_CACHE_BYTES", str(48 * 1024 * 1024)))


def _approx_size(value: object) -> int:
    try:
        return len(json.dumps(value, default=str))
    except Exception:
        return 1024  # fallback if value isn't JSON-serializable

app = Flask(__name__, static_folder="static", static_url_path="")

_session = requests.Session()
_session.headers.update({
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
})

# ----- Bounded single-flight TTL cache (LRU-ish eviction) -----
# Entries: key -> (expires_at, value, approx_bytes)
_cache: "OrderedDict[str, tuple[float, object, int]]" = OrderedDict()
_cache_bytes = 0
_cache_lock = threading.Lock()
_key_locks: dict[str, threading.Lock] = {}
_key_locks_meta = threading.Lock()


def _key_lock(key: str) -> threading.Lock:
    with _key_locks_meta:
        lock = _key_locks.get(key)
        if lock is None:
            # Cap the number of per-key locks to avoid unbounded growth
            if len(_key_locks) >= MAX_CACHE_ENTRIES * 4:
                _key_locks.clear()
            lock = threading.Lock()
            _key_locks[key] = lock
        return lock


def _evict_locked():
    """Evict oldest entries until cache is within both bounds. Caller holds _cache_lock."""
    global _cache_bytes
    while _cache and (
        len(_cache) > MAX_CACHE_ENTRIES or _cache_bytes > MAX_CACHE_BYTES
    ):
        _, (_, _, sz) = _cache.popitem(last=False)
        _cache_bytes -= sz
    if _cache_bytes < 0:
        _cache_bytes = 0


def cache_get_or_set(key: str, ttl: float, fn):
    global _cache_bytes
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > now:
            _cache.move_to_end(key)
            return hit[1]
    # Single-flight: serialize work for this key across threads
    with _key_lock(key):
        with _cache_lock:
            hit = _cache.get(key)
            if hit and hit[0] > time.time():
                _cache.move_to_end(key)
                return hit[1]
        value = fn()
        size = _approx_size(value)
        # Skip caching values larger than the whole budget — they'd just thrash.
        if size > MAX_CACHE_BYTES:
            return value
        with _cache_lock:
            prev = _cache.pop(key, None)
            if prev is not None:
                _cache_bytes -= prev[2]
            _cache[key] = (time.time() + ttl, value, size)
            _cache_bytes += size
            _evict_locked()
        return value


# ----- Prixe client -----
class UpstreamError(Exception):
    def __init__(self, status: int, detail):
        super().__init__(f"upstream {status}")
        self.status = status
        self.detail = detail


def prixe_post(path: str, body: dict) -> dict:
    last_detail: object = None
    last_status = 502
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            r = _session.post(PRIXE_BASE + path, json=body, timeout=HTTP_TIMEOUT)
        except requests.RequestException as e:
            last_detail = {"error": f"network: {e}"}
            last_status = 504
            if attempt < MAX_ATTEMPTS:
                time.sleep(2 * attempt)
                continue
            break
        if r.status_code in TRANSIENT_STATUSES and attempt < MAX_ATTEMPTS:
            try:
                last_detail = r.json()
            except Exception:
                last_detail = r.text
            last_status = r.status_code
            time.sleep(2 * attempt)
            continue
        if r.status_code >= 400:
            try:
                detail = r.json()
            except Exception:
                detail = r.text
            raise UpstreamError(r.status_code, detail)
        return r.json()
    raise UpstreamError(last_status, last_detail or {"error": "upstream retry exhausted"})


def parse_date(s):
    if not s:
        return 0.0
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).timestamp()
        except ValueError:
            continue
    return 0.0


_MONEY_RE = re.compile(r"\$?([\d,]+(?:\.\d+)?)")
# OGE 278e "Over $50,000,000" tier — there's no upper bound, so settle on the
# floor. Underestimates a few large filers but doesn't fabricate magnitudes.
_OVER_50M = 50_000_000.0


def parse_money_value(s) -> float:
    """Estimate a dollar value from an OGE 278e value/income field.

    Handles single amounts ('$143,879'), tier ranges ('$1,001 - $15,000' →
    midpoint), 'Over $X' (returns X), and 'None (or less than $X)' (returns 0).
    """
    if not s or not isinstance(s, str):
        return 0.0
    text = s.strip()
    low = text.lower()
    if not low or low.startswith("none") or "less than" in low and "over" not in low:
        # "None (or less than $201)" → 0; pure "less than" with no Over context
        return 0.0
    nums = [float(m.replace(",", "")) for m in _MONEY_RE.findall(text)]
    if not nums:
        return 0.0
    if low.startswith("over"):
        return max(nums[0], _OVER_50M)
    if len(nums) >= 2:
        return (nums[0] + nums[1]) / 2.0
    return nums[0]


_ASSET_SCHEDULES = ("employment_assets", "other_assets", "spouse_employment_assets")


def _filing_total_value(filing: dict) -> float:
    schedules = filing.get("schedules") or {}
    total = 0.0
    for name in _ASSET_SCHEDULES:
        for row in schedules.get(name) or []:
            total += parse_money_value(row.get("value"))
    return total


def _filing_total_liabilities(filing: dict) -> float:
    rows = (filing.get("schedules") or {}).get("liabilities") or []
    return sum(parse_money_value(r.get("amount")) for r in rows)


_META_KEYS = (
    "chambers_requested",
    "chambers_returned",
    "chambers_missing",
    "partial",
    "errors",
)


def _meta_of(data: object) -> dict:
    if not isinstance(data, dict):
        return {}
    return {k: data[k] for k in _META_KEYS if k in data}


def fetch_list(year: int, chamber: str | None = None) -> dict:
    key = f"list:{year}:{chamber or 'both'}"

    def call():
        # Upstream caps `limit` at 500; House+Senate combined can exceed that,
        # and downstream callers (_shape_latest_uncached's slug/district maps)
        # need every politician, so loop until the page comes back short.
        rows: list[dict] = []
        meta: dict = {}
        offset = 0
        page = 500
        while True:
            body: dict = {"year": year, "limit": page, "offset": offset}
            if chamber:
                body["chamber"] = chamber
            data = prixe_post("/api/politicians/list", body)
            if not meta:
                meta = _meta_of(data)
            batch = data.get("politicians", []) or []
            rows.extend(batch)
            if len(batch) < page:
                break
            offset += page
        return {"politicians": rows, **meta}

    return cache_get_or_set(key, 900, call)


def fetch_transactions(
    year: int,
    target: int,
    politician: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    chamber: str | None = None,
) -> dict:
    key = (
        f"txs:{year}:{target}:{(politician or '*').lower()}"
        f":{start_date or '*'}:{end_date or '*'}:{chamber or 'both'}"
    )

    def call():
        rows: list[dict] = []
        meta: dict = {}
        offset = 0
        page = 500
        while len(rows) < target:
            size = min(page, target - len(rows))
            body: dict = {
                "year": year,
                "limit": size,
                "offset": offset,
                "description": True,
            }
            if politician:
                body["politician"] = politician
            if start_date:
                body["start_date"] = start_date
            if end_date:
                body["end_date"] = end_date
            if chamber:
                body["chamber"] = chamber
            data = prixe_post("/api/politicians", body)
            if not meta:
                meta = _meta_of(data)
            batch = data.get("transactions", [])
            rows.extend(batch)
            if len(batch) < size:
                break
            offset += size
        return {"transactions": rows, **meta}

    return cache_get_or_set(key, 300, call)


def _shape_latest(
    year: int,
    limit: int,
    pool: int,
    politician: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    asset_slug: str | None = None,
    chamber: str | None = None,
):
    # Narrow filters don't need a 500-row pool — most never have that many
    # matches. Trim the upstream fetch so cold misses do less work.
    if asset_slug or politician:
        pool = min(pool, 200)

    cache_key = (
        f"shape:{year}:{limit}:{pool}:{(politician or '*').lower()}"
        f":{start_date or '*'}:{end_date or '*'}"
        f":{(asset_slug or '*').lower()}:{chamber or 'both'}"
    )
    return cache_get_or_set(cache_key, 60, lambda: _shape_latest_uncached(
        year, limit, pool, politician, start_date, end_date, asset_slug, chamber,
    ))


def _shape_latest_uncached(
    year, limit, pool, politician, start_date, end_date, asset_slug, chamber,
):
    result = fetch_transactions(
        year,
        target=pool,
        politician=politician,
        start_date=start_date,
        end_date=end_date,
        chamber=chamber,
    )
    # Support both the new dict shape and any cached list from an earlier build
    if isinstance(result, list):
        txs = result
        meta: dict = {}
    else:
        txs = result.get("transactions", []) or []
        meta = _meta_of(result)

    list_resp = fetch_list(year, chamber=chamber)
    if isinstance(list_resp, list):
        politicians = list_resp
    else:
        politicians = list_resp.get("politicians", []) or []

    if asset_slug:
        needle = slugify(asset_slug)
        txs = [
            t for t in txs
            if slugify(t.get("asset_name")) == needle
            or slugify(t.get("ticker")) == needle
        ]
    slug_map = {p["politician"]: p["politician_slug"] for p in politicians}
    district_map = {p["politician"]: p.get("state_district") for p in politicians}
    txs = sorted(
        txs,
        key=lambda t: (
            parse_date(t.get("filing_date")),
            parse_date(t.get("transaction_date")),
        ),
        reverse=True,
    )
    sliced = txs[:limit]
    for t in sliced:
        name = t.get("politician")
        if not t.get("politician_slug"):
            t["politician_slug"] = slug_map.get(name)
        if not t.get("state_district"):
            t["state_district"] = district_map.get(name)
        lo = t.get("amount_min") or 0
        hi = t.get("amount_max") or 0
        t["amount_midpoint"] = (lo + hi) / 2 if (lo or hi) else 0
    return {"transactions": sliced, **meta}


def _int_arg(name: str, default):
    v = request.args.get(name)
    if v is None or v == "":
        return default
    try:
        return int(v)
    except ValueError:
        raise ValueError(f"invalid {name}")


# ----- Routes -----
@app.errorhandler(UpstreamError)
def _upstream_err(e: UpstreamError):
    return jsonify(detail=e.detail, status=e.status), e.status


@app.errorhandler(ValueError)
def _value_err(e: ValueError):
    return jsonify(error=str(e)), 400


@app.route("/api/health")
def health():
    return jsonify(ok=True)


@app.route("/api/latest")
def latest():
    limit = max(1, min(_int_arg("limit", 50), 500))
    pool = max(1, min(_int_arg("pool", 500), 2000))
    requested = _int_arg("year", None)
    politician = (request.args.get("politician") or "").strip()[:MAX_STR_LEN] or None
    start_date = (request.args.get("start_date") or "").strip()[:10] or None
    end_date = (request.args.get("end_date") or "").strip()[:10] or None
    asset_slug = (request.args.get("asset_slug") or "").strip()[:MAX_STR_LEN] or None
    chamber = (request.args.get("chamber") or "").strip().lower() or None
    if chamber and chamber not in ("house", "senate"):
        raise ValueError("chamber must be 'house' or 'senate'")
    for label, val in (("start_date", start_date), ("end_date", end_date)):
        if val and not _DATE_RE.match(val):
            raise ValueError(f"invalid {label} (expected YYYY-MM-DD)")
    current_year = datetime.utcnow().year
    if requested is not None and not (MIN_YEAR <= requested <= current_year):
        raise ValueError(f"year must be between {MIN_YEAR} and {current_year}")

    shape_kwargs = {
        "politician": politician,
        "start_date": start_date,
        "end_date": end_date,
        "asset_slug": asset_slug,
        "chamber": chamber,
    }

    # Pick which filing years to try. Prixe's `year` = filing year, which can
    # be one year after the transaction happened (late-year trades disclosed
    # early the following year). When filtering by a transaction date we try
    # date_year+1 first, then the date_year itself.
    if requested is not None:
        candidates = [requested]
    elif start_date or end_date:
        try:
            dy = int((start_date or end_date)[:4])
            raw = [dy + 1, dy, dy - 1]
            # Prixe only accepts 2008..current_year
            seen: set[int] = set()
            candidates = []
            for y in raw:
                if y < 2008 or y > current_year:
                    continue
                if y in seen:
                    continue
                seen.add(y)
                candidates.append(y)
            if not candidates:
                candidates = [current_year]
        except ValueError:
            candidates = [current_year, current_year - 1, current_year - 2]
    else:
        candidates = [current_year, current_year - 1, current_year - 2]

    prefer_nonempty = bool(start_date or end_date or asset_slug)
    last_err: UpstreamError | None = None
    last_empty = None
    for i, candidate in enumerate(candidates):
        try:
            shaped = _shape_latest(candidate, limit, pool, **shape_kwargs)
        except UpstreamError as e:
            last_err = e
            if e.status not in TRANSIENT_STATUSES and e.status != 404:
                break
            continue
        sliced = shaped.get("transactions", []) if isinstance(shaped, dict) else shaped
        meta = _meta_of(shaped)
        if sliced or not prefer_nonempty:
            return jsonify(
                count=len(sliced),
                year=candidate,
                fallback=(i > 0),
                requested_year=candidates[0],
                politician=politician,
                start_date=start_date,
                end_date=end_date,
                asset_slug=asset_slug,
                chamber=chamber,
                transactions=sliced,
                **meta,
            )
        last_empty = (i, candidate, sliced, meta)

    if last_empty is not None:
        i, c, sliced, meta = last_empty
        return jsonify(
            count=0,
            year=c,
            fallback=(i > 0),
            requested_year=candidates[0],
            politician=politician,
            start_date=start_date,
            end_date=end_date,
            asset_slug=asset_slug,
            chamber=chamber,
            transactions=sliced,
            **meta,
        )
    assert last_err is not None
    raise last_err


@app.route("/api/directory")
def directory():
    current_year = datetime.utcnow().year
    year = _int_arg("year", current_year)
    if not (MIN_YEAR <= year <= current_year):
        raise ValueError(f"year must be between {MIN_YEAR} and {current_year}")
    chamber = (request.args.get("chamber") or "").strip().lower() or None
    if chamber and chamber not in ("house", "senate"):
        raise ValueError("chamber must be 'house' or 'senate'")
    resp = fetch_list(year, chamber=chamber)
    if isinstance(resp, list):
        return jsonify(year=year, count=len(resp), politicians=resp)
    politicians = resp.get("politicians", []) or []
    return jsonify(
        year=year, chamber=chamber, count=len(politicians), politicians=politicians,
        **_meta_of(resp),
    )


@app.route("/api/holdings")
def holdings():
    politician = (request.args.get("politician") or "").strip()[:MAX_STR_LEN]
    if not politician:
        return jsonify(error="politician required"), 400
    current_year = datetime.utcnow().year
    year = _int_arg("year", current_year)
    if not (MIN_YEAR <= year <= current_year):
        raise ValueError(f"year must be between {MIN_YEAR} and {current_year}")
    chamber = (request.args.get("chamber") or "").strip().lower() or None
    if chamber and chamber not in ("house", "senate"):
        raise ValueError("chamber must be 'house' or 'senate'")
    key = f"holdings:{politician.lower()}:{year}:{chamber or 'both'}"

    def call():
        # Upstream now defaults to limit=50; pass the max so a single response
        # still covers all of one politician's activity for the year.
        body: dict = {"politician": politician, "year": year, "limit": 500}
        if chamber:
            body["chamber"] = chamber
        return prixe_post("/api/politicians/holdings", body)

    data = cache_get_or_set(key, 600, call)
    # Pass through the full response so activity, matched_politicians, and
    # completeness metadata all reach the client intact.
    return jsonify(data)


def fetch_executive_page(
    limit: int,
    offset: int,
    politician: str | None = None,
    ticker: str | None = None,
    report_type: str | None = None,
) -> dict:
    """One page of OGE 278e filings, passed through to upstream, cached.

    Each (filter, limit, offset) combo is cached independently so the
    frontend can stream pages of 50 without re-scraping anything that's
    already warm. Pre-aggregating the full list (the prior approach)
    timed out the upstream gateway on cold starts (~5min for Trump's
    Textract pass alone), which is why warmup was failing with 504.
    """
    key = (
        f"executive_page:{(politician or '*').lower()}"
        f":{(ticker or '*').upper()}:{(report_type or '*').lower()}"
        f":{limit}:{offset}"
    )

    def call():
        body: dict = {"limit": limit, "offset": offset}
        if politician:
            body["politician"] = politician
        if ticker:
            body["ticker"] = ticker
        if report_type:
            body["report_type"] = report_type
        return prixe_post("/api/politicians/executive_disclosures", body)

    return cache_get_or_set(key, 1800, call)


def fetch_executive(
    politician: str | None = None,
    ticker: str | None = None,
    report_type: str | None = None,
) -> dict:
    """All matching OGE 278e filings — paginates upstream, caches per
    filter combo. Used by the detail endpoint as a fallback when the
    per-page cache doesn't yet have a slug. Avoid calling this with no
    `politician` filter on a cold cache: it can take ~5 minutes."""
    key = (
        f"executive_all:{(politician or '*').lower()}"
        f":{(ticker or '*').upper()}:{(report_type or '*').lower()}"
    )

    def call():
        rows: list[dict] = []
        offset = 0
        page = 50  # smaller pages keep individual upstream calls inside
        # the gateway timeout when one filer (e.g. Trump) is slow.
        while True:
            data = fetch_executive_page(page, offset, politician, ticker, report_type)
            batch = data.get("filings", []) or []
            rows.extend(batch)
            if len(batch) < page:
                break
            offset += page
        return {"filings": rows}

    return cache_get_or_set(key, 1800, call)


def _filing_summary(f: dict) -> dict:
    """Lightweight summary for the field-scene listing — no schedule rows."""
    header = f.get("header") or {}
    info = header.get("filer_information") or {}
    return {
        "filer_name": f.get("filer_name"),
        "filer_slug": f.get("filer_slug"),
        "position_line": info.get("position_line"),
        "report_type": header.get("report_type"),
        "parse_status": f.get("parse_status"),
        "pdf_url": f.get("pdf_url"),
        "tickers": f.get("tickers") or [],
        "total_estimated_value": _filing_total_value(f),
        "total_liabilities": _filing_total_liabilities(f),
    }


@app.route("/api/executive")
def executive_list():
    """Pages of filer summaries, passed straight through to upstream.

    Default `limit` is 50 to match upstream and keep cold pages within
    the gateway timeout. Frontend streams pages with `offset += limit`
    until `count < limit`, appending each batch into the field scene
    as it lands.
    """
    politician = (request.args.get("politician") or "").strip()[:MAX_STR_LEN] or None
    ticker = (request.args.get("ticker") or "").strip()[:MAX_STR_LEN] or None
    report_type = (request.args.get("report_type") or "").strip()[:MAX_STR_LEN] or None
    limit = max(1, min(_int_arg("limit", 50), 500))
    offset = max(0, _int_arg("offset", 0))

    data = fetch_executive_page(limit, offset, politician, ticker, report_type)
    filings = data.get("filings", []) or []
    summaries = [_filing_summary(f) for f in filings]
    return jsonify(
        success=True,
        count=len(summaries),
        total=data.get("total", len(summaries)),
        limit=limit,
        offset=offset,
        filings=summaries,
    )


@app.route("/api/executive/<slug>")
def executive_detail(slug):
    # Prefer the cached full list (instant); fall back to a single-filer
    # upstream call when the cache doesn't have it (e.g. before the field
    # page has loaded).
    cached = fetch_executive()
    for f in cached.get("filings", []):
        if f.get("filer_slug") == slug:
            return jsonify({
                **f,
                "total_estimated_value": _filing_total_value(f),
                "total_liabilities": _filing_total_liabilities(f),
            })
    fast = fetch_executive(politician=slug)
    for f in fast.get("filings", []):
        if f.get("filer_slug") == slug:
            return jsonify({
                **f,
                "total_estimated_value": _filing_total_value(f),
                "total_liabilities": _filing_total_liabilities(f),
            })
    return jsonify(error="filer not found"), 404


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/executive")
def executive_page():
    return send_from_directory(app.static_folder, "executive.html")


# ----- Background warm-up -----
def _warmup():
    time.sleep(0.5)
    current = datetime.utcnow().year
    for year in (current, current - 1, current - 2):
        try:
            fetch_list(year)
            fetch_transactions(year, target=500)
            print(f"[warmup] cached year {year}", flush=True)
            break
        except UpstreamError as e:
            print(f"[warmup] year {year} failed: {e.status} {e.detail}", flush=True)
        except Exception as e:
            print(f"[warmup] year {year} error: {e}", flush=True)

    # Executive disclosures (OGE 278e) — pre-warm only the first page so
    # the first visitor doesn't eat the cold-scrape latency for the
    # initial 50 filers. The frontend streams subsequent pages on its
    # own after the page renders, so the rest of the cache fills as
    # users browse rather than blocking warmup. Asking upstream for the
    # full list here used to 504 (gateway timeout) when Trump's ~5-min
    # Textract pass landed inside one page.
    try:
        fetch_executive_page(50, 0)
        print("[warmup] cached executive page 1 (50 filers)", flush=True)
    except UpstreamError as e:
        print(f"[warmup] executive failed: {e.status} {e.detail}", flush=True)
    except Exception as e:
        print(f"[warmup] executive error: {e}", flush=True)


# Skip warmup unless explicitly enabled. Avoids duplicated upstream calls
# under the Flask reloader (imports module twice) and across multiple
# Gunicorn workers. Set PRIXE_WARMUP=1 in the single process you want to
# warm the cache (e.g. an entrypoint script before the server starts, or
# one designated worker).
if os.environ.get("PRIXE_WARMUP") == "1":
    threading.Thread(target=_warmup, daemon=True, name="warmup").start()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
