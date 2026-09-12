#!/usr/bin/env python3
"""公開した変更が端末のキャッシュに邪魔されないよう、版番号を更新する。

使い方:  python3 tools/bump_version.py

index.html・js/*.js の `?v=...`、js/config.js の APP_VERSION、
そして version.json を、今日の日付ベースの新しい番号にまとめて書き換えます。
（version.json は、開いたままのアプリに「新しい版が出た」と知らせるために使います）
"""
import datetime
import json
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


def bump_suffix(version: str) -> str:
    """末尾の a -> b -> c ... を1つ進める"""
    base, suffix = version[:-1], version[-1]
    return base + (chr(ord(suffix) + 1) if suffix.isalpha() and suffix < "z" else "a")


def next_version(old: str) -> str:
    candidate = datetime.date.today().isoformat() + "a"   # 2026-08-27a
    # 番号が前に戻ると、古いファイルがキャッシュから使われてしまうので必ず増やす
    return candidate if candidate > old else bump_suffix(old)


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
    (ROOT / "version.json").write_text(json.dumps({"version": new}, indent=2) + "\n",
                                       encoding="utf-8")
    print("  - version.json")
    print(f"版番号: {old} -> {new}")


if __name__ == "__main__":
    main()
