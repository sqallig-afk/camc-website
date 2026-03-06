#!/usr/bin/env python3
"""
Scrape Mayo Clinic Labs Test Catalog into CAMC CSV schema.

Usage:
  python3 scripts/scrape_mayo_catalog.py --max-tests 300 --output analyses_scraped_mayo.csv

Notes:
- This extractor is intentionally conservative. It captures factual fields and leaves
  lab-specific fields (tube color, local delays, photo) for manual completion.
- Respect source terms of use and robots policies before bulk scraping.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import re
import string
import sys
import time
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence

import requests
from lxml import etree, html


HEADERS: List[str] = [
    "code",
    "nom",
    "nom_patient",
    "departement",
    "echantillon",
    "tube",
    "couleur_tube",
    "volume",
    "jeune",
    "conditions",
    "conservation",
    "delai",
    "methode",
    "valeurs_ref",
    "interet",
    "remarques",
    "photo",
]

MAYO_ROOT = "https://www.mayocliniclabs.com"
SEARCH_URL = MAYO_ROOT + "/search"
SITEMAP_URL = MAYO_ROOT + "/sitemap.xml"


@dataclass
class ScrapeConfig:
    max_tests: int
    delay_seconds: float
    timeout_seconds: float
    output_csv: str
    query_tokens: Sequence[str]
    debug_discovery: bool = False


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def truncate(value: str, max_len: int = 1800) -> str:
    value = normalize_space(value)
    return value if len(value) <= max_len else (value[: max_len - 1] + "…")


def fetch_text(session: requests.Session, url: str, timeout: float, retries: int = 3) -> str:
    last_err: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            response = session.get(url, timeout=timeout)
            response.raise_for_status()
            return response.text
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            if attempt < retries:
                time.sleep(0.6 * attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_err}")


def fetch_bytes(session: requests.Session, url: str, timeout: float, retries: int = 3) -> bytes:
    last_err: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            response = session.get(url, timeout=timeout)
            response.raise_for_status()
            return response.content
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            if attempt < retries:
                time.sleep(0.6 * attempt)
    raise RuntimeError(f"Failed to fetch {url}: {last_err}")

def discover_mayo_urls(session: requests.Session, cfg: ScrapeConfig) -> List[str]:
    discovered: Dict[str, None] = {}
    for token in cfg.query_tokens:
        if len(discovered) >= cfg.max_tests:
            break
        params = {"q": token}
        search_resp = session.get(SEARCH_URL, params=params, timeout=cfg.timeout_seconds)
        if search_resp.status_code != 200:
            continue
        tree = html.fromstring(search_resp.text)
        hrefs = tree.xpath("//a[@href]/@href")
        for href in hrefs:
            if "/test-catalog/Overview/" not in href:
                continue
            absolute = href if href.startswith("http") else MAYO_ROOT + href
            discovered[absolute] = None
            if len(discovered) >= cfg.max_tests:
                break
        time.sleep(cfg.delay_seconds)
    return list(discovered.keys())


def discover_mayo_urls_from_sitemaps(session: requests.Session, cfg: ScrapeConfig) -> List[str]:
    """
    Discover test overview URLs using the public sitemap(s).
    This avoids relying on JS-rendered search pages.
    """
    discovered: Dict[str, None] = {}
    to_visit = [SITEMAP_URL]
    visited: Dict[str, None] = {}
    last_error: Optional[Exception] = None

    while to_visit and len(discovered) < cfg.max_tests:
        sitemap_url = to_visit.pop(0)
        if sitemap_url in visited:
            continue
        visited[sitemap_url] = None

        try:
            raw = fetch_bytes(session, sitemap_url, timeout=cfg.timeout_seconds)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if cfg.debug_discovery:
                print(f"  sitemap: {sitemap_url} FETCH_FAIL {exc}")
            continue

        if sitemap_url.endswith(".gz"):
            try:
                raw = gzip.decompress(raw)
            except Exception:
                pass

        locs: List[str] = []
        try:
            root = etree.fromstring(raw)
            locs = [normalize_space(t) for t in root.xpath("//*[local-name()='loc']/text()")]
        except Exception:
            # Fallback: try HTML-ish parsing if XML fails.
            try:
                tree = html.fromstring(raw)
                locs = [normalize_space(t) for t in tree.xpath("//*[local-name()='loc']/text()")]
            except Exception:
                locs = []

        if cfg.debug_discovery:
            sample = [l for l in locs if l][:5]
            print(f"  sitemap: {sitemap_url} locs={len(locs)} sample={sample}")

        for loc in locs:
            loc = normalize_space(loc)
            if not loc:
                continue
            if (loc.endswith(".xml") or loc.endswith(".xml.gz")) and "sitemap" in loc and loc not in visited:
                to_visit.append(loc)
                continue
            if "/test-catalog/" in loc and "overview" in loc.lower():
                discovered[loc] = None
                if len(discovered) >= cfg.max_tests:
                    break

        time.sleep(cfg.delay_seconds)

    return list(discovered.keys())


def extract_field(text: str, labels: Sequence[str], stop_labels: Sequence[str]) -> str:
    label_pattern = "|".join(re.escape(label) for label in labels)
    stop_pattern = "|".join(re.escape(label) for label in stop_labels)
    pattern = rf"(?:{label_pattern})\s*:?\s*(.+?)(?=(?:{stop_pattern})\s*:|$)"
    match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        return ""
    return truncate(match.group(1))


def infer_department(name: str, useful_for: str) -> str:
    text = f"{name} {useful_for}".lower()
    if any(k in text for k in ("culture", "pcr", "microbio", "virus", "bacteria", "fung", "infect")):
        return "Microbiologie"
    if any(k in text for k in ("thyroid", "horm", "cortisol", "testosterone", "estradiol", "prolactin")):
        return "Hormonologie"
    if any(k in text for k in ("cbc", "hemat", "coag", "platelet", "hemoglobin", "esr")):
        return "Hématologie"
    if any(k in text for k in ("antibody", "autoimmune", "immun", "ige", "igg", "igm")):
        return "Immunologie"
    return "Chimie"


def infer_fasting(prep: str) -> str:
    low = prep.lower()
    if "fasting" in low or "fast " in low or "8 hour fast" in low or "12 hour fast" in low:
        if "12" in low:
            return "Oui (12h)"
        return "Oui (8-12h)"
    return "Non"


def extract_test_id(raw_text: str, url: str) -> str:
    match = re.search(r"Test ID\s*:?\s*([A-Z0-9\-]+)", raw_text, flags=re.IGNORECASE)
    if match:
        return match.group(1).upper()
    tail = url.rstrip("/").split("/")[-1]
    tail = re.sub(r"[^A-Za-z0-9\-]", "", tail)
    return (tail or "UNKNOWN")[:20].upper()


def parse_mayo_page(session: requests.Session, url: str, cfg: ScrapeConfig) -> Dict[str, str]:
    html_text = fetch_text(session, url, timeout=cfg.timeout_seconds)
    tree = html.fromstring(html_text)
    raw_text = normalize_space(tree.text_content())

    title = ""
    title_candidates = tree.xpath("//h1/text()")
    for candidate in title_candidates:
        candidate = normalize_space(candidate)
        if candidate:
            title = candidate
            break
    if not title:
        title = extract_test_id(raw_text, url)

    useful_for = extract_field(
        raw_text,
        labels=("Useful For", "Clinical Information"),
        stop_labels=(
            "Specimen Type",
            "Container",
            "Patient Preparation",
            "Collection Instructions",
            "Method Name",
            "Reference Values",
            "Interpretation",
        ),
    )
    specimen = extract_field(
        raw_text,
        labels=("Specimen Type",),
        stop_labels=(
            "Container",
            "Collection Instructions",
            "Patient Preparation",
            "Necessary Information",
            "Supplies",
            "Reject Criteria",
            "Method Name",
        ),
    )
    container = extract_field(
        raw_text,
        labels=("Container", "Container/Tube", "Collection Container/Tube"),
        stop_labels=(
            "Collection Instructions",
            "Patient Preparation",
            "Necessary Information",
            "Specimen Type",
            "Reject Criteria",
            "Method Name",
        ),
    )
    prep = extract_field(
        raw_text,
        labels=("Patient Preparation", "Patient Preparation Instructions"),
        stop_labels=(
            "Collection Instructions",
            "Container",
            "Specimen Type",
            "Necessary Information",
            "Method Name",
            "Reference Values",
        ),
    )
    method = extract_field(
        raw_text,
        labels=("Method Name", "Method"),
        stop_labels=(
            "Reference Values",
            "Interpretation",
            "Performing Laboratory",
            "CPT",
            "LOINC",
            "Useful For",
        ),
    )
    ref_values = extract_field(
        raw_text,
        labels=("Reference Values",),
        stop_labels=(
            "Interpretation",
            "Performing Laboratory",
            "CPT",
            "LOINC",
            "Test Classification",
        ),
    )
    report_available = extract_field(
        raw_text,
        labels=("Report Available", "Turnaround Time", "Expected Turnaround Time"),
        stop_labels=(
            "Specimen Type",
            "Method Name",
            "Reference Values",
            "Interpretation",
            "CPT",
            "LOINC",
        ),
    )
    stability = extract_field(
        raw_text,
        labels=("Specimen Stability Information", "Specimen Stability", "Stability"),
        stop_labels=(
            "Method Name",
            "Reference Values",
            "Interpretation",
            "CPT",
            "LOINC",
            "Performing Laboratory",
        ),
    )

    code = extract_test_id(raw_text, url)
    department = infer_department(title, useful_for)
    fasting = infer_fasting(prep)

    remarks_parts = [f"source_url: {url}"]
    if prep:
        remarks_parts.append(f"patient_prep: {truncate(prep, 500)}")
    remarks = " | ".join(remarks_parts)

    row = {
        "code": code,
        "nom": truncate(title),
        "nom_patient": truncate(title),
        "departement": department,
        "echantillon": truncate(specimen),
        "tube": truncate(container),
        "couleur_tube": "",
        "volume": "",
        "jeune": fasting,
        "conditions": truncate(prep),
        "conservation": truncate(stability),
        "delai": truncate(report_available),
        "methode": truncate(method),
        "valeurs_ref": truncate(ref_values),
        "interet": truncate(useful_for),
        "remarques": truncate(remarks, 900),
        "photo": "",
    }
    return row


def write_rows(path: str, rows: Iterable[Dict[str, str]]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=HEADERS)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in HEADERS})


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Mayo Test Catalog into CAMC CSV format.")
    parser.add_argument("--output", default="analyses_scraped_mayo.csv", help="Output CSV path")
    parser.add_argument("--max-tests", type=int, default=250, help="Maximum number of tests to scrape")
    parser.add_argument("--delay", type=float, default=0.35, help="Delay between requests in seconds")
    parser.add_argument("--timeout", type=float, default=20.0, help="HTTP timeout in seconds")
    parser.add_argument(
        "--discovery",
        choices=("sitemap", "search"),
        default="sitemap",
        help="How to discover test URLs (default: sitemap)",
    )
    parser.add_argument("--debug-discovery", action="store_true", help="Print discovery debug output")
    parser.add_argument(
        "--queries",
        default=",".join(list(string.ascii_uppercase) + list(string.digits)),
        help="Comma-separated search tokens for discovery (default: A-Z + 0-9)",
    )
    parser.add_argument(
        "--urls-file",
        default="",
        help="Optional text file with one test URL per line (skip auto discovery)",
    )
    parser.add_argument(
        "--user-agent",
        default=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
        help="HTTP User-Agent header",
    )
    return parser.parse_args(argv)


def load_urls_from_file(path: str) -> List[str]:
    urls: List[str] = []
    with open(path, "r", encoding="utf-8") as source_file:
        for raw in source_file:
            url = raw.strip()
            if not url or url.startswith("#"):
                continue
            urls.append(url)
    return urls


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    cfg = ScrapeConfig(
        max_tests=max(1, args.max_tests),
        delay_seconds=max(0.0, args.delay),
        timeout_seconds=max(5.0, args.timeout),
        output_csv=args.output,
        query_tokens=[t.strip() for t in args.queries.split(",") if t.strip()],
        debug_discovery=bool(args.debug_discovery),
    )

    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": args.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
        }
    )

    if args.urls_file:
        urls = load_urls_from_file(args.urls_file)
    else:
        if args.discovery == "search":
            print(f"[1/3] Discovering Mayo URLs using {len(cfg.query_tokens)} search tokens...")
            urls = discover_mayo_urls(session, cfg)
        else:
            print("[1/3] Discovering Mayo URLs via sitemap(s)...")
            urls = discover_mayo_urls_from_sitemaps(session, cfg)

    if not urls:
        print("No URLs discovered. Try --urls-file with explicit links.", file=sys.stderr)
        return 2

    urls = urls[: cfg.max_tests]
    print(f"[2/3] Scraping {len(urls)} test pages...")

    rows: List[Dict[str, str]] = []
    for index, url in enumerate(urls, start=1):
        try:
            row = parse_mayo_page(session, url, cfg)
            rows.append(row)
            print(f"  - {index:04d}/{len(urls)} OK {row['code']} {row['nom'][:55]}")
        except Exception as exc:  # noqa: BLE001
            print(f"  - {index:04d}/{len(urls)} FAIL {url} ({exc})", file=sys.stderr)
        time.sleep(cfg.delay_seconds)

    print(f"[3/3] Writing CSV: {cfg.output_csv}")
    write_rows(cfg.output_csv, rows)
    print(f"Done. Wrote {len(rows)} rows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
