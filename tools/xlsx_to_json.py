#!/usr/bin/env python3
"""マスタの .xlsx を、アプリが読む data/*.json に変換する。

使い方:  python3 tools/xlsx_to_json.py

追加のライブラリは不要（Python標準ライブラリのみ）。
GitHub Actions から自動実行されるので、通常は手で動かす必要はありません。
"""
from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
PREFERRED_XLSX = "spellingwordcards.xlsx"

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

WORD_KEYS = {"word", "words", "english", "spelling", "eng", "英語", "えいご", "たんご", "単語", "スペル"}
JA_KEYS = {"ja", "japanese", "jp", "translation", "meaning", "mean",
           "日本語", "にほんご", "訳", "やく", "いみ", "意味", "ほんやく", "翻訳"}
EXCLUDE_SHEETS = {"設定", "config", "readme", "sheet1"}

ENGLISH_RE = re.compile(r"^[A-Za-z][A-Za-z'’\- ]*$")
JAPANESE_RE = re.compile(r"[぀-ヿ一-鿿]")


def find_master() -> Path:
    preferred = ROOT / PREFERRED_XLSX
    if preferred.exists():
        return preferred
    candidates = sorted(p for p in ROOT.glob("*.xlsx") if not p.name.startswith("~$"))
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        sys.exit(f"マスタが見つかりません。{PREFERRED_XLSX} をリポジトリ直下に置いてください。")
    names = ", ".join(p.name for p in candidates)
    sys.exit(f"xlsxが複数あります（{names}）。マスタは {PREFERRED_XLSX} という名前にしてください。")


def column_index(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group():
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_sheets(path: Path) -> list[tuple[str, list[list[str]]]]:
    """[(シート名, 行列), ...] を、ブックに並んでいる順で返す。非表示シートは除く。"""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            shared = ["".join(t.text or "" for t in si.iter(NS + "t")) for si in root.iter(NS + "si")]

        rels = {r.get("Id"): r.get("Target")
                for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
        workbook = ET.fromstring(z.read("xl/workbook.xml"))

        out = []
        for sheet in workbook.iter(NS + "sheet"):
            if sheet.get("state") in ("hidden", "veryHidden"):
                continue
            target = rels[sheet.get(REL + "id")].lstrip("/")
            member = target if target.startswith("xl/") else "xl/" + target
            out.append((sheet.get("name"), read_rows(ET.fromstring(z.read(member)), shared)))
        return out


def read_rows(worksheet: ET.Element, shared: list[str]) -> list[list[str]]:
    rows = []
    for row in worksheet.iter(NS + "row"):
        cells: dict[int, str] = {}
        for cell in row.iter(NS + "c"):
            kind = cell.get("t")
            value = ""
            if kind == "inlineStr":
                inline = cell.find(NS + "is")
                value = "".join(t.text or "" for t in inline.iter(NS + "t")) if inline is not None else ""
            else:
                v = cell.find(NS + "v")
                if v is not None and v.text is not None:
                    value = shared[int(v.text)] if kind == "s" else v.text
            cells[column_index(cell.get("r"))] = value.strip()
        rows.append([cells.get(i, "") for i in range(max(cells) + 1)] if cells else [])
    return rows


def ratio(rows: list[list[str]], index: int, test) -> float:
    values = [r[index] for r in rows if index < len(r) and r[index]]
    return len([v for v in values if test(v)]) / len(values) if values else 0.0


def detect_columns(header: list[str], rows: list[list[str]]) -> tuple[int, int]:
    """(英語列, 日本語列) を返す。日本語列が無ければ -1。"""
    norm = [h.strip().lower() for h in header]
    word = next((i for i, h in enumerate(norm) if h in WORD_KEYS), -1)
    ja = next((i for i, h in enumerate(norm) if h in JA_KEYS), -1)
    width = max([len(header)] + [len(r) for r in rows] or [0])

    if word < 0:
        scores = [(ratio(rows, i, lambda v: bool(ENGLISH_RE.match(v))), i)
                  for i in range(width) if i != ja]
        best, index = max(scores, default=(0.0, 0))
        word = index if best >= 0.5 else 0
    if ja < 0:
        scores = [(ratio(rows, i, lambda v: bool(JAPANESE_RE.search(v))), i)
                  for i in range(width) if i != word]
        best, index = max(scores, default=(0.0, -1))
        ja = index if best >= 0.5 else -1
    return word, ja


def to_cards(rows: list[list[str]]) -> list[dict[str, str]]:
    rows = [r for r in rows if any(r)]
    if not rows:
        return []
    header = rows[0]
    has_header = any(h.strip().lower() in WORD_KEYS | JA_KEYS for h in header)
    body = rows[1:] if has_header else rows
    word_col, ja_col = detect_columns(header if has_header else [], body)

    cards, seen = [], set()
    for row in body:
        word = row[word_col] if word_col < len(row) else ""
        if not word or word.lower() in seen:
            continue
        seen.add(word.lower())
        ja = row[ja_col] if 0 <= ja_col < len(row) else ""
        cards.append({"word": word, "ja": ja})
    return cards


def make_id(name: str, used: set[str], position: int) -> str:
    """シート名からファイル名用のIDを作る（Vol.1 -> vol1、第3週 -> sheet3）。"""
    base = re.sub(r"[^a-z0-9]+", "", name.lower())
    if not re.search(r"[a-z]", base):
        digits = re.sub(r"[^0-9]", "", base)
        base = f"sheet{digits}" if digits else f"sheet{position}"
    candidate, suffix = base, 2
    while candidate in used:
        candidate, suffix = f"{base}-{suffix}", suffix + 1
    used.add(candidate)
    return candidate


def main() -> None:
    master = find_master()
    DATA_DIR.mkdir(exist_ok=True)

    index, used, written = [], set(), set()
    for position, (name, rows) in enumerate(read_sheets(master), start=1):
        if name.strip().lower() in EXCLUDE_SHEETS:
            print(f"  - {name}: 除外リストのためスキップ")
            continue
        cards = to_cards(rows)
        if not cards:
            print(f"  - {name}: 単語が見つからないためスキップ")
            continue
        sheet_id = make_id(name, used, position)
        path = DATA_DIR / f"{sheet_id}.json"
        path.write_text(json.dumps({"cards": cards}, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
        written.add(path.name)
        index.append({"id": sheet_id, "name": name})
        print(f"  - {name}: {len(cards)} 語 -> data/{path.name}")

    if not index:
        sys.exit(f"{master.name} から単語を読み取れませんでした。1行目のヘッダーと中身を確認してください。")

    (DATA_DIR / "index.json").write_text(
        json.dumps({"sheets": index}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    written.add("index.json")

    for stale in DATA_DIR.glob("*.json"):     # 消えた/名前が変わったシートの残骸を掃除
        if stale.name not in written:
            stale.unlink()
            print(f"  - 不要になった data/{stale.name} を削除")

    print(f"{master.name}: {len(index)} シート / 合計 {sum(len(json.loads((DATA_DIR / (s['id'] + '.json')).read_text(encoding='utf-8'))['cards']) for s in index)} 語")


if __name__ == "__main__":
    main()
