#!/usr/bin/env python3
"""
Scrape CHU Unilab analyses and export to CAMC CSV schema.

Test run example:
  python3 scripts/scrape_chu_unilab.py --max-tests 30 --letters A --output analyses_scraped_chu_test.csv
"""

from __future__ import annotations

import argparse
import csv
import re
import string
import time
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import urljoin

import requests
from lxml import html


BASE = "https://www.chu.ulg.ac.be/"
LIST_URL = urljoin(BASE, "jcms/c_353640/analyses-liste-filtree-des-analyses")

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


@dataclass
class Config:
    output: str
    max_tests: int
    letters: Sequence[str]
    with_details: bool
    delay: float
    timeout: float
    scope_id: str


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip()


def clean_node_text(node) -> str:
    parts = [clean(t) for t in node.xpath(".//text()")]
    parts = [p for p in parts if p]
    return " / ".join(parts)


def infer_department(discipline: str) -> str:
    low = discipline.lower()
    if "anatomie pathologique" in low or "cytologie" in low or "histopath" in low:
        return "Anatomie Pathologique"
    if "génétique" in low or "genetique" in low:
        return "Génétique"
    if "hémat" in low or "hemat" in low:
        return "Hématologie"
    if "microbio" in low or "bacterio" in low or "virolog" in low or "mycolo" in low:
        return "Microbiologie"
    if "immuno" in low:
        return "Immunologie"
    if "hormono" in low or "endocr" in low:
        return "Hormonologie"
    return "Chimie"


def infer_fasting(conditions: str) -> str:
    low = conditions.lower()
    if "à jeun" in low or "a jeun" in low or "jeun" in low:
        if "12" in low:
            return "Oui (12h)"
        return "Oui (8-12h)"
    return "Non"


def extract_label_value(tree, label: str) -> str:
    # Prefer strict "label cell + value cell" pairs to avoid catching container rows.
    strict = tree.xpath(
        "//tr[td[contains(@class,'title') and contains(normalize-space(.), $label)]][1]/td[2]",
        label=label,
    )
    if strict:
        return clean_node_text(strict[0])

    fallback = tree.xpath("//tr[td[contains(normalize-space(.), $label)]][1]/td[2]", label=label)
    if fallback:
        return clean_node_text(fallback[0])
    return ""


def parse_list_letter(session: requests.Session, letter: str, cfg: Config) -> List[Dict[str, str]]:
    params = {
        "4": letter,
        "1": cfg.scope_id,
        "pageSize": "10",
        "pagerAll": "true",
        "reverse": "false",
    }
    response = session.get(LIST_URL, params=params, timeout=cfg.timeout)
    response.raise_for_status()
    tree = html.fromstring(response.text)

    rows: List[Dict[str, str]] = []
    current_discipline = ""

    for row in tree.xpath("//div[@id='analyses_body']//table[contains(@class,'contents')]//tr"):
        discipline_node = row.xpath("./td[contains(@class,'discipline')]")
        if discipline_node:
            current_discipline = clean_node_text(discipline_node[0])
            continue

        link_nodes = row.xpath("./td[2]//a[@href]")
        if not link_nodes:
            continue

        code_nodes = row.xpath("./td[1]")
        sample_nodes = row.xpath("./td[3]")
        method_nodes = row.xpath("./td[4]")

        code = clean_node_text(code_nodes[0]) if code_nodes else ""
        name = clean_node_text(link_nodes[0])
        href = link_nodes[0].get("href", "").strip()
        detail_url = urljoin(BASE, href)
        sample = clean_node_text(sample_nodes[0]) if sample_nodes else ""
        method = clean_node_text(method_nodes[0]) if method_nodes else ""

        rows.append(
            {
                "code": code,
                "nom": name,
                "nom_patient": name,
                "departement": infer_department(current_discipline),
                "echantillon": sample,
                "tube": "",
                "couleur_tube": "",
                "volume": "",
                "jeune": "Non",
                "conditions": "",
                "conservation": "",
                "delai": "",
                "methode": method,
                "valeurs_ref": "",
                "interet": "",
                "remarques": f"source_url: {detail_url} | discipline: {current_discipline}",
                "photo": "",
                "_detail_url": detail_url,
            }
        )

    return rows


def enrich_detail(session: requests.Session, row: Dict[str, str], cfg: Config) -> Dict[str, str]:
    url = row.get("_detail_url", "")
    if not url:
        return row

    try:
        response = session.get(url, timeout=cfg.timeout)
        response.raise_for_status()
    except Exception:  # noqa: BLE001
        return row

    tree = html.fromstring(response.text)

    sample = extract_label_value(tree, "Type d'échantillons")
    if sample and not row["echantillon"]:
        row["echantillon"] = sample

    tube = extract_label_value(tree, "Matériels")
    if tube:
        row["tube"] = tube

    conditions = extract_label_value(tree, "Conditions de collecte, traitement, conservation et transport")
    if conditions:
        row["conditions"] = conditions

    pre_delay = extract_label_value(tree, "Délai maximum du préanalytique")
    if pre_delay:
        row["conservation"] = pre_delay

    method = extract_label_value(tree, "Méthode et appareil")
    if method:
        row["methode"] = method

    delai = extract_label_value(tree, "Délais (sauf le week-end)")
    if delai:
        row["delai"] = delai

    interet = extract_label_value(tree, "Intérêt scientifique")
    if interet:
        row["interet"] = interet

    commentaire = extract_label_value(tree, "Commentaire")
    if commentaire:
        row["remarques"] = f"{row['remarques']} | commentaire: {commentaire}"

    row["jeune"] = infer_fasting(row["conditions"])
    return row


def dedupe(rows: Iterable[Dict[str, str]]) -> List[Dict[str, str]]:
    seen: Dict[Tuple[str, str], None] = {}
    output: List[Dict[str, str]] = []
    for row in rows:
        key = (row.get("code", "").strip(), row.get("nom", "").strip())
        if key in seen:
            continue
        seen[key] = None
        output.append(row)
    return output


def write_csv(path: str, rows: Iterable[Dict[str, str]]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=HEADERS)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in HEADERS})


def parse_letters(raw: str) -> List[str]:
    if not raw:
        return ["0"] + list(string.ascii_uppercase)
    letters = [clean(part).upper() for part in raw.split(",") if clean(part)]
    return letters


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape CHU Unilab analyses into CAMC CSV")
    parser.add_argument("--output", default="analyses_scraped_chu.csv")
    parser.add_argument("--max-tests", type=int, default=200)
    parser.add_argument("--letters", default="A", help="Comma-separated letters, e.g. A,B,C or 0,A")
    parser.add_argument("--with-details", action="store_true", help="Fetch each detail page")
    parser.add_argument("--delay", type=float, default=0.2)
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument(
        "--scope",
        choices=("bioclin", "anapath", "genetique", "all"),
        default="bioclin",
        help="CHU scope filter (default: bioclin)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    scope_map = {
        "bioclin": "c_351612",
        "anapath": "c_353514",
        "genetique": "c_352051",
        "all": "",
    }
    cfg = Config(
        output=args.output,
        max_tests=max(1, args.max_tests),
        letters=parse_letters(args.letters),
        with_details=bool(args.with_details),
        delay=max(0.0, args.delay),
        timeout=max(5.0, args.timeout),
        scope_id=scope_map[args.scope],
    )

    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        }
    )

    print(f"[1/3] Listing analyses for letters: {','.join(cfg.letters)} (scope={args.scope})")
    rows: List[Dict[str, str]] = []
    for letter in cfg.letters:
        try:
            chunk = parse_list_letter(session, letter, cfg)
            print(f"  - {letter}: {len(chunk)} analyses")
            rows.extend(chunk)
        except Exception as exc:  # noqa: BLE001
            print(f"  - {letter}: FAIL ({exc})")
        time.sleep(cfg.delay)
        if len(rows) >= cfg.max_tests:
            break

    rows = dedupe(rows)[: cfg.max_tests]

    if cfg.with_details:
        print(f"[2/3] Enriching details for {len(rows)} analyses")
        enriched: List[Dict[str, str]] = []
        for index, row in enumerate(rows, start=1):
            enriched.append(enrich_detail(session, row, cfg))
            if index % 25 == 0 or index == len(rows):
                print(f"  - detail {index}/{len(rows)}")
            time.sleep(cfg.delay)
        rows = enriched
    else:
        print("[2/3] Skipping detail pages (--with-details not set)")

    print(f"[3/3] Writing CSV: {cfg.output}")
    write_csv(cfg.output, rows)
    print(f"Done. Rows: {len(rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
