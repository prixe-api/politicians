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

PRIXE_BASE = "https://api.prixe.io"
API_KEY = os.environ.get("PRIXE_API_KEY")
if not API_KEY:
    raise RuntimeError("PRIXE_API_KEY not set in environment")

HTTP_TIMEOUT = 75        # per-attempt upstream timeout (API Gateway caps around 29s, but some paths return faster after warm)
MAX_ATTEMPTS = 3         # upstream retry budget per logical call
TRANSIENT_STATUSES = {429, 502, 503, 504}

# Input size caps (defence-in-depth against oversized inputs)
MAX_STR_LEN = 200
MIN_YEAR = 2008

# Cache bound — LRU eviction once this many live entries exist
MAX_CACHE_ENTRIES = 500

app = Flask(__name__, static_folder="static", static_url_path="")

_session = requests.Session()
_session.headers.update({
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
})

# ----- Bounded single-flight TTL cache (LRU-ish eviction) -----
_cache: "OrderedDict[str, tuple[float, object]]" = OrderedDict()
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


def cache_get_or_set(key: str, ttl: float, fn):
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
        with _cache_lock:
            _cache[key] = (time.time() + ttl, value)
            _cache.move_to_end(key)
            while len(_cache) > MAX_CACHE_ENTRIES:
                _cache.popitem(last=False)  # evict oldest
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
        body: dict = {"year": year}
        if chamber:
            body["chamber"] = chamber
        return prixe_post("/api/politicians/list", body)

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
        body: dict = {"politician": politician, "year": year}
        if chamber:
            body["chamber"] = chamber
        return prixe_post("/api/politicians/holdings", body)

    data = cache_get_or_set(key, 600, call)
    # Pass through the full response so activity, matched_politicians, and
    # completeness metadata all reach the client intact.
    return jsonify(data)


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


# ----- Background warm-up -----
def _warmup():
    time.sleep(0.5)
    current = datetime.utcnow().year
    for year in (current, current - 1, current - 2):
        try:
            fetch_list(year)
            fetch_transactions(year, target=500)
            print(f"[warmup] cached year {year}", flush=True)
            return
        except UpstreamError as e:
            print(f"[warmup] year {year} failed: {e.status} {e.detail}", flush=True)
        except Exception as e:
            print(f"[warmup] year {year} error: {e}", flush=True)


threading.Thread(target=_warmup, daemon=True, name="warmup").start()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
