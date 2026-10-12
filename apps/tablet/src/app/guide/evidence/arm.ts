/**
 * 调高故障诊断树的节点 ←→ 机器数据绑定。
 *
 * 公共规矩见 ./index.ts。这里只管调高：判定口径是指令段（遥控器/端头站按下）
 * → 输出段（主控输出）→ 效果段（摇臂采高变化）。
 */
import type { ArmEvidence, DiagnosisNode } from "@shearer/contracts";
import type { EvidenceCard } from "./types";

type EvidenceKind =
  | "side" // 单边还是双侧
  | "endstation" // 端头站能否升降
  | "remote" // 遥控器操作
  | "module-type" // CIO / PVD / 主控 选型
  | "main-valve" // 总阀阀杆动作
  | "low-pressure" // 低压 2.5MPa
  | "high-pressure" // 高压 18MPa
  | "oil" // 油量、油位
  | "terminal" // 端子 24V、继电器触点
  | "manual-valve"; // 手动阀操作

// 顺序敏感：先匹配更具体的问法。测量类问题里也常出现"遥控器"，必须排在 remote 之前。
const RULES: Array<{ kind: EvidenceKind; test: RegExp }> = [
  { kind: "side", test: /单个摇臂不升降还是两边摇臂都不升降/ },
  { kind: "endstation", test: /端头站/ },
  { kind: "module-type", test: /是CIO比例阀控制模块还是PVD|比例阀是通过.*控制/ },
  { kind: "main-valve", test: /总阀阀杆是否动作/ },
  { kind: "low-pressure", test: /低压油压|低压是否|恢复至2\.5MPa|2\.5MPa/ },
  { kind: "high-pressure", test: /18MPa|高压液压表/ },
  { kind: "oil", test: /泵箱油量|检查液压油量|泵箱液位|确保油量/ },
  { kind: "terminal", test: /24V|AC26V|AC28V|继电器触点|整流桥|接线排/ },
  { kind: "manual-valve", test: /手动比例阀|手动换向阀|球形手动|手动阀/ },
  { kind: "remote", test: /遥控器操作|操作遥控器|用遥控器/ },
];

const resolveEvidenceKind = (node: DiagnosisNode): EvidenceKind | null =>
  RULES.find((rule) => rule.test.test(node.text))?.kind ?? null;

const pad = (n: number) => String(n).padStart(2, "0");

const fmtClock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// 把操作来源汇总成"某类操作台一共按了几次、带动了几次"。
// 数据已经指出是哪一侧不动时只看那一侧——诊断树问的就是"不动作的那条摇臂"。
const gatherSource = (evidence: ArmEvidence, keyword: RegExp) => {
  const scoped =
    evidence.sideVerdict === "left" || evidence.sideVerdict === "right"
      ? evidence.sides.filter((side) => side.side === evidence.sideVerdict)
      : evidence.sides;
  let count = 0;
  let movedCount = 0;
  let lastTs: number | null = null;
  for (const side of scoped) {
    for (const source of side.sources) {
      if (!keyword.test(source.source)) {
        continue;
      }
      count += source.count;
      movedCount += source.movedCount;
      if (source.lastTs !== null && (lastTs === null || source.lastTs > lastTs)) {
        lastTs = source.lastTs;
      }
    }
  }
  return { count, movedCount, lastTs };
};

const NO_SENSOR_NOTE = "本机没有这个测点，数据帮不上忙，按现场实测结果作答。";

const buildCard = (kind: EvidenceKind, evidence: ArmEvidence): EvidenceCard | null => {
  const unavailableOf = (topic: RegExp) =>
    evidence.unavailable.find((item) => topic.test(item.topic));

  switch (kind) {
    case "side": {
      const lines = evidence.sides.map((side) => ({
        label: side.label,
        value:
          side.verdict === "no-command"
            ? `窗口内只有 ${side.inputCount} 条升降指令`
            : `操作 ${side.inputCount} 次 · 主控输出 ${side.outputCount} 次 · 采高动了 ${side.movedCount} 次`,
      }));
      const recommend =
        evidence.sideVerdict === "both"
          ? { match: ["双侧", "两边"], why: evidence.sideVerdictText }
          : evidence.sideVerdict === "left" || evidence.sideVerdict === "right"
            ? { match: ["单侧", "单边"], why: evidence.sideVerdictText }
            : undefined;
      return {
        tone: "data",
        title: evidence.sideVerdictText,
        lines: [{ label: "泵电机", value: evidence.pump.text }, ...lines],
        note:
          evidence.sideVerdict === "none" || evidence.sideVerdict === "unknown"
            ? "数据看不出异常时，以现场实际操作为准。"
            : undefined,
        recommend,
      };
    }

    case "endstation": {
      const stat = gatherSource(evidence, /端头站/);
      if (stat.count === 0) {
        return {
          tone: "none",
          title: "库内近期没有端头站升降记录",
          lines: [{ label: "窗口", value: evidence.windowLabel }],
          note: "没人用端头站操作过，数据给不出结论；现场实操一次后回到这里数据就有了。",
        };
      }
      const moved = stat.movedCount > 0;
      return {
        tone: "data",
        title: moved
          ? `端头站操作 ${stat.count} 次，带动摇臂 ${stat.movedCount} 次`
          : `端头站操作 ${stat.count} 次，采高一次都没变`,
        lines: [
          { label: "最近一次", value: stat.lastTs === null ? "—" : fmtClock(stat.lastTs) },
          { label: "带动比例", value: `${stat.movedCount} / ${stat.count}` },
        ],
        recommend: {
          match: moved ? ["可以"] : ["不能"],
          why: moved
            ? "端头站发出的升降指令带动了摇臂，主控输出这一段是通的。"
            : "端头站发过升降指令但采高没动，倾向端头站也带不动。",
        },
      };
    }

    case "remote": {
      const stat = gatherSource(evidence, /遥控器/);
      if (stat.count === 0) {
        return {
          tone: "none",
          title: "库内近期没有遥控器升降记录",
          lines: [{ label: "窗口", value: evidence.windowLabel }],
          note: "没有遥控器操作记录，数据判不了，请现场实操。",
        };
      }
      return {
        tone: "data",
        title: `遥控器操作 ${stat.count} 次，带动摇臂 ${stat.movedCount} 次`,
        lines: [
          ...evidence.sides.map((side) => ({
            label: side.label,
            value: `${side.verdictText}`,
          })),
          { label: "最近一次", value: stat.lastTs === null ? "—" : fmtClock(stat.lastTs) },
        ],
        note: "遥控器指令能不能走到主控输出，看上面每侧的三段结论。",
      };
    }

    case "module-type": {
      return {
        tone: "data",
        title: "模块通讯现状",
        lines: evidence.modules.map((module) => ({
          label: module.name,
          value: module.ok ? "在线" : "离线",
        })),
        note: "PVD 走 SGC 的 485、CIO 走 CAN；通讯位全在线时不足以判定装的是哪种模块，以图纸为准。",
      };
    }

    case "main-valve": {
      const lines = evidence.sides.map((side) => ({
        label: side.label,
        value: `主控输出 ${side.outputCount} 次 · 采高动了 ${side.movedCount} 次`,
      }));
      return {
        tone: "none",
        title: "总阀阀杆没有传感器",
        lines,
        note: "阀杆动作只能现场看。上面是同一时段主控输出与摇臂实际动作，供参考。",
      };
    }

    case "low-pressure":
    case "high-pressure": {
      const item = unavailableOf(kind === "low-pressure" ? /低压/ : /高压/);
      return {
        tone: "none",
        title: kind === "low-pressure" ? "调高低压无测点" : "调高高压无测点",
        lines: [],
        note: item?.reason ?? NO_SENSOR_NOTE,
      };
    }

    case "oil": {
      const item = unavailableOf(/泵箱油位/);
      return {
        tone: "none",
        title: "泵箱油量以现场查看为准",
        lines: [],
        note:
          item?.reason ??
          "泵箱油位测点读数长期不变，反映不了实际油量，请开盖或看油标。",
      };
    }

    case "terminal": {
      return {
        tone: "none",
        title: "端子电压与继电器触点必须实测",
        lines: evidence.modules.map((module) => ({
          label: module.name,
          value: module.ok ? "在线" : "离线",
        })),
        note: "端子级电压没有采集点。模块通讯全在线只能说明模块还活着，不代表输出端口没坏。",
      };
    }

    case "manual-valve": {
      return {
        tone: "none",
        title: "手动阀动作没有传感器",
        lines: [],
        note: NO_SENSOR_NOTE,
      };
    }

    default:
      return null;
  }
};

/** 结论页给出的复盘：三段现状 + 效率对比，作为"换件前再确认一次"的依据。 */
const buildResultCard = (evidence: ArmEvidence): EvidenceCard => ({
  tone: "data",
  title: "结论前再核一眼数据",
  lines: evidence.sides.flatMap((side) => [
    { label: side.label, value: side.verdictText },
    {
      label: `${side.label}调高效率`,
      value:
        side.efficiencyPct === null
          ? "样本不足"
          : `单次位移 ${side.medianDeltaM ?? "—"} m，为基线的 ${side.efficiencyPct}%`,
    },
  ]),
  note: "效率明显低于基线时，即使这次换件解决了动作问题，也要顺手查内泄与溢流阀。",
});

/** 调高树的证据 provider：节点进来，卡片出去。 */
export const armProvider = {
  cardForNode: (node: DiagnosisNode, evidence: ArmEvidence): EvidenceCard | null => {
    if (node.type === "result") {
      return buildResultCard(evidence);
    }
    const kind = resolveEvidenceKind(node);
    return kind === null ? null : buildCard(kind, evidence);
  },
};
