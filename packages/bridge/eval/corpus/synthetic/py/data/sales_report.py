"""월별 매출 집계 리포트."""

from collections import defaultdict
from typing import Iterable


def aggregate_sales(rows: Iterable[dict]) -> dict[str, int]:
    """(지점, 월) 기준으로 매출 합계를 낸다.

    rows의 각 항목은 {"branch": str, "month": "YYYY-MM", "amount": int} 형태다.
    """
    totals: dict[str, int] = defaultdict(int)
    for row in rows:
        key = f"{row['branch']}:{row['month']}"
        totals[key] += int(row["amount"])
    return dict(totals)


def top_branches(totals: dict[str, int], n: int = 3) -> list[tuple[str, int]]:
    """지점별 합계를 모아 매출이 큰 순서로 n개를 돌려준다."""
    by_branch: dict[str, int] = defaultdict(int)
    for key, amount in totals.items():
        branch = key.split(":", 1)[0]
        by_branch[branch] += amount
    return sorted(by_branch.items(), key=lambda kv: kv[1], reverse=True)[:n]
