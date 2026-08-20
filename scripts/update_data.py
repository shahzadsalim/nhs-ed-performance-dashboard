#!/usr/bin/env python3
"""Build dashboard data from NHS England's public A&E publications."""

from __future__ import annotations

import csv
import io
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

import openpyxl


BASE = (
    "https://www.england.nhs.uk/statistics/statistical-work-areas/"
    "ae-waiting-times-and-activity"
)
ACUTE_TIMESERIES_URL = (
    "https://www.england.nhs.uk/wp-content/uploads/2026/08/"
    "acute-provider-timeseries.csv"
)
ACUTE_TABLE_PAGE = (
    "https://www.england.nhs.uk/statistics/statistical-work-areas/"
    "acute-provider-table/"
)
OUTPUT = Path(__file__).resolve().parents[1] / "dashboard.json"
MONTHS = {
    name.lower(): number
    for number, name in enumerate(
        [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ],
        start=1,
    )
}


class Download:
    def __init__(self, content: bytes):
        self.content = content

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")


def get(_client: object, url: str) -> Download:
    request = Request(
        url,
        headers={"User-Agent": "nhs-ed-performance-dashboard/1.0 (public statistics reuse)"},
    )
    with urlopen(request, timeout=60) as response:
        return Download(response.read())


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self.current_href: str | None = None
        self.current_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a" or self.current_href is not None:
            return
        href = dict(attrs).get("href")
        if href:
            self.current_href = href
            self.current_text = []

    def handle_data(self, data: str) -> None:
        if self.current_href is not None:
            self.current_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self.current_href is not None:
            text = " ".join("".join(self.current_text).split())
            self.links.append((text, self.current_href))
            self.current_href = None
            self.current_text = []


def financial_year_url(start_year: int) -> str:
    return (
        f"{BASE}/ae-attendances-and-emergency-admissions-"
        f"{start_year}-{str(start_year + 1)[-2:]}/"
    )


def parse_period(text: str) -> str | None:
    match = re.search(
        r"\b(" + "|".join(name.title() for name in MONTHS) + r")\s+(20\d{2}|\d{2})\b",
        text,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    year = int(match.group(2))
    if year < 100:
        year += 2000
    return f"{year:04d}-{MONTHS[match.group(1).lower()]:02d}"


def page_links(client: object, url: str) -> list[tuple[str, str]]:
    parser = LinkParser()
    parser.feed(get(client, url).text)
    return [(text, urljoin(url, href)) for text, href in parser.links]


def collect_publication_links(
    client: object,
) -> tuple[dict[str, str], dict[str, object]]:
    now = datetime.now(timezone.utc)
    current_start = now.year if now.month >= 4 else now.year - 1
    annual_pages = [financial_year_url(current_start), financial_year_url(current_start - 1)]
    monthly: dict[str, str] = {}
    ecds_monthly: dict[str, dict[str, str]] = defaultdict(dict)

    for page_index, page_url in enumerate(annual_pages):
        try:
            links = page_links(client, page_url)
        except (HTTPError, URLError, OSError) as exc:
            print(f"Warning: could not read {page_url}: {exc}", file=sys.stderr)
            continue
        for text, href in links:
            lowered = text.lower()
            period = parse_period(text)
            if (
                period
                and "monthly a&e" in lowered
                and "csv" in lowered
                and href.lower().split("?")[0].endswith(".csv")
            ):
                monthly.setdefault(period, href)
            if period:
                if "ecds activity" in lowered and href.lower().endswith(".xlsx"):
                    ecds_monthly[period].setdefault("activity", href)
                if "ecds performance" in lowered and href.lower().endswith(".xlsx"):
                    ecds_monthly[period].setdefault("performance", href)

    if not monthly:
        raise RuntimeError("No monthly A&E CSV publication links were found.")

    # NHS England publishes this file under a date-stamped URL. Discover the
    # current URL from the Acute Provider Table page, retaining a known-good
    # fallback in case the page is temporarily unavailable.
    acute_timeseries = ACUTE_TIMESERIES_URL
    try:
        for text, href in page_links(client, ACUTE_TABLE_PAGE):
            if (
                "acute provider timeseries" in text.lower()
                and href.lower().split("?")[0].endswith(".csv")
            ):
                acute_timeseries = href
                break
    except (HTTPError, URLError, OSError) as exc:
        print(f"Warning: could not read {ACUTE_TABLE_PAGE}: {exc}", file=sys.stderr)

    selected_months = sorted(monthly)[-15:]
    complete_ecds = {
        period: pair for period, pair in ecds_monthly.items()
        if pair.get("activity") and pair.get("performance")
    }
    selected_ecds = {
        period: complete_ecds[period] for period in sorted(complete_ecds)[-12:]
    }
    assets: dict[str, object] = {"ecds_monthly": selected_ecds}
    if selected_ecds:
        latest_ecds = selected_ecds[max(selected_ecds)]
        assets["ecds_activity"] = latest_ecds["activity"]
        assets["ecds_performance"] = latest_ecds["performance"]
    assets["publication_page"] = annual_pages[0]
    assets["acute_provider_timeseries"] = acute_timeseries
    return {period: monthly[period] for period in selected_months}, assets


def number(value: object) -> int:
    text = "" if value is None else str(value).strip().replace(",", "")
    if not text or text in {"-", "*", "**", "nan"}:
        return 0
    try:
        return int(round(float(text)))
    except ValueError:
        return 0


def decimal(value: object) -> float | None:
    text = "" if value is None else str(value).strip().replace(",", "")
    if not text or text in {"-", "*", "**", "nan"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def pct_within(attendances: int, over_limit: int) -> float | None:
    if attendances <= 0:
        return None
    return round(100 * (attendances - over_limit) / attendances, 1)


def clean_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def field(row: dict[str, str], *aliases: str) -> str:
    normalised = {clean_header(key): value for key, value in row.items() if key}
    for alias in aliases:
        if clean_header(alias) in normalised:
            return normalised[clean_header(alias)]
    return ""


def normalise_region(value: str) -> str:
    region = re.sub(r"^NHS ENGLAND\s+", "", value.strip(), flags=re.IGNORECASE)
    titled = region.title()
    return {
        "East Of England": "East of England",
        "North East And Yorkshire": "North East and Yorkshire",
    }.get(titled, titled)


def display_name(value: str) -> str:
    name = value.title().replace(" Nhs ", " NHS ").replace("Nhs ", "NHS ")
    return name.replace(" And ", " and ").replace(" Of ", " of ")


def process_monthly_csv(content: bytes, source_url: str) -> dict:
    reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig", errors="replace")))
    providers: list[dict] = []
    period = None

    for row in reader:
        if period is None:
            period = parse_period(
                field(row, "Period").replace("MSitAE-", "").replace("-", " ")
            )
        code = field(row, "Org Code").strip()
        name = field(row, "Org name").strip()
        if not code or not name or code.lower() == "total" or name.lower() == "total":
            continue

        type1 = number(field(row, "A&E attendances Type 1")) + number(
            field(row, "A&E attendances Booked Appointments Type 1")
        )
        type2 = number(field(row, "A&E attendances Type 2")) + number(
            field(row, "A&E attendances Booked Appointments Type 2")
        )
        utc = number(
            field(row, "A&E attendances Other A&E Department", "A&E attendances Other Department")
        ) + number(field(row, "A&E attendances Booked Appointments Other Department"))
        type1_over4 = number(field(row, "Attendances over 4hrs Type 1")) + number(
            field(row, "Attendances over 4hrs Booked Appointments Type 1")
        )
        type2_over4 = number(field(row, "Attendances over 4hrs Type 2")) + number(
            field(row, "Attendances over 4hrs Booked Appointments Type 2")
        )
        utc_over4 = number(field(row, "Attendances over 4hrs Other Department")) + number(
            field(row, "Attendances over 4hrs Booked Appointments Other Department")
        )
        combined = type1 + type2 + utc
        combined_over4 = type1_over4 + type2_over4 + utc_over4
        dta_4_12 = number(field(row, "Patients who have waited 4-12 hs from DTA to admission"))
        dta_12 = number(field(row, "Patients who have waited 12+ hrs from DTA to admission"))
        if combined <= 0 and dta_4_12 <= 0 and dta_12 <= 0:
            continue

        providers.append(
            {
                "code": code,
                "name": display_name(name),
                "region": normalise_region(field(row, "Parent Org")),
                "type1_attendances": type1,
                "type1_over4": type1_over4,
                "type1_within4_pct": pct_within(type1, type1_over4),
                "type2_attendances": type2,
                "type2_over4": type2_over4,
                "type2_within4_pct": pct_within(type2, type2_over4),
                "utc_attendances": utc,
                "utc_over4": utc_over4,
                "utc_within4_pct": pct_within(utc, utc_over4),
                "provider_combined_attendances": combined,
                "provider_combined_over4": combined_over4,
                "provider_combined_within4_pct": pct_within(combined, combined_over4),
                "dta_4_12": dta_4_12,
                "dta_12_plus": dta_12,
                "emergency_admissions_via_ed": number(field(row, "Emergency admissions via A&E - Type 1"))
                + number(field(row, "Emergency admissions via A&E - Type 2"))
                + number(field(row, "Emergency admissions via A&E - Other A&E department")),
            }
        )

    period = period or parse_period(source_url) or "unknown"
    sum_fields = [
        "type1_attendances", "type1_over4", "type2_attendances", "type2_over4",
        "utc_attendances", "utc_over4", "provider_combined_attendances",
        "provider_combined_over4", "dta_4_12", "dta_12_plus",
        "emergency_admissions_via_ed",
    ]
    national = {key: sum(provider[key] for provider in providers) for key in sum_fields}
    national["type1_within4_pct"] = pct_within(
        national["type1_attendances"], national["type1_over4"]
    )
    national["utc_within4_pct"] = pct_within(
        national["utc_attendances"], national["utc_over4"]
    )
    national["provider_combined_within4_pct"] = pct_within(
        national["provider_combined_attendances"], national["provider_combined_over4"]
    )
    return {"period": period, "source_url": source_url, "national": national, "providers": providers}


def process_acute_timeseries(content: bytes) -> tuple[dict[str, dict], list[dict]]:
    rows = csv.DictReader(io.StringIO(content.decode("utf-8-sig", errors="replace")))
    by_code: dict[str, dict[str, dict]] = defaultdict(dict)
    for row in rows:
        code = row.get("Provider.Code", "").strip()
        name = row.get("Provider.Name", "").strip()
        period = row.get("Date", "")[:7]
        metric_name = row.get("Metric.Name", "")
        value = decimal(row.get("Metric.Value"))
        if not code or not period or value is None:
            continue
        point = by_code[code].setdefault(period, {"period": period, "name": name})
        if metric_name == "A&E 4 hour performance":
            point["footprint_within4_pct"] = round(value * 100, 1)
        elif metric_name == "A&E 12 hour performance":
            point["footprint_over12_pct"] = round(value * 100, 1)
    latest = {code: periods[max(periods)] for code, periods in by_code.items()}
    england = by_code.get("Eng", {})
    return latest, [england[p] for p in sorted(england)]


def workbook_rows(content: bytes, sheet_name: str) -> list[tuple]:
    workbook = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    return list(workbook[sheet_name].iter_rows(min_row=16, values_only=True))


def keyed_sheet(rows: list[tuple]) -> dict[str, tuple]:
    return {
        str(row[3]).strip(): row
        for row in rows
        if len(row) > 3 and row[3] is not None
    }


def process_ecds(activity: bytes, performance: bytes) -> list[dict]:
    activity_rows = workbook_rows(activity, "Summary")
    provider_codes: dict[str, str] = {}
    for row in activity_rows:
        parent = str(row[1]).strip() if len(row) > 1 and row[1] else ""
        organisation = str(row[2]).strip() if len(row) > 2 and row[2] else ""
        code = str(row[3]).strip() if len(row) > 3 and row[3] else ""
        if parent and organisation.lower() == "total" and code:
            provider_codes[parent.lower()] = code

    four_hour = keyed_sheet(workbook_rows(performance, "4 Hour Performance"))
    twelve_hour = keyed_sheet(workbook_rows(performance, "12 Hour Performance"))
    paediatric = keyed_sheet(workbook_rows(performance, "Paediatric Performance"))
    sites: list[dict] = []
    for row in activity_rows:
        parent = str(row[1]).strip() if len(row) > 1 and row[1] else ""
        organisation = str(row[2]).strip() if len(row) > 2 and row[2] else ""
        code = str(row[3]).strip() if len(row) > 3 and row[3] else ""
        if not parent or not organisation or organisation.lower() == "total" or parent.lower() not in provider_codes:
            continue
        type12 = number(row[4])
        all_types = number(row[6])
        utc = max(all_types - type12, 0)
        if type12 > 0 and utc > 0:
            site_type = "Mixed ED/UTC"
        elif type12 > 0:
            site_type = "Type 1/2 ED"
        elif utc > 0:
            site_type = "UTC/Type 3"
        else:
            continue

        four = four_hour.get(code)
        twelve = twelve_hour.get(code)
        paeds = paediatric.get(code)
        sites.append(
            {
                "code": code,
                "name": organisation,
                "provider_code": provider_codes[parent.lower()],
                "provider_name": parent,
                "site_type": site_type,
                "type12_attendances": type12,
                "utc_attendances": utc,
                "all_attendances": all_types,
                "type12_admitted": number(row[5]),
                "all_admitted": number(row[7]),
                "type12_within4_pct": (
                    round(float(four[18]) * 100, 1)
                    if four and len(four) > 18 and decimal(four[18]) is not None else None
                ),
                "type12_over12": number(twelve[5]) if twelve else None,
                "type12_over12_pct": (
                    round(float(twelve[6]) * 100, 1)
                    if twelve and decimal(twelve[6]) is not None else None
                ),
                "all_over12": number(twelve[8]) if twelve else None,
                "all_over12_pct": (
                    round(float(twelve[9]) * 100, 1)
                    if twelve and decimal(twelve[9]) is not None else None
                ),
                "paediatric_type12_attendances": number(paeds[4]) if paeds else None,
                "paediatric_utc_attendances": number(paeds[5]) if paeds else None,
                "paediatric_type12_within4_pct": (
                    round(float(paeds[10]) * 100, 1)
                    if paeds and decimal(paeds[10]) is not None else None
                ),
                "paediatric_utc_within4_pct": (
                    round(float(paeds[11]) * 100, 1)
                    if paeds and decimal(paeds[11]) is not None else None
                ),
            }
        )
    return sites


def build() -> dict:
    client = object()
    monthly_links, assets = collect_publication_links(client)
    monthly_data = []
    for expected_period, url in monthly_links.items():
        print(f"Downloading monthly data: {expected_period}")
        monthly_data.append(process_monthly_csv(get(client, url).content, url))
    monthly_data.sort(key=lambda item: item["period"])
    latest_month = monthly_data[-1]

    print("Downloading acute provider time series")
    acute_timeseries_url = assets["acute_provider_timeseries"]
    footprint_latest, footprint_national = process_acute_timeseries(
        get(client, acute_timeseries_url).content
    )
    for provider in latest_month["providers"]:
        footprint = footprint_latest.get(provider["code"], {})
        provider["footprint_within4_pct"] = footprint.get("footprint_within4_pct")
        provider["footprint_over12_pct"] = footprint.get("footprint_over12_pct")

    provider_latest = {provider["code"]: provider for provider in latest_month["providers"]}
    site_snapshots: dict[str, list[dict]] = {}
    ecds_months = assets.get("ecds_monthly", {})
    if isinstance(ecds_months, dict):
        for period, pair in sorted(ecds_months.items()):
            print(f"Downloading ECDS site data: {period}")
            site_snapshots[period] = process_ecds(
                get(client, pair["activity"]).content,
                get(client, pair["performance"]).content,
            )

    sites = site_snapshots[max(site_snapshots)] if site_snapshots else []
    for site in sites:
        site["region"] = provider_latest.get(site["provider_code"], {}).get(
            "region", "Not mapped"
        )

    site_trends: dict[str, list[dict]] = defaultdict(list)
    for period, period_sites in sorted(site_snapshots.items()):
        for site in period_sites:
            if site["type12_attendances"] <= 0:
                continue
            site_trends[site["code"]].append(
                {
                    "period": period,
                    "type12_attendances": site["type12_attendances"],
                    "type12_within4_pct": site["type12_within4_pct"],
                    "type12_over12": site["type12_over12"],
                    "type12_over12_pct": site["type12_over12_pct"],
                    "paediatric_type12_within4_pct": site["paediatric_type12_within4_pct"],
                }
            )

    provider_trends: dict[str, list[dict]] = defaultdict(list)
    for month in monthly_data:
        for provider in month["providers"]:
            provider_trends[provider["code"]].append(
                {
                    "period": month["period"],
                    "type1_attendances": provider["type1_attendances"],
                    "type1_within4_pct": provider["type1_within4_pct"],
                    "utc_attendances": provider["utc_attendances"],
                    "utc_within4_pct": provider["utc_within4_pct"],
                    "provider_combined_within4_pct": provider["provider_combined_within4_pct"],
                }
            )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "latest_period": latest_month["period"],
        "latest_period_display": datetime.strptime(latest_month["period"], "%Y-%m").strftime("%B %Y"),
        "sources": {
            "publication_page": assets.get("publication_page"),
            "latest_monthly_csv": latest_month["source_url"],
            "acute_provider_timeseries": acute_timeseries_url,
            "ecds_activity": assets.get("ecds_activity"),
            "ecds_performance": assets.get("ecds_performance"),
        },
        "national": latest_month["national"],
        "national_trend": [
            {"period": month["period"], **month["national"]} for month in monthly_data
        ],
        "footprint_national_trend": footprint_national,
        "providers": latest_month["providers"],
        "provider_trends": provider_trends,
        "sites": sites,
        "site_trends": site_trends,
        "definitions": {
            "type1": "Major 24-hour consultant-led emergency department.",
            "utc": "Other A&E Department activity, including Type 3 urgent treatment services.",
            "provider_combined": "Type 1, Type 2 and Other A&E activity reported under the provider code.",
            "footprint": "Official NHS England acute-trust-footprint metric; from April 2026 this may include attributed Type 3 activity.",
        },
    }


def main() -> None:
    data = build()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    # Keep scheduled runs quiet when NHS England has not changed any data.
    # If the snapshot is identical apart from its build time, retain the
    # previous timestamp so GitHub Actions has nothing new to commit.
    if OUTPUT.exists():
        try:
            existing = json.loads(OUTPUT.read_text(encoding="utf-8"))
            comparable_existing = {key: value for key, value in existing.items() if key != "generated_at"}
            comparable_new = {key: value for key, value in data.items() if key != "generated_at"}
            if comparable_existing == comparable_new:
                data["generated_at"] = existing.get("generated_at", data["generated_at"])
        except (json.JSONDecodeError, OSError):
            pass

    OUTPUT.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUTPUT} for {data['latest_period_display']} "
        f"({len(data['providers'])} providers, {len(data['sites'])} sites)."
    )


if __name__ == "__main__":
    main()
