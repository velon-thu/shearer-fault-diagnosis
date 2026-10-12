#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把仓库根目录的《ACS880故障码整理.csv》生成前端静态数据文件：
  apps/tablet/src/app/fault-codes/acs880-faults.ts

CSV 是从 PDF 抠出来的，有三个坑，都在这里一次处理干净：

1. **折行**：正文按 PDF 版面断行，断点常在词中间（"检查牵引真空\\n接触器"），
   所以换行直接删掉拼回整句，不能替换成空格。title 同样有这个问题。
2. **自带序号**：advice 原文写成 "1. xxx; 2. yyy"，前端是用 <ol> 渲染的，
   序号留着就会显示成 "1. 1. xxx"。这里统一剥掉，编号交给列表。
3. **分隔符不齐**：多数条目用分号分隔，但个别地方漏了分号，直接跟下一个序号
   （3220 的 "…工作正常 3. 检查采煤机供电…"）。所以分号切完还要再按序号切一刀。

CSV 更新后重跑本脚本即可。
"""
import csv, io, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "ACS880故障码整理.csv")
DST = os.path.join(ROOT, "apps", "tablet", "src", "app", "fault-codes", "acs880-faults.ts")

# 行首序号：1. / 2、 / 3）
LEADING_NUM = re.compile(r"^\s*\d{1,2}\s*[.、）)]\s*")

# 发布净化：原资料里指向别处的措辞，换成本机真实存在的入口。
# 与 tools/build-diagnosis-trees.py 里的净化同一个目的：装进产品的文案不带出资料来源。
SANITIZE_RULES = [
    ("本小程序下方提供", "本页下方提供"),
    ("本小程序", "本机"),
]
FORBIDDEN = re.compile(r"小程序|录屏|微信")


def sanitize(text: str) -> str:
    for old, new in SANITIZE_RULES:
        text = text.replace(old, new)
    return text


# 句中序号：前面是空白或标点，后面跟非数字（避开 "1140V or 3300V" 这类）
INLINE_NUM = re.compile(r"(?<=[\s，,。;；])(?=\d{1,2}\s*[.、]\s*[^\d\s])")


def unwrap(text: str) -> str:
    """删掉 PDF 折行并压掉多余空白（折行常在词中间，不能补空格）。"""
    text = text.replace("\r", "").replace("\n", "")
    return sanitize(re.sub(r"[ \t]{2,}", " ", text).strip())


def split_advice(advice: str) -> list:
    advice = unwrap(advice)
    if not advice:
        return []
    parts = []
    for chunk in re.split(r"[;；]", advice):
        chunk = chunk.strip()
        if not chunk:
            continue
        # 漏了分号的地方按句中序号再切
        for piece in INLINE_NUM.split(chunk):
            piece = LEADING_NUM.sub("", piece).strip()
            piece = piece.strip(" ,，;；")
            if piece:
                parts.append(piece)
    return parts


rows = list(csv.DictReader(io.StringIO(open(SRC, "rb").read().decode("utf-8-sig"))))

entries = []
for r in rows:
    code = (r.get("code") or "").strip()
    title = unwrap(r.get("title") or "")
    if not code or not title:
        continue
    entries.append({"code": code, "title": title, "advice": split_advice(r.get("advice") or "")})

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

# 自检：序号没剥干净、或还有折行残留，都当场报出来
blocked = [
    e["code"]
    for e in entries
    if FORBIDDEN.search(e["title"]) or any(FORBIDDEN.search(a) for a in e["advice"])
]
if blocked:
    raise SystemExit(f"净化未通过，仍含资料来源字样: {blocked}")

leftover = [e["code"] for e in entries if any(LEADING_NUM.match(a) for a in e["advice"])]
wrapped = [e["code"] for e in entries if "\n" in e["title"] or any("\n" in a for a in e["advice"])]
print(f"生成 {DST}: {len(entries)} 条")
print(f"  建议条目共 {sum(len(e['advice']) for e in entries)} 条")
if leftover:
    print(f"  ⚠ 仍带序号: {leftover}")
if wrapped:
    print(f"  ⚠ 仍有折行: {wrapped}")
if not leftover and not wrapped:
    print("  ✓ 无残留序号与折行")
