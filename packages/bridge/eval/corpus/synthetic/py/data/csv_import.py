"""고객 CSV 가져오기."""

import csv
from pathlib import Path


def load_csv(path: Path) -> list[dict[str, str]]:
    """CSV를 읽어 행마다 사전으로 돌려준다.

    엑셀이 저장한 BOM이 붙은 파일도 깨지지 않도록 utf-8-sig 인코딩으로 연다.
    헤더 공백은 제거하고, 완전히 빈 줄은 건너뛴다.
    """
    rows: list[dict[str, str]] = []
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        for raw in reader:
            row = {(k or "").strip(): (v or "").strip() for k, v in raw.items()}
            if any(row.values()):
                rows.append(row)
    return rows
