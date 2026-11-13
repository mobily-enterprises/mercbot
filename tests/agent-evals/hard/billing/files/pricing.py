FLAT_RATE = 0.10
TIERS = [(1000, 0.10), (5000, 0.08), (None, 0.05)]


def price(plan, units):
    if plan == "flat":
        return units * FLAT_RATE
    total = 0
    previous = 0
    for limit, rate in TIERS:
        if limit is None:
            total += max(0, units - previous) * rate
        else:
            total += max(0, min(units, limit) - previous) * rate
            previous = 1000
    return total
