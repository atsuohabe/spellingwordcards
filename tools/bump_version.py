#!/usr/bin/env python3
"""公開した変更が iPhone のキャッシュに邪魔されないよう、版番号を更新する。

使い方:  python3 tools/bump_version.py

index.html・js/*.js の `?v=...` と js/config.js の APP_VERSION を、
今日の日付ベースの新しい番号にまとめて書き換えます。
（画面の下に出る番号が変われば、新しい版が読み込まれた証拠になります）
"""
import datetime
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGETS = [ROOT / "index.html", *sorted((ROOT / "js").glob("*.js"))]
VERSION_RE = re.compile(r"APP_VERSION = '([^']+)'")


def current_version() -> str:
    found = VERSION_RE.search((ROOT / "js" / "config.js").read_text(encoding="utf-8"))
    if not found:
        sys.exit("js/config.js に APP_VERSION が見つかりません")
    return found.group(1)


def next_version(old: str) -> str:
    today = datetime.date.today().isoformat()          # 2026-08-27
    if old.startswith(today):
        suffix = old[len(today):] or "a"
        return today + chr(ord(suffix[-1]) + 1)        # a -> b -> c ...
    return today + "a"


def main() -> None:
    old = current_version()
    new = sys.argv[1] if len(sys.argv) > 1 else next_version(old)
    if new == old:
        sys.exit(f"版番号が変わりません（{old}）")

    for path in TARGETS:
        text = path.read_text(encoding="utf-8")
        if old not in text:
            continue
        path.write_text(text.replace(old, new), encoding="utf-8")
        print(f"  - {path.relative_to(ROOT)}")
    print(f"版番号: {old} -> {new}")


if __name__ == "__main__":
    main()
