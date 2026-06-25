#!/usr/bin/env python3
"""Generate a Markdown catalog for the bundled score libraries."""

from __future__ import annotations

import json
import zipfile
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
OUTPUT = ROOT / "docs" / "library-catalog.md"


def md_escape(value: object) -> str:
    if value is None:
        return ""
    text = str(value).replace("\r", " ").replace("\n", " ").strip()
    text = " ".join(text.split())
    return text.replace("|", "\\|")


def row(values: list[object]) -> str:
    return "| " + " | ".join(md_escape(value) for value in values) + " |"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def children_named(node: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in list(node) if local_name(child.tag) == name]


def child_text(node: ET.Element, path: str) -> str:
    current = node
    for part in path.split("/"):
        found = next((child for child in list(current) if local_name(child.tag) == part), None)
        if found is None:
            return ""
        current = found
    return (current.text or "").strip()


def find_rootfile_from_container(container_xml: bytes) -> str:
    container = ET.fromstring(container_xml)
    for elem in container.iter():
        if local_name(elem.tag) == "rootfile":
            full_path = elem.attrib.get("full-path")
            if full_path:
                return full_path
    return ""


def read_musicxml_root(score_path: Path) -> tuple[ET.Element | None, str]:
    try:
        with zipfile.ZipFile(score_path) as zf:
            names = zf.namelist()
            rootfile = ""
            if "META-INF/container.xml" in names:
                try:
                    rootfile = find_rootfile_from_container(zf.read("META-INF/container.xml"))
                except ET.ParseError:
                    # Some OpenEWLD archives contain unescaped quotes in container.xml.
                    rootfile = ""
            if not rootfile:
                rootfile = next(
                    (
                        name
                        for name in names
                        if not name.startswith("META-INF/") and name.lower().endswith((".xml", ".musicxml"))
                    ),
                    "",
                )
            if not rootfile:
                return None, "MXL 内未找到 MusicXML rootfile"
            return ET.fromstring(zf.read(rootfile)), ""
    except Exception as exc:  # noqa: BLE001 - catalog generation should keep going.
        return None, f"{type(exc).__name__}: {exc}"


def score_metadata(public_url: str) -> dict[str, object]:
    score_path = PUBLIC / unquote(public_url)
    root, error = read_musicxml_root(score_path)
    if root is None:
        return {
            "xml_title": "",
            "movement_title": "",
            "creators": "",
            "rights": "",
            "parts": "",
            "part_count": "",
            "max_staves": "",
            "measure_count": "",
            "parse_note": error,
        }

    creators: list[str] = []
    rights: list[str] = []
    for elem in root.iter():
        name = local_name(elem.tag)
        text = (elem.text or "").strip()
        if not text:
            continue
        if name == "creator":
            creator_type = elem.attrib.get("type")
            creators.append(f"{creator_type}: {text}" if creator_type else text)
        elif name == "rights":
            rights.append(text)

    part_names: list[str] = []
    part_list = next((elem for elem in root.iter() if local_name(elem.tag) == "part-list"), None)
    if part_list is not None:
        for score_part in children_named(part_list, "score-part"):
            part_name = child_text(score_part, "part-name")
            if part_name:
                part_names.append(part_name)

    parts = children_named(root, "part")
    max_staves = 1
    measure_count = 0
    for part in parts:
        measures = children_named(part, "measure")
        measure_count = max(measure_count, len(measures))
        for staves in part.iter():
            if local_name(staves.tag) == "staves" and staves.text:
                try:
                    max_staves = max(max_staves, int(staves.text.strip()))
                except ValueError:
                    pass

    return {
        "xml_title": child_text(root, "work/work-title"),
        "movement_title": child_text(root, "movement-title"),
        "creators": "; ".join(dict.fromkeys(creators)),
        "rights": "; ".join(dict.fromkeys(rights)),
        "parts": "; ".join(part_names),
        "part_count": len(parts),
        "max_staves": max_staves,
        "measure_count": measure_count,
        "parse_note": "",
    }


def load_manifest(name: str) -> dict:
    return json.loads((PUBLIC / name / "manifest.json").read_text(encoding="utf-8"))


def openewld_rows(manifest: dict) -> list[str]:
    rows: list[str] = []
    for index, item in enumerate(manifest.get("works", []), 1):
        meta = score_metadata(item.get("url", ""))
        rows.append(
            row(
                [
                    index,
                    item.get("id", ""),
                    item.get("title", ""),
                    item.get("authors", ""),
                    item.get("metric", ""),
                    item.get("tonality", ""),
                    item.get("genres", ""),
                    item.get("styles", ""),
                    item.get("language", ""),
                    item.get("firstPerformanceDate", ""),
                    meta["part_count"],
                    meta["max_staves"],
                    meta["measure_count"],
                    item.get("url", ""),
                    item.get("sourcePath", ""),
                ]
            )
        )
    return rows


def musetrainer_rows(manifest: dict) -> list[str]:
    rows: list[str] = []
    for index, item in enumerate(manifest.get("works", []), 1):
        meta = score_metadata(item.get("url", ""))
        rows.append(
            row(
                [
                    index,
                    item.get("id", ""),
                    item.get("title", ""),
                    meta["xml_title"] or meta["movement_title"],
                    meta["creators"],
                    meta["parts"],
                    meta["part_count"],
                    meta["max_staves"],
                    meta["measure_count"],
                    item.get("url", ""),
                    item.get("sourcePath", ""),
                ]
            )
        )
    return rows


def build_catalog() -> str:
    openewld = load_manifest("openewld")
    musetrainer = load_manifest("musetrainer")
    openewld_count = len(openewld.get("works", []))
    musetrainer_count = len(musetrainer.get("works", []))

    lines = [
        "# 乐谱曲库详细信息清单",
        "",
        f"- 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- OpenEWLD: {openewld.get('count', openewld_count)} 首",
        f"- MuseTrainer: {musetrainer.get('count', musetrainer_count)} 首",
        f"- 合计: {openewld_count + musetrainer_count} 首",
        "",
        "说明: `.mxl` 是压缩 MusicXML；下表中的“声部数 / 最大谱表数 / 小节数”来自实际 `.mxl` 内部 MusicXML 解析。",
        "",
        "## OpenEWLD",
        "",
        row(["序号", "ID", "曲名", "作者", "拍号", "调性", "类型", "风格", "语言", "首演日期", "声部数", "最大谱表数", "小节数", "网站路径", "源路径"]),
        row(["---"] * 15),
        *openewld_rows(openewld),
        "",
        "## MuseTrainer",
        "",
        row(["序号", "ID", "曲名", "MusicXML 标题", "Creator", "声部名称", "声部数", "最大谱表数", "小节数", "网站路径", "源路径"]),
        row(["---"] * 11),
        *musetrainer_rows(musetrainer),
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(build_catalog(), encoding="utf-8")
    print(OUTPUT)
    print(f"bytes {OUTPUT.stat().st_size}")


if __name__ == "__main__":
    main()
