#!/usr/bin/env python3
"""Import OpenEWLD .mxl files as static website samples.

The browser cannot read SQLite directly in this zero-dependency demo, so this
script keeps the original database alongside a generated JSON manifest and
copies only the score files needed by the player.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


def git_quote_non_ascii(value: str) -> str:
    parts: list[str] = []
    for ch in value:
        if ord(ch) < 128:
            parts.append(ch)
        else:
            parts.extend(f"\\{byte:03o}" for byte in ch.encode("utf-8"))
    return "".join(parts)


def read_mapping(source_root: Path) -> dict[str, str]:
    mapping_path = source_root / "OpenEWLD_windows_path_mapping.tsv"
    if not mapping_path.exists():
        return {}

    mapping: dict[str, str] = {}
    with mapping_path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh, delimiter="\t")
        next(reader, None)
        for row in reader:
            if len(row) >= 2:
                mapping[row[0]] = row[1]
    return mapping


def url_for_relative_path(path_value: str) -> str:
    return "openewld/" + "/".join(quote(part, safe="-_.~") for part in path_value.split("/"))


def normalize_rel(path_value: str) -> str:
    return path_value.replace("\\", "/")


def resolve_score_path(source_root: Path, db_path: str, mapping: dict[str, str]) -> str | None:
    candidates = [
        db_path,
        mapping.get(db_path),
        mapping.get(git_quote_non_ascii(db_path)),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        candidate = normalize_rel(candidate)
        if (source_root / candidate).exists():
            return candidate
    return None


def load_works(db_path: Path) -> list[dict]:
    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row
    query = """
        select
            w.id,
            w.title,
            w.first_performance_date,
            w.language,
            w.path_leadsheet,
            (select group_concat(author, '; ') from work_author where id = w.id) as authors,
            (select group_concat(genre, '; ') from work_genres where id = w.id) as genres,
            (select group_concat(style, '; ') from work_style where id = w.id) as styles,
            f.metric,
            f.tonality
        from works w
        left join features f on f.id = w.id
        where w.path_leadsheet like '%.mxl'
        order by lower(w.title), w.id
    """
    rows = [dict(row) for row in con.execute(query)]
    con.close()
    return rows


def import_openewld(source_root: Path, public_root: Path) -> dict:
    source_root = source_root.resolve()
    output_root = (public_root / "openewld").resolve()
    output_root.mkdir(parents=True, exist_ok=True)

    db_path = source_root / "OpenEWLD.db"
    if not db_path.exists():
        raise FileNotFoundError(f"OpenEWLD.db not found under {source_root}")

    mapping = read_mapping(source_root)
    works = load_works(db_path)

    imported: list[dict] = []
    missing: list[dict] = []
    seen_paths: set[str] = set()

    for work in works:
        db_score_path = normalize_rel(work["path_leadsheet"])
        local_score_path = resolve_score_path(source_root, db_score_path, mapping)
        if not local_score_path:
            missing.append({"id": work["id"], "title": work["title"], "path": db_score_path})
            continue

        if local_score_path in seen_paths:
            continue
        seen_paths.add(local_score_path)

        src = source_root / local_score_path
        dest = output_root / local_score_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)

        imported.append(
            {
                "id": work["id"],
                "title": work["title"] or Path(local_score_path).stem,
                "authors": work["authors"] or "",
                "metric": work["metric"] or "",
                "tonality": work["tonality"] or "",
                "genres": work["genres"] or "",
                "styles": work["styles"] or "",
                "firstPerformanceDate": work["first_performance_date"] or "",
                "language": work["language"] or "",
                "type": "mxl",
                "url": url_for_relative_path(local_score_path),
                "sourcePath": db_score_path,
                "localPath": local_score_path,
            }
        )

    imported.sort(key=lambda item: (item["title"].casefold(), item["authors"].casefold(), item["id"]))

    for aux_name in ["OpenEWLD.db", "LICENSE"]:
        aux_src = source_root / aux_name
        if aux_src.exists():
            shutil.copy2(aux_src, output_root / aux_name)

    manifest = {
        "source": "OpenEWLD",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "count": len(imported),
        "missingCount": len(missing),
        "works": imported,
    }
    (output_root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (output_root / "missing.json").write_text(
        json.dumps(missing, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Import OpenEWLD into public/openewld")
    parser.add_argument("source", type=Path, help="Path to the OpenEWLD repository")
    parser.add_argument(
        "--public-root",
        type=Path,
        default=Path("public"),
        help="Project public directory",
    )
    args = parser.parse_args()

    manifest = import_openewld(args.source, args.public_root)
    print(f"Imported {manifest['count']} OpenEWLD scores")
    print(f"Missing score files: {manifest['missingCount']}")


if __name__ == "__main__":
    main()
