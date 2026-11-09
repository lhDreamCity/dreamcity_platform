#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把《梦之城课程细案_48课时详细文字版_V1.0.docx》解析成结构化 JSON。

每节课 10 个字段 + 90 分钟五环节，原文入库，不改写、不概括。
输出：content/lessons.json

用法：
    python tools/extract-lessons.py [源docx路径]
"""

from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = Path(
    r"D:\梦之城K12学生AI应用与商业基础课\梦之城课程细案_48课时详细文字版_V1.0.docx"
)
OUTPUT = ROOT / "content" / "lessons.json"

# 十字段的中文标签 → 结构化 key
FIELD_LABELS = {
    "教学目标": "teachingGoal",
    "核心内容": "coreContent",
    "关键提问": "keyQuestion",
    "课堂实操任务": "classTask",
    "课堂产出": "classOutput",
    "双主线连接": "dualityLink",
    "达成标准": "criteria",
    "常见误区": "pitfalls",
    "课后延伸": "homework",
}

FIELD_RE = re.compile(r"^【([^】]+)】\s*(.*)$", re.S)
LESSON_RE = re.compile(r"^(L[123])-(\d{2})[　\s]+(.+?)\s*$")
SEGMENT_RE = re.compile(r"^(导入|讲解|实操|展示|收尾|路演|复盘|结业)\s*(\d+)\s*[′'′]?\s*$")

# 细案里少数课次（结业日 / 路演日）用了本课专属的环节名。
# 原文保留在 phase 里，另外归一到平台统一的五环节（canonical）。
CANONICAL_PHASE = {
    "导入": "导入",
    "讲解": "讲解",
    "实操": "实操",
    "展示": "展示",
    "路演": "展示",
    "收尾": "收尾",
    "复盘": "收尾",
    "结业": "收尾",
}


def para_text(p: ET.Element) -> str:
    """段落纯文本，保留换行为空格。"""
    parts: list[str] = []
    for node in p.iter():
        if node.tag == f"{W}t" and node.text:
            parts.append(node.text)
        elif node.tag == f"{W}tab":
            parts.append("\t")
        elif node.tag == f"{W}br":
            parts.append(" ")
    return "".join(parts).strip()


def table_rows(tbl: ET.Element) -> list[list[str]]:
    rows: list[list[str]] = []
    for tr in tbl.findall(f"{W}tr"):
        cells: list[str] = []
        for tc in tr.findall(f"{W}tc"):
            cell_paras = [para_text(p) for p in tc.findall(f"{W}p")]
            cells.append("\n".join(x for x in cell_paras if x).strip())
        rows.append(cells)
    return rows


def iter_blocks(document: ET.Element):
    """按文档顺序产出 ('p', 段落) 与 ('tbl', 行列表)。"""
    body = document.find(f"{W}body")
    if body is None:
        return
    for child in body:
        if child.tag == f"{W}p":
            yield "p", para_text(child)
        elif child.tag == f"{W}tbl":
            yield "tbl", table_rows(child)


def parse_source(path: Path) -> list[dict]:
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml")
    document = ET.fromstring(xml)

    blocks = list(iter_blocks(document))

    lessons: list[dict] = []
    current: dict | None = None

    for kind, payload in blocks:
        if kind == "p":
            text = payload.strip()
            if not text:
                continue

            m = LESSON_RE.match(text)
            if m:
                current = {
                    "id": f"{m.group(1)}-{m.group(2)}",
                    "level": m.group(1),
                    "seq": int(m.group(2)),
                    "title": m.group(3).strip(),
                    "fields": {},
                    "segments": [],
                }
                lessons.append(current)
                continue

            if current is None:
                continue

            fm = FIELD_RE.match(text)
            if fm:
                label = fm.group(1)
                value = fm.group(2).strip()
                # 「关键提问（教师话术）」「常见误区与教学提醒」「课后延伸与家长反馈」
                # 这类带括号补充说明的标签，按前缀匹配
                key = None
                for prefix, k in FIELD_LABELS.items():
                    if label.startswith(prefix):
                        key = k
                        break
                if key:
                    current["fields"][key] = value
                continue

            # 「90分钟教学流程」之类的说明段落忽略

        else:  # tbl
            if current is None:
                continue
            rows = payload
            if not rows:
                continue
            header = rows[0]
            if not any("环节" in c for c in header):
                continue
            for row in rows[1:]:
                if len(row) < 2:
                    continue
                left = row[0].strip()
                right = row[1].strip()
                sm = SEGMENT_RE.match(left)
                if not sm:
                    continue
                current["segments"].append(
                    {
                        "phase": sm.group(1),
                        "canonical": CANONICAL_PHASE[sm.group(1)],
                        "minutes": int(sm.group(2)),
                        "activity": right,
                    }
                )

    return lessons


# ── 单元划分 ──────────────────────────────────────────────────────
# 依据：每级 16 节按 1–4 / 5–8 / 9–12 / 13–16 分为 4 个单元，
# 单元名从该单元 4 节课的真实主题归纳（不新增课程内容）。
UNIT_NAMES = {
    "L1": ["认识 AI", "AI 动手创作", "钱的秘密", "模拟市集"],
    "L2": ["AI 的力量", "AI 创客", "商业认知", "市集与路演"],
    "L3": ["看懂 AI", "造一个 AI 项目", "商业本质", "产品与路演"],
}


def assign_units(lessons: list[dict]) -> list[dict]:
    for lesson in lessons:
        level = lesson["level"]
        seq = lesson["seq"]
        unit_index = (seq - 1) // 4
        lesson["unitId"] = f"{level}-U{unit_index + 1}"
        lesson["unitName"] = UNIT_NAMES[level][unit_index]
        lesson["unitSeq"] = unit_index + 1
    return lessons


# ── 课型配方 ──────────────────────────────────────────────────────
# 从细案的环节结构归纳：讲概念的工具课、动手多的项目课、实战课的实战课。
# 这只是给编排器一个默认值，讲师可在编排器里改。
RECIPE_HINTS = {
    "L1": {"概念课": [1, 2, 4, 7], "工具课": [3, 5, 6, 7], "项目课": [8, 16], "实战课": [14, 16], "结业课": [16]},
    "L2": {"概念课": [1, 3, 4], "工具课": [2, 5, 6, 7], "项目课": [8, 12], "实战课": [11, 14], "结业课": [16]},
    "L3": {"概念课": [1, 3, 4], "工具课": [2, 5, 6, 7], "项目课": [8, 12], "实战课": [11, 14], "结业课": [16]},
}


def assign_recipes(lessons: list[dict]) -> list[dict]:
    for lesson in lessons:
        level = lesson["level"]
        seq = lesson["seq"]
        recipe = "工具课"
        for name, seqs in RECIPE_HINTS[level].items():
            if seq in seqs:
                recipe = name
                break
        lesson["defaultRecipe"] = recipe
    return lessons


def main() -> int:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not source.exists():
        print(f"找不到源文件：{source}", file=sys.stderr)
        return 1

    lessons = parse_source(source)
    if not lessons:
        print("没有解析出任何课次。", file=sys.stderr)
        return 1

    lessons = assign_units(assign_recipes(lessons))

    # ── 自检：48 节、十字段齐全、五环节齐全 ──────────────────
    problems: list[str] = []
    if len(lessons) != 48:
        problems.append(f"课次数量是 {len(lessons)}，应为 48")

    for lesson in lessons:
        missing = [k for k in FIELD_LABELS.values() if not lesson["fields"].get(k)]
        if missing:
            problems.append(f"{lesson['id']} 缺字段：{', '.join(missing)}")
        if len(lesson["segments"]) != 5:
            problems.append(
                f"{lesson['id']} 环节数是 {len(lesson['segments'])}，应为 5"
            )
        total = sum(s["minutes"] for s in lesson["segments"])
        lesson["totalMinutes"] = total
        # 绝大多数课次 90 分钟；结业日 / 路演日（L1-16、L2-16）原文就是 100 分钟
        if total not in (90, 100):
            problems.append(f"{lesson['id']} 环节合计 {total} 分钟，应为 90 或 100")
        lesson["canonicalMinutes"] = {
            phase: sum(
                s["minutes"] for s in lesson["segments"] if s["canonical"] == phase
            )
            for phase in ("导入", "讲解", "实操", "展示", "收尾")
        }

    if problems:
        print("自检未通过：", file=sys.stderr)
        for p in problems:
            print(f"  · {p}", file=sys.stderr)
        return 2

    output = {
        "source": source.name,
        "lessonCount": len(lessons),
        "fieldNames": list(FIELD_LABELS.values()),
        "lessons": [
            {
                "id": lesson["id"],
                "level": lesson["level"],
                "seq": lesson["seq"],
                "title": lesson["title"],
                "unitId": lesson["unitId"],
                "unitName": lesson["unitName"],
                "unitSeq": lesson["unitSeq"],
                "defaultRecipe": lesson["defaultRecipe"],
                "output": lesson["fields"].get("classOutput", ""),
                "totalMinutes": lesson["totalMinutes"],
                "canonicalMinutes": lesson["canonicalMinutes"],
                "plan": {
                    "teachingGoal": lesson["fields"]["teachingGoal"],
                    "coreContent": lesson["fields"]["coreContent"],
                    "segments": lesson["segments"],
                    "keyQuestion": lesson["fields"]["keyQuestion"],
                    "classTask": lesson["fields"]["classTask"],
                    "classOutput": lesson["fields"]["classOutput"],
                    "dualityLink": lesson["fields"]["dualityLink"],
                    "criteria": lesson["fields"]["criteria"],
                    "pitfalls": lesson["fields"]["pitfalls"],
                    "homework": lesson["fields"]["homework"],
                },
            }
            for lesson in lessons
        ],
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ 解析出 {len(lessons)} 节课，已写入 {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
