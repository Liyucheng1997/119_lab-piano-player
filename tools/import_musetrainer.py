#!/usr/bin/env python3
"""Import MuseTrainer library scores as static website samples."""

from __future__ import annotations

import argparse
import json
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
import xml.etree.ElementTree as ET


MUSICXML_MIME_TYPE = "application/vnd.recordare.musicxml+xml"


def url_for_relative_path(path_value: str) -> str:
    return "musetrainer/" + "/".join(quote(part, safe="-_.~") for part in path_value.split("/"))


def title_from_filename(path: Path) -> str:
    return path.stem.replace("_", " ").strip()


def musicxml_from_mxl(path: Path) -> ET.Element:
    with zipfile.ZipFile(path) as zf:
        root_path = None
        if "META-INF/container.xml" in zf.namelist():
            container = ET.fromstring(zf.read("META-INF/container.xml"))
            for rootfile in container.findall(".//{*}rootfile"):
                media_type = rootfile.attrib.get("media-type")
                full_path = rootfile.attrib.get("full-path")
                if full_path and (media_type in (None, MUSICXML_MIME_TYPE)):
                    root_path = full_path
                    break
        if not root_path:
            root_path = next(
                (
                    name
                    for name in zf.namelist()
                    if not name.startswith("META-INF/") and name.lower().endswith((".xml", ".musicxml"))
                ),
                None,
            )
        if not root_path:
            raise ValueError(f"No MusicXML root file found in {path}")
        return ET.fromstring(zf.read(root_path))


def text_at(root: ET.Element, path: str) -> str:
    el = root.find(path)
    return (el.text or "").strip() if el is not None and el.text else ""


def title_from_score(path: Path) -> str:
    try:
        root = musicxml_from_mxl(path)
    except Exception:
        return title_from_filename(path)
    return (
        text_at(root, "work/work-title")
        or text_at(root, "movement-title")
        or title_from_filename(path)
    )


def unique_title(title: str, seen: set[str]) -> str:
    if title not in seen:
        seen.add(title)
        return title
    base = title
    count = 2
    while title in seen:
        title = f"{base} ({count})"
        count += 1
    seen.add(title)
    return title


def import_musetrainer(source_root: Path, public_root: Path) -> dict:
    source_root = source_root.resolve()
    scores_root = source_root / "scores"
    if not scores_root.exists():
        raise FileNotFoundError(f"scores directory not found under {source_root}")

    output_root = (public_root / "musetrainer").resolve()
    output_scores_root = output_root / "scores"
    output_scores_root.mkdir(parents=True, exist_ok=True)

    works: list[dict] = []
    seen_titles: set[str] = set()
    for src in sorted(scores_root.glob("*.mxl"), key=lambda p: p.name.casefold()):
        rel = "scores/" + src.name
        dest = output_root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        title = unique_title(title_from_score(src), seen_titles)
        works.append(
            {
                "id": src.stem,
                "title": title,
                "authors": "",
                "type": "mxl",
                "url": url_for_relative_path(rel),
                "sourcePath": rel,
            }
        )

    works.sort(key=lambda item: item["title"].casefold())

    readme = source_root / "README.md"
    if readme.exists():
        shutil.copy2(readme, output_root / "README.md")

    manifest = {
        "source": "MuseTrainer Library",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "count": len(works),
        "works": works,
    }
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Import MuseTrainer library into public/musetrainer")
    parser.add_argument("source", type=Path, help="Path to the MuseTrainer library repository")
    parser.add_argument(
        "--public-root",
        type=Path,
        default=Path("public"),
        help="Project public directory",
    )
    args = parser.parse_args()

    manifest = import_musetrainer(args.source, args.public_root)
    print(f"Imported {manifest['count']} MuseTrainer scores")


if __name__ == "__main__":
    main()
