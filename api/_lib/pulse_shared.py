"""Shared theme logic for the GROWW Weekly Review Pulse (Python side).

Single source of truth for the 5-theme legend, rule classification and
exact-substring quote extraction so scripts 4 and 5 never drift apart.
"""

import re

THEMES = [
    ("App Stability", ['crash', 'freezing', 'lag', 'hang', 'slow', 'bug', 'glitch', 'stuck', 'error', 'not opening', 'closes', 'closes', 'loading', 'stucks', 'screen', 'performance', 'update broke', 'after update', 'battery', 'latency', 'delay', 'timeout', 'blank', 'not loading', 'unresponsive', 'keeps stopping']),
    ("Order Execution", ['order', 'buy', 'sell', 'share', 'trade', 'execution', 'limit order', 'market order', 'pending', 'not executed', 'rejected', 'slippage', 'position', 'intraday', 'delivery', 'blocked order', 'qty', 'lot', 'stoploss', 'bracket', 'unfilled', 'failed order', 'order failed']),
    ("Withdrawals & Funds", ['withdraw', 'withdrawal', 'money', 'fund', 'amount', 'deposit', 'bank', 'transfer', 'upi', 'settlement', 'credit', 'refund', 'not credited', 'deduction', 'charges cut', 'wallet', 'balance', 'pending withdrawal', 'money stuck', 'nfss']),
    ("Customer Support", ['support', 'customer care', 'service', 'response', 'call', 'email', 'contact', 'complaint', 'agent', 'follow up', 'pending complaint', 'chatbot', 'help', 'not responding', 'no reply', 'unhelpful']),
    ("Account & Security", ['login', 'account', 'password', 'otp', 'authentication', 'banned', 'blocked account', 'security', 'verification', 'profile', 'pan', 'email change', 'phone change', 'closed account', 'access', 'sign in', '2fa', 'suspended', 'deactivated']),
]

THEME_NAMES = [t[0] for t in THEMES]

PII_PROBE = re.compile(
    r"[\w.+-]+@[\w-]+(\.[\w-]+)+"
    r"|(?<!\d)\d{9,}(?!\d)"
    r"|\+?\d[\d\s().-]{8,}\d"
    r"|@\w{2,}"
)


def rule_classify(title, text):
    blob = f"{title or ''} {text or ''}".lower()
    tokens = re.findall(r"[a-z0-9]+", blob)
    best = ("Unclassified", 0)
    for name, kws in THEMES:
        score = 0
        for kw in kws:
            for tok in tokens:
                if len(tok) >= len(kw) and tok.startswith(kw) and len(tok) <= len(kw) + 4:
                    score += 1
                    break
        if score > best[1]:
            best = (name, score)
    return best[0]


def theme_stats(rows):
    stats = {name: {"count": 0, "sum": 0} for name, _ in THEMES}
    unclassified = 0
    for r in rows:
        theme = r["_theme"]
        if theme in stats:
            stats[theme]["count"] += 1
            stats[theme]["sum"] += int(r["rating"])
        else:
            unclassified += 1
    out = []
    for name, st in stats.items():
        if st["count"]:
            avg = st["sum"] / st["count"]
            out.append({
                "theme": name,
                "count": st["count"],
                "avg_rating": round(avg, 2),
                "priority_score": round(st["count"] * (6 - avg), 1),
            })
    out.sort(key=lambda x: x["priority_score"], reverse=True)
    for i, row in enumerate(out):
        row["rank"] = i + 1
    return out, unclassified


def sentence(s):
    """Ensure a phrase ends with exactly one period (never double-punctuates)."""
    s = str(s or "").strip()
    s = re.sub(r"[.\s]+$", "", s)
    return s + "." if s else ""


def coverage_footer(total, unclassified):
    """One disclosable line describing classification coverage (single source of truth)."""
    classified = total - unclassified
    return (
        f"Signal basis: themes drawn from {classified} of {total} reviews; "
        f"{unclassified} no-signal reviews (largely one-line praise) sit outside the legend."
    )


def exact_quote(text, title):
    source = title or text or ""
    if not source:
        return ""
    if len(text or "") >= 40:
        source = text
    q = source
    if len(q) > 180:
        cut = q[:160]
        sp = cut.rfind(" ")
        if sp > 80:
            cut = cut[:sp]
        q = cut
    return " ".join(q.split())