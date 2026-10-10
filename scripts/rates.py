"""Historical exchange-rate lookup shared by snapshot creation flows."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import date


API_URL = "https://api.frankfurter.dev/v2/rates"


def fetch_historical_rates(snapshot_date: str) -> dict:
    """Return USD/HKD to CNY rates for the requested date and source metadata."""
    requested_date = date.fromisoformat(snapshot_date)
    query = urllib.parse.urlencode({
        "date": requested_date.isoformat(),
        "base": "USD",
        "quotes": "CNY,HKD",
    })
    request = urllib.request.Request(
        f"{API_URL}?{query}", headers={"User-Agent": "ai-finance-dashboard/1.0"}
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        rows = json.load(response)

    rates_by_quote = {}
    rate_dates = set()
    for row in rows:
        quote = row.get("quote")
        if quote in {"CNY", "HKD"}:
            rates_by_quote[quote] = float(row["rate"])
            rate_dates.add(row["date"])
    if "CNY" not in rates_by_quote or "HKD" not in rates_by_quote:
        raise ValueError(f"Frankfurter 未返回 {snapshot_date} 所需的 CNY/HKD 汇率")
    if len(rate_dates) != 1:
        raise ValueError(f"Frankfurter 返回的汇率日期不一致: {sorted(rate_dates)}")

    actual_date = next(iter(rate_dates))
    rates = {
        "USD": round(rates_by_quote["CNY"], 4),
        "HKD": round(rates_by_quote["CNY"] / rates_by_quote["HKD"], 4),
    }
    source = f"Frankfurter API ({actual_date}; requested {requested_date.isoformat()})"
    return {"rates": rates, "date": actual_date, "source": source}
