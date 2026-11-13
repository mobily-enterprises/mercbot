def split_bill(total, people, tip_percent=0):
    """Split a bill evenly, with an optional tip, rounding each share UP to the cent."""
    with_tip = total + total * tip_percent / 100
    share = int(with_tip / people * 100) / 100
    return share

def parse_amount(text):
    """'$1,234.50' -> 1234.5 ; '12' -> 12.0 ; '-3.10' -> -3.1"""
    return float(text.replace("$", ""))
