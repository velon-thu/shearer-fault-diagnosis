#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把仓库根目录的《ACS880故障码整理.csv》生成前端静态数据文件：
  apps/tablet/src/app/fault-codes/acs880-faults.ts

- advice 中的换行是 PDF 提取折行痕迹，先拼回整句；
- 再按中英文分号拆成建议条目列表，便于前端逐条展示。
CSV 更新后重跑本脚本即可。
"""
import csv, io, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "ACS880故障码整理.csv")
DST = os.path.join(ROOT, "apps", "tablet", "src", "app", "fault-codes", "acs880-faults.ts")

raw = open(SRC, "rb").read()
text = raw.decode("utf-8-sig")
rows = list(csv.DictReader(io.StringIO(text)))

entries = []
for r in rows:
    code = (r.get("code") or "").strip()
    title = (r.get("title") or "").strip()
    advice = (r.get("advice") or "").strip()
    if not code or not title:
        continue
    # 折行拼回 → 按分号拆条
    advice = advice.replace("\r", "").replace("\n", "")
    parts = [p.strip() for p in re.split(r"[;；]", advice) if p.strip()]
    entries.append({"code": code, "title": title, "advice": parts})

body = json.dumps(entries, ensure_ascii=False, indent=2)
ts = f"""// 本文件由 tools/extract-acs880.py 从《ACS880故障码整理.csv》自动生成，请勿手改。
// 共 {len(entries)} 条。CSV 更新后重跑脚本再提交。

export type Acs880Fault = {{
  code: string;
  title: string;
  advice: string[];
}};

export const ACS880_FAULTS: Acs880Fault[] = {body};
"""
open(DST, "w", encoding="utf-8").write(ts)
print(f"生成 {DST}: {len(entries)} 条")
