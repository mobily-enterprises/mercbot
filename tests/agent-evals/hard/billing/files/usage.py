import calendar
from datetime import date


def load_usage(path):
    rows = []
    with open(path) as handle:
        next(handle)
        for line in handle:
            customer, day, units = line.strip().split(",")[:3]
            rows.append({"customer": customer, "date": day, "units": int(units.strip('"'))})
    return rows


def in_month(day, month):
    year, number = (int(part) for part in month.split("-"))
    start = date(year, number, 1)
    end = date(year, number, calendar.monthrange(year, number)[1])
    return start <= date.fromisoformat(day) < end
