#!/usr/bin/env python3
"""引导性诊断树 YAML → 后端可加载的 JSON。

docs/ 下每个 `*诊断树*/diagnosis-trees.yaml` 是一棵树的唯一数据源（人工规范化过的
厂家诊断资料）。本脚本把它们合并成一份 services/ipc-api/seed/diagnosis-trees.json，
ipc-api 启动时加载后原样下发给平板（data/ 是 gitignore 的运行时目录，种子数据放 seed/）。

规则：**只搬运，不改写**。节点文本、选项文本、status、note、source_page 全部逐字段
带走；转换完成后再反向比对一次，任何字段丢失/改动都会让脚本失败退出。

新增树（牵引、电机启停…）只要把目录放进 docs/ 再跑一次本脚本：

    python3 tools/build-diagnosis-trees.py
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.exit("需要 PyYAML：pip install pyyaml")

REPO_ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = REPO_ROOT / "docs"
OUT_PATH = REPO_ROOT / "services" / "ipc-api" / "seed" / "diagnosis-trees.json"

# 目录名关键词 → 稳定的树 id（前端路由与排查记录都靠它，不能随目录改名而变）
TREE_ID_BY_KEYWORD = [
    ("调高", "arm-height"),
    ("牵引", "traction"),
    ("电机启停", "motor-start-stop"),
    ("启停", "motor-start-stop"),
]

# 树 id → 平板上的短名（目录名太长，宫格与面包屑放不下）
# 选项没写 status 时按"原始资料中明确给出"处理，与调高树的原始默认一致
DEFAULT_OPTION_STATUS = "observed"

TREE_SHORT_NAME = {
    "arm-height": "调高故障",
    "traction": "牵引故障",
    "motor-start-stop": "电机启停故障",
}


# ---------------------------------------------------------------- 发布净化
#
# YAML 原件是忠实的抽取留档，一个字不改；但装进产品的文案不能带出资料来源，
# 也不能把用户往这台设备上不存在的地方指。所以在生成种子时做一层替换：
#
#   · 指路类：外部引用改成本机真实存在的功能入口（改完其实更有用）
#   · 来源类：安全须知与说明里的来源描述换成中性表述，安全实质一句不减
#
# **只改措辞，不动诊断逻辑**——节点跳转、选项、判据完全不碰。
# 替换后还会做一次全量扫描，还留着敏感词就直接失败退出。
SANITIZE_RULES = [
    # 指路：改成本机的功能名
    (
        "可在本小程序的系统故障模块中查看。",
        "可在「故障代码查询 → 系统故障代码」中查看。",
    ),
    (
        "可以根据变频器报的故障代码到本小程序变频器部分查看原因及处理方法",
        "可以根据变频器报的故障代码到「故障代码查询 → 变频器故障代码」查看原因及处理方法",
    ),
    (
        "具体故障请参考本小程序变频器部分进一步处理。",
        "具体故障请到「故障代码查询 → 变频器故障代码」进一步处理。",
    ),
    (
        "请到本小程序“电机启停→调高泵启停故障”中查找处理。",
        "请到「引导性故障排查 → 电机启停故障 → 调高泵启停故障」中查找处理。",
    ),
    # 来源：安全须知与说明
    (
        "本资料由既有小程序录屏整理，仅用于故障诊断逻辑复刻和培训，",
        "本资料仅用于故障诊断参考与培训，",
    ),
    (
        "录屏中的“短接”步骤属于高风险诊断手段。程序实现时必须先展示安全确认，"
        "不得将其设计为普通用户可直接执行的无条件操作。",
        "资料中的“短接”步骤属于高风险诊断手段，必须先完成安全确认，"
        "不得作为可随手执行的常规操作。",
    ),
    (
        "本资料用于复刻原小程序的诊断逻辑，不替代矿方安全规程、设备说明书或专业人员判断。",
        "本资料仅用于故障诊断参考，不替代矿方安全规程、设备说明书或专业人员判断。",
    ),
    (
        "原页面中的“临时短接”内容仅按录屏原文保留，不应被 AI 或小程序视为可直接执行的操作授权。",
        "其中“临时短接”属原文保留的应急措施，不构成可直接执行的操作授权。",
    ),
    (
        "根据4段微信小程序操作录屏提取的电机启停故障诊断逻辑。",
        "电机启停故障的诊断逻辑，覆盖调高泵启停、截割启动、破碎电机启动与自启动油泵四类问题。",
    ),
    # 标题：这一条会显示在选机型页顶部
    ("采煤机调高故障诊断树（由六段录屏提取）", "采煤机调高故障诊断树"),
    # 待补录说明：不提资料形态
    ("在录屏中未继续展示，已标记待补录。", "在现有资料中未继续展开，已标记待补录。"),
    ("在录屏中未继续展示，已保留为待补录分支。", "在现有资料中未继续展开，已保留为待补录分支。"),
    ("录屏中未展示该选项的下一页，禁止由模型自行猜测。", "该选项的后续步骤资料未覆盖，不得自行推断。"),
    ("原小程序在录屏中对两个选项均未发生页面跳转。", "两个选项在现有资料中均未给出后续步骤。"),
    ("录屏中点击后页面未发生跳转。", "该选项在现有资料中没有后续步骤。"),
    ("录屏中P024出现了同义重复页面，已合并。", "原始资料中存在同义重复条目，已合并。"),
    ("该跳转按录屏实际路径记录。", "该跳转按原始资料的实际路径记录。"),
    ("双侧路径中的同一可视页面，按录屏上下文拆分。", "双侧路径共用同一条目，已按上下文拆分。"),
    # 抽取说明（不上屏，但一并中性化）
    ("status=observed 表示录屏中直接看到跳转", "status=observed 表示原始资料中明确给出跳转"),
    (
        "inferred_from_backtracking 表示录屏快速返回导致中间页不足一秒，但可由前后页面和按钮位置确定",
        "inferred_from_backtracking 表示中间步骤记录不完整，但可由前后条目与选项位置确定",
    ),
    (
        "status=unresolved_not_recorded 表示录屏没有展示下一页，或点击后原小程序未跳转",
        "status=unresolved_not_recorded 表示原始资料未给出后续步骤",
    ),
    ("录屏未直接展示", "原始资料未直接给出"),
    ("录屏中直接看到跳转", "原始资料中明确给出跳转"),
    ("部分可视页面在单侧/双侧路径中复用但下一节点不同", "部分条目在单侧/双侧路径中复用但下一节点不同"),
]

# 净化后不允许再出现的词
FORBIDDEN = re.compile(r"小程序|录屏|微信")


def sanitize(text):
    if not isinstance(text, str):
        return text
    for old, new in SANITIZE_RULES:
        text = text.replace(old, new)
    return text


def sanitize_deep(value):
    """递归净化整棵树的所有字符串。"""
    if isinstance(value, str):
        return sanitize(value)
    if isinstance(value, list):
        return [sanitize_deep(v) for v in value]
    if isinstance(value, dict):
        return {k: sanitize_deep(v) for k, v in value.items()}
    return value


def tree_id_for(dir_name: str, index: int) -> str:
    for keyword, tree_id in TREE_ID_BY_KEYWORD:
        if keyword in dir_name:
            return tree_id
    return f"tree-{index + 1}"


def convert_option(raw: dict) -> dict:
    option = {
        "label": raw["label"],
        "next": raw.get("next"),
        "status": raw.get("status", DEFAULT_OPTION_STATUS),
    }
    if raw.get("note") is not None:
        option["note"] = raw["note"]
    return option


def convert_node(node_id: str, raw: dict) -> dict:
    node = {
        "id": node_id,
        "type": raw["type"],
        "text": raw["text"],
        "options": [convert_option(opt) for opt in raw.get("options", []) or []],
    }
    # note（调高/牵引）与 notes（电机启停）是同一件事，都是给现场看的补充说明
    note = raw.get("note", raw.get("notes"))
    if note is not None:
        node["note"] = note

    # 三种出处写法：调高树扁平 source_page / source_timestamp_s；牵引树嵌套
    # source: {page, timestamp_sec, frame}；电机启停树直接给 source_frame。
    source = raw.get("source") or {}
    page = raw.get("source_page", source.get("page"))
    timestamp = raw.get("source_timestamp_s", source.get("timestamp_sec"))
    frame = raw.get("source_frame", source.get("frame"))
    if page is not None:
        node["sourcePage"] = page
    if timestamp is not None:
        node["sourceTimestampS"] = timestamp
    if frame is not None:
        node["sourceFrame"] = frame
    if raw.get("severity") is not None:
        node["severity"] = raw["severity"]
    if raw.get("confidence") is not None:
        node["confidence"] = raw["confidence"]
    return node


def iter_nodes(nodes):
    """nodes 既可能是 {id: node} 字典（调高/牵引），也可能是带 id 的列表（电机启停）。"""
    if isinstance(nodes, dict):
        return list(nodes.items())
    return [(node["id"], node) for node in nodes]


def convert_module(raw: dict, position: int) -> dict:
    module = {
        "id": raw["id"],
        "index": raw.get("index", position + 1),
        "name": raw["name"],
        "startNode": raw["start_node"],
        "nodes": [convert_node(node_id, node) for node_id, node in iter_nodes(raw["nodes"])],
    }
    if raw.get("source_video") is not None:
        module["sourceVideo"] = raw["source_video"]
    return module


def as_list(value) -> list:
    """safety_notice 有的写成一段话，有的写成条目列表，统一成列表。"""
    if value is None:
        return []
    return list(value) if isinstance(value, list) else [value]


def normalize_doc(raw_doc: dict, dir_name: str) -> dict:
    """把三种 YAML 布局收敛成同一形状：树 → 模块[] → 节点[]。

    · 调高树：顶层 modules[]，每个模块一台机型，nodes 是 {id: node} 字典。
    · 牵引树：顶层 system{} + 扁平 nodes{}，整棵树只有一条主线。
      这种树包成"单模块"，前端据此跳过选机型那一屏。
    · 电机启停树：顶层 modules[]，但 nodes 是列表、模块不带 index，
      顶层另有 description 与列表形式的 safety_notice。
    """
    if "modules" in raw_doc:
        return {
            "title": raw_doc["title"],
            "schemaVersion": str(raw_doc.get("schema_version", "1.0")),
            "extractionNotes": list(raw_doc.get("extraction_notes", [])),
            "introduction": raw_doc.get("description"),
            "safetyNotice": as_list(raw_doc.get("safety_notice")),
            "modules": list(raw_doc["modules"]),
        }

    system = raw_doc.get("system") or {}
    module = {
        "id": system.get("id") or dir_name,
        "index": 1,
        "name": system.get("title") or dir_name,
        "start_node": system["start_node"],
        "nodes": raw_doc["nodes"],
    }
    if system.get("source_video") is not None:
        module["source_video"] = system["source_video"]
    return {
        "title": system.get("title") or dir_name,
        "schemaVersion": str(raw_doc.get("schema_version", "1.0")),
        "extractionNotes": list(raw_doc.get("extraction_notes", [])),
        "introduction": system.get("introduction"),
        "safetyNotice": as_list(system.get("safety_notice")),
        "modules": [module],
    }


def verify(normalized: dict, tree: dict, label: str) -> None:
    """反向比对：转换结果必须能逐字段还原回 YAML 原文。"""
    errors: list[str] = []

    if len(normalized["modules"]) != len(tree["modules"]):
        errors.append(f"模块数不一致 {len(normalized['modules'])} → {len(tree['modules'])}")

    for raw_module, module in zip(normalized["modules"], tree["modules"]):
        prefix = f"{label}/{raw_module['id']}"
        if raw_module["start_node"] != module["startNode"]:
            errors.append(f"{prefix} 起始节点不一致")
        if len(raw_module["nodes"]) != len(module["nodes"]):
            errors.append(
                f"{prefix} 节点数不一致 {len(raw_module['nodes'])} → {len(module['nodes'])}"
            )

        by_id = {node["id"]: node for node in module["nodes"]}
        for node_id, raw_node in iter_nodes(raw_module["nodes"]):
            node = by_id.get(node_id)
            if node is None:
                errors.append(f"{prefix}/{node_id} 丢失")
                continue
            if raw_node["text"] != node["text"]:
                errors.append(f"{prefix}/{node_id} 文本被改写")
            if raw_node["type"] != node["type"]:
                errors.append(f"{prefix}/{node_id} 类型不一致")
            raw_note = raw_node.get("note", raw_node.get("notes"))
            if raw_note != node.get("note"):
                errors.append(f"{prefix}/{node_id} note 丢失")
            raw_options = raw_node.get("options", [])
            if len(raw_options) != len(node["options"]):
                errors.append(f"{prefix}/{node_id} 选项数不一致")
                continue
            for raw_opt, opt in zip(raw_options, node["options"]):
                if raw_opt["label"] != opt["label"]:
                    errors.append(f"{prefix}/{node_id} 选项文本被改写")
                if raw_opt.get("next") != opt["next"]:
                    errors.append(f"{prefix}/{node_id} 选项跳转不一致")
                if raw_opt.get("status", DEFAULT_OPTION_STATUS) != opt["status"]:
                    errors.append(f"{prefix}/{node_id} 选项 status 不一致")
                if raw_opt.get("note") != opt.get("note"):
                    errors.append(f"{prefix}/{node_id} 选项 note 丢失")

            # 跳转目标必须存在（null 表示录屏未展示，前端显示待补录）
            for opt in node["options"]:
                if opt["next"] is not None and opt["next"] not in by_id:
                    errors.append(f"{prefix}/{node_id} 跳转到不存在的节点 {opt['next']}")

    # 孤儿节点：从起点走不到的节点，多半是抽取时漏了跳转
    for module in tree["modules"]:
        by_id = {node["id"]: node for node in module["nodes"]}
        reachable: set[str] = set()
        stack = [module["startNode"]]
        while stack:
            current = stack.pop()
            if current in reachable or current not in by_id:
                continue
            reachable.add(current)
            stack.extend(opt["next"] for opt in by_id[current]["options"] if opt["next"])
        orphans = sorted(set(by_id) - reachable)
        if orphans:
            errors.append(f"{label}/{module['id']} 从起点走不到：{'、'.join(orphans)}")

    if errors:
        for err in errors:
            print(f"  ✗ {err}", file=sys.stderr)
        sys.exit(f"{label} 无损校验失败，未写出文件")


def replay_stepwise(tree: dict, md: str) -> tuple[int, list[str]]:
    """牵引树写法：每条路径逐行写明 `节点` 选择 **标签** → `节点`。"""
    blocks = re.split(r"^## 路径 ", md, flags=re.M)[1:]
    if not blocks:
        return 0, []

    step_re = re.compile(r"^- `(\w+)` 选择 \*\*(.+?)\*\* → `(\w+)`", re.M)
    all_nodes = {node["id"]: node for module in tree["modules"] for node in module["nodes"]}
    starts = {module["startNode"] for module in tree["modules"]}

    failures: list[str] = []
    for block in blocks:
        title = block.split("\n")[0].strip()
        steps = step_re.findall(block)
        if not steps:
            continue
        current = steps[0][0]
        if current not in starts:
            failures.append(f"路径 {title} 起点 {current} 不是任何模块的起始节点")
            continue
        for src, label, dst in steps:
            if current != src:
                failures.append(f"路径 {title} 走到 {current}，用例期望 {src}")
                break
            option = next((o for o in all_nodes[src]["options"] if o["label"] == label), None)
            if option is None:
                failures.append(f"路径 {title} 的 {src} 没有选项「{label}」")
                break
            if option["next"] != dst:
                failures.append(f"路径 {title} 的 {src}/{label} 跳到 {option['next']}，用例期望 {dst}")
                break
            current = dst
        else:
            if all_nodes[current]["type"] != "result":
                failures.append(f"路径 {title} 终点 {current} 不是结论节点")
    return len(blocks), failures


def replay_labelwise(tree: dict, md: str) -> tuple[int, list[str]]:
    """电机启停树写法：TC 用例只给模块名 + 一串选项标签 + 预期结论节点。"""
    cases = re.split(r"^### ", md, flags=re.M)[1:]
    if not cases:
        return 0, []

    module_by_name = {module["name"]: module for module in tree["modules"]}
    failures: list[str] = []
    counted = 0
    for case in cases:
        title = case.split("\n")[0].strip()
        module_match = re.search(r"^- 模块：(.+)$", case, re.M)
        path_match = re.search(r"^- 选择路径：(.+)$", case, re.M)
        expect_match = re.search(r"^- 预期结果：`(\w+)`", case, re.M)
        todo_expected = "待补录" in case
        if not module_match or not path_match:
            continue
        counted += 1

        module = module_by_name.get(module_match.group(1).strip())
        if module is None:
            failures.append(f"{title} 的模块「{module_match.group(1).strip()}」不存在")
            continue
        by_id = {node["id"]: node for node in module["nodes"]}
        labels = [label.strip() for label in path_match.group(1).split("→") if label.strip()]

        current = module["startNode"]
        broke = False
        for label in labels:
            option = next((o for o in by_id[current]["options"] if o["label"] == label), None)
            if option is None:
                failures.append(f"{title} 的 {current} 没有选项「{label}」")
                broke = True
                break
            if option["next"] is None:
                # 待补录分支：用例本来就只要求显示占位提示
                if not todo_expected:
                    failures.append(f"{title} 在 {current}/{label} 撞上待补录分支，但用例期望有结论")
                broke = True
                break
            current = option["next"]
        if broke:
            continue

        if todo_expected:
            failures.append(f"{title} 用例期望待补录，实际走到了 {current}")
        elif expect_match and current != expect_match.group(1):
            failures.append(f"{title} 走到 {current}，用例期望 {expect_match.group(1)}")
        elif by_id[current]["type"] != "result":
            failures.append(f"{title} 终点 {current} 不是结论节点")
    return counted, failures


def replay_acceptance_tests(tree: dict, yaml_path: Path) -> str:
    """有 acceptance-tests.md 就把里面的路径全跑一遍，确认树能按原样走通。"""
    md_path = yaml_path.parent / "acceptance-tests.md"
    if not md_path.exists():
        return ""

    md = md_path.read_text(encoding="utf-8")
    total, failures = replay_stepwise(tree, md)
    if total == 0:
        total, failures = replay_labelwise(tree, md)
    if total == 0:
        return ""

    if failures:
        for failure in failures:
            print(f"  ✗ {failure}", file=sys.stderr)
        sys.exit(f"{yaml_path.parent.name} 的验收路径没走通，未写出文件")
    return f" · 验收路径 {total} 条全通"


def main() -> None:
    # 两种命名都收：调高树是 diagnosis-trees.yaml，牵引树是 diagnosis-tree.yaml
    yaml_paths = sorted(
        {path for pattern in ("*/diagnosis-tree.yaml", "*/diagnosis-trees.yaml") for path in DOCS_DIR.glob(pattern)}
    )
    if not yaml_paths:
        sys.exit(f"没有在 {DOCS_DIR} 下找到 diagnosis-tree(s).yaml")

    trees = []
    for index, path in enumerate(yaml_paths):
        raw_doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        dir_name = path.parent.name
        tree_id = tree_id_for(dir_name, index)
        normalized = normalize_doc(raw_doc, dir_name)

        tree = {
            "id": tree_id,
            "shortName": TREE_SHORT_NAME.get(tree_id, dir_name),
            "title": normalized["title"],
            "schemaVersion": normalized["schemaVersion"],
            "sourceDir": dir_name,
            "extractionNotes": normalized["extractionNotes"],
            "modules": [
                convert_module(module, position)
                for position, module in enumerate(normalized["modules"])
            ],
        }
        if normalized["introduction"] is not None:
            tree["introduction"] = normalized["introduction"]
        if normalized["safetyNotice"]:
            tree["safetyNotice"] = normalized["safetyNotice"]
        verify(normalized, tree, dir_name)

        node_count = sum(len(module["nodes"]) for module in tree["modules"])
        question_count = sum(
            1
            for module in tree["modules"]
            for node in module["nodes"]
            if node["type"] == "question"
        )
        todo_count = sum(
            1
            for module in tree["modules"]
            for node in module["nodes"]
            for opt in node["options"]
            if opt["next"] is None
        )
        result_count = node_count - question_count
        acceptance = replay_acceptance_tests(tree, path)

        # 校验都过了再净化：verify 要拿原文逐字比对，净化必须排在它后面
        before = json.dumps(tree, ensure_ascii=False)
        tree = sanitize_deep(tree)
        sanitized_hits = len(FORBIDDEN.findall(before)) - len(
            FORBIDDEN.findall(json.dumps(tree, ensure_ascii=False))
        )

        print(
            f"✓ {dir_name} → id={tree_id} "
            f"模块 {len(tree['modules'])} · 节点 {node_count}（问题 {question_count} / 结论 {result_count}）"
            f"· 待补录分支 {todo_count}{acceptance}"
            + (f" · 净化 {sanitized_hits} 处" if sanitized_hits else "")
        )
        trees.append(tree)

    # 最终把关：装进产品的文案里不允许再出现资料来源相关字样
    leftovers = []

    def scan(value, where):
        if isinstance(value, str):
            if FORBIDDEN.search(value):
                leftovers.append((where, value))
        elif isinstance(value, list):
            for i, item in enumerate(value):
                scan(item, f"{where}[{i}]")
        elif isinstance(value, dict):
            for key, item in value.items():
                scan(item, f"{where}.{key}")

    scan(trees, "trees")
    if leftovers:
        for where, value in leftovers[:10]:
            print(f"  ✗ {where}: {value[:140]}", file=sys.stderr)
        sys.exit(f"净化未通过（{len(leftovers)} 处），未写出文件——请把新措辞补进 SANITIZE_RULES")
    print("✓ 发布净化检查通过")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(
            {
                "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "trees": trees,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"→ {OUT_PATH.relative_to(REPO_ROOT)}（{OUT_PATH.stat().st_size // 1024} KB）")


if __name__ == "__main__":
    main()
