"""给本地图库建检索索引：文件名（拼音，富含语义）+ WD14 英文 tag。

素材来自 archive/large（271 张官方原图，media/previews 是同一批的不同尺寸）。
tags.json 是之前对 media 打好的，文件名一致，直接按 stem 复用，不重复跑 GPU。
"""

import json
from pathlib import Path

ARCHIVE = Path(r"D:/AI/dafeiyu/archive")
LARGE = ARCHIVE / "large"
TAGS = Path(r"D:/AI/dafeiyu/tags.json")
OUT = Path(r"D:/AI/dafeiyu/library-index.json")

SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}

# tags.json 的结构是 {文件名: {"tags": [{"tag": "...", "score": 0.9}, ...]}}
def tag_names(entry) -> list[str]:
    raw = entry.get("tags") if isinstance(entry, dict) else entry
    if not raw:
        return []
    names = []
    for item in raw:
        if isinstance(item, str):
            names.append(item)
        elif isinstance(item, dict) and item.get("tag"):
            names.append(item["tag"])
    return names


def main() -> None:
    tags = json.loads(TAGS.read_text(encoding="utf-8"))
    by_stem = {Path(name).stem: value for name, value in tags.items()}

    items = []
    for image in sorted(LARGE.iterdir()):
        if image.suffix.lower() not in SUFFIXES:
            continue
        stem = image.stem
        items.append(
            {
                "file": str(image).replace("\\", "/"),
                "name": stem,
                "size_kb": round(image.stat().st_size / 1024),
                "tags": tag_names(by_stem.get(stem, {})),
            }
        )

    OUT.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    with_tags = sum(1 for item in items if item["tags"])
    print(f"索引 {len(items)} 张，其中 {with_tags} 张有 tag，输出 {OUT}")


if __name__ == "__main__":
    main()
