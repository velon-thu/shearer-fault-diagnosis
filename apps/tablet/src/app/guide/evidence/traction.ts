/**
 * 系统牵引故障诊断树的节点 ←→ 机器数据绑定。
 *
 * 牵引树问的多是"屏幕上 XX 是不是绿色"，而这些状态位共享内存里恰好都有：
 * HPC 通讯、牵电状态、牵启状态、向左/向右、各类锁定位。所以这棵树能直接
 * 作答的节点比调高树多。
 *
 * 树里还有两处明确让人去别处翻的（r08 查减速指令来源、r09 查牵停信号来源），
 * `device_action` 按操作来源记着，直接列出来即可。
 *
 * 公共规矩不变：只提示不代选；本机没测点的（端子电压、绝缘、变频器面板）
 * 一律写明现场实测。
 */
import type { DiagnosisNode, TractionEvidence } from "@shearer/contracts";
import type { EvidenceCard } from "./types";

type EvidenceKind =
  | "hpc" // HPC 状态/通讯
  | "haul-power" // 牵电状态
  | "haul-start" // 牵启状态
  | "accel" // 加速是否有效
  | "traction-run" // 是否持续牵引
  | "direction" // 方向指令是否进系统
  | "inverter-fault" // 变频器是否报故障
  | "screen-fault" // 屏幕上是否有故障提示
  | "decel-source" // 减速指令来源
  | "stop-source" // 牵停信号来源
  | "contactor" // 牵引接触器是否吸合
  | "pump" // 油泵是否启动
  | "voltage" // 控制变压器/电网电压
  | "insulation" // 绝缘、漏电
  | "inverter-local" // 变频器 LOC/REM
  | "terminal"; // 端子 24V、短接测试

// 正则一律锚定"这一问实际在问什么"，不是"文里提到了什么"。
// 反例：q03 正文里提到"牵引电机绝缘检测"，但它问的是接触器吸没吸合。
const RULES: Array<{ kind: EvidenceKind; test: RegExp }> = [
  { kind: "hpc", test: /HPC状态是否为绿色|指示灯是否闪烁|HPCJX1\.3/ },
  { kind: "haul-power", test: /牵电状态是否为绿色/ },
  { kind: "haul-start", test: /是否已牵启|牵启是否变成绿色/ },
  { kind: "accel", test: /是否可以正常加速/ },
  { kind: "traction-run", test: /是否开始持续牵引/ },
  { kind: "direction", test: /请设定牵引方向/ },
  { kind: "inverter-fault", test: /变频器是否报故障/ },
  { kind: "inverter-local", test: /字样|LOC/ },
  { kind: "decel-source", test: /减速指令/ },
  { kind: "stop-source", test: /牵停信号|牵停指令/ },
  { kind: "screen-fault", test: /屏幕是否有故障提示|具体的故障提示内容/ },
  { kind: "contactor", test: /接触器是否自动吸合/ },
  { kind: "insulation", test: /是否漏电|绝缘状况/ },
  { kind: "voltage", test: /电压是否正常|电压异常|欠电压阈值/ },
  { kind: "terminal", test: /是否有24V|是否有DC24V|短接|万用表/ },
  { kind: "pump", test: /油泵电机是否正常启动/ },
];

const resolveEvidenceKind = (node: DiagnosisNode): EvidenceKind | null =>
  RULES.find((rule) => rule.test.test(node.text))?.kind ?? null;

const pad = (n: number) => String(n).padStart(2, "0");

const fmtClock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const stateOf = (evidence: TractionEvidence, label: string) =>
  evidence.states.find((state) => state.label === label) ?? null;

const stateLine = (evidence: TractionEvidence, label: string) => {
  const state = stateOf(evidence, label);
  return state === null ? [] : [{ label: state.label, value: state.value }];
};

const commandOf = (evidence: TractionEvidence, op: string) =>
  evidence.commandSources.find((item) => item.op === op) ?? null;

const sourceLines = (evidence: TractionEvidence, op: string) => {
  const entry = commandOf(evidence, op);
  if (entry === null || entry.sources.length === 0) {
    return [{ label: op, value: "窗口内无记录" }];
  }
  return entry.sources.map((source) => ({
    label: source.source,
    value: `${source.count} 次${source.lastTs === null ? "" : ` · 最近 ${fmtClock(source.lastTs)}`}`,
  }));
};

const inverterLines = (evidence: TractionEvidence) =>
  evidence.inverters.map((inverter) => ({
    label: inverter.name,
    value: [
      inverter.busVoltageV === null ? null : `母线 ${inverter.busVoltageV} V`,
      inverter.outputFreqHz === null ? null : `${inverter.outputFreqHz} Hz`,
      inverter.outputTorquePct === null ? null : `转矩 ${inverter.outputTorquePct}%Te`,
      inverter.igbtTemp === null ? null : `IGBT ${inverter.igbtTemp}℃`,
      inverter.extFault === true ? "外部故障位=1" : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }));

const buildCard = (kind: EvidenceKind, evidence: TractionEvidence): EvidenceCard | null => {
  const unavailableOf = (topic: RegExp) =>
    evidence.unavailable.find((item) => topic.test(item.topic));
  const chain = evidence.chain;

  switch (kind) {
    case "hpc": {
      const hpc = stateOf(evidence, "HPC 通讯");
      if (hpc === null) {
        return null;
      }
      return {
        tone: "data",
        title: `HPC 通讯当前${hpc.ok ? "正常（绿色）" : "中断（红色）"}`,
        lines: [
          { label: "读数时间", value: evidence.windowLabel.split(" ~ ")[1] ?? "—" },
          ...stateLine(evidence, "牵电状态"),
        ],
        // 只在 q01 那种"绿色/红色"选项上命中；HPC 红色支里问的是指示灯，匹配不上自然不高亮
        recommend: {
          match: hpc.ok ? ["绿色"] : ["红色"],
          why: `系统记录的 HPC 通讯位是${hpc.ok ? "正常" : "中断"}。`,
        },
      };
    }

    case "haul-power": {
      const powered = stateOf(evidence, "牵电状态");
      if (powered === null || powered.ok === null) {
        return null;
      }
      return {
        tone: "data",
        title: `牵电状态当前为${powered.value}`,
        lines: [...inverterLines(evidence)],
        note: "变频器母线电压建立，说明牵引已送电、接触器吸合过。",
        // q04/q24 的选项是「红色（有）」「绿色（无）」，括号里说的是有没有故障提示
        recommend: {
          match: powered.ok ? ["绿色"] : ["红色"],
          why: powered.ok
            ? "牵电状态位为已送电，屏幕上应显示绿色。"
            : "牵电状态位为未送电，与红色提示一致。",
        },
      };
    }

    case "haul-start": {
      const started = stateOf(evidence, "牵启状态");
      const blocked = stateOf(evidence, "泵闭锁牵引");
      const startCmd = commandOf(evidence, "牵启");
      return {
        tone: "data",
        title: started === null ? "读不到牵启状态" : `牵启状态：${started.value}`,
        lines: [
          ...stateLine(evidence, "泵电机"),
          ...(blocked === null ? [] : [{ label: blocked.label, value: blocked.value }]),
          {
            label: "牵启指令",
            value: startCmd === null ? "—" : `窗口内 ${startCmd.totalCount} 次`,
          },
        ],
        recommend:
          started === null || started.ok === null
            ? undefined
            : {
                match: started.ok ? ["已牵启", "绿色"] : ["没反应", "没变化"],
                why: started.ok
                  ? "牵启状态位为已牵启。"
                  : "牵启状态位仍为未牵启，与「按下没反应」一致。",
              },
      };
    }

    case "accel": {
      const accel = commandOf(evidence, "加速");
      const canAccel = chain.verdict === "ok" && (accel?.totalCount ?? 0) > 0;
      return {
        tone: "data",
        title: chain.verdictText,
        lines: [
          {
            label: "加速指令",
            value: accel === null ? "—" : `窗口内 ${accel.totalCount} 次`,
          },
          {
            label: "实测速度",
            value:
              chain.maxSpeedMmin === null
                ? "窗口内无速度记录"
                : `窗口内最高 ${chain.maxSpeedMmin} m/min`,
          },
        ],
        recommend: canAccel
          ? { match: ["可以"], why: "加速指令进了系统，实测速度随之变化。" }
          : undefined,
      };
    }

    case "traction-run": {
      const direction = stateOf(evidence, "牵引方向");
      const moving = (chain.maxSpeedMmin ?? 0) >= 0.1;
      return {
        tone: "data",
        title: chain.verdictText,
        lines: [
          ...(direction === null ? [] : [{ label: direction.label, value: direction.value }]),
          {
            label: "三段链",
            value: `操作 ${chain.inputCount} 次 · 主控输出 ${chain.outputCount} 次 · 速度变化 ${chain.movedCount} 次`,
          },
          {
            label: "最高速度",
            value: chain.maxSpeedMmin === null ? "—" : `${chain.maxSpeedMmin} m/min`,
          },
        ],
        recommend: moving
          ? { match: ["已牵引"], why: "窗口内实测速度确实起来了，牵引动作到位。" }
          : undefined,
      };
    }

    case "direction": {
      const direction = stateOf(evidence, "牵引方向");
      const hasDirection = direction?.ok === true;
      return {
        tone: "data",
        title: hasDirection
          ? `方向指令已进入系统（${direction?.value}）`
          : "系统当前没有方向状态",
        lines: [
          ...sourceLines(evidence, "牵启"),
          {
            label: "实测速度",
            value: chain.maxSpeedMmin === null ? "—" : `窗口内最高 ${chain.maxSpeedMmin} m/min`,
          },
        ],
        note: "选项 1 是屏幕仍提示「请设定牵引方向」，选项 2 是方向显示了但机器不走。",
        recommend: hasDirection
          ? { match: ["2"], why: "向左/向右状态位已置起，说明方向指令进了系统。" }
          : undefined,
      };
    }

    case "inverter-fault":
    case "screen-fault": {
      const faults = evidence.activeFaults;
      const extFault = evidence.inverters.some((inverter) => inverter.extFault === true);
      const hasFault = faults.length > 0 || extFault;
      return {
        tone: "data",
        title: hasFault
          ? `当前有 ${faults.length} 条牵引相关激活故障`
          : "当前没有牵引相关激活故障",
        lines: hasFault
          ? faults.slice(0, 5).map((fault) => ({
              label: fault.type === 2 ? "停机" : "警告",
              value: `${fault.name} · ${fmtClock(fault.occurTs)}`,
            }))
          : inverterLines(evidence),
        note: hasFault
          ? "变频器自身的故障码要到变频器面板或「故障代码查询 → ACS880」里对照。"
          : "系统侧没抓到牵引类故障；变频器面板上的码不回传，仍需到观察窗口确认。",
        recommend: {
          match: hasFault ? ["有故障"] : ["无故障"],
          why: hasFault
            ? "实时故障流里有牵引/变频器相关的激活条目。"
            : "实时故障流里没有牵引相关激活条目。",
        },
      };
    }

    case "decel-source": {
      const decel = commandOf(evidence, "减速");
      return {
        tone: "data",
        title:
          decel === null || decel.totalCount === 0
            ? "窗口内没有减速指令记录"
            : `窗口内减速指令 ${decel.totalCount} 次，来源如下`,
        lines: sourceLines(evidence, "减速"),
        note: "这就是结论里说的「按键功能测试查减速指令来源」。某一来源反复出现，先查那个按钮是不是卡死。",
      };
    }

    case "stop-source": {
      const stop = commandOf(evidence, "牵停");
      const locked =
        stateOf(evidence, "牵停锁定")?.ok === false || stateOf(evidence, "急停锁定")?.ok === false;
      return {
        tone: "data",
        title: locked
          ? "系统处于牵停/急停锁定，需要复位"
          : stop === null || stop.totalCount === 0
            ? "窗口内没有牵停指令记录"
            : `窗口内牵停指令 ${stop.totalCount} 次，来源如下`,
        lines: [
          ...sourceLines(evidence, "牵停"),
          ...stateLine(evidence, "牵停锁定"),
          ...stateLine(evidence, "急停锁定"),
        ],
        note: "来源写「自动截割」或「上位机」的多是系统内部保护发的，先查变频器有没有故障。",
        recommend: locked
          ? { match: ["有"], why: "锁定位已置起，属于持续存在的牵停条件。" }
          : undefined,
      };
    }

    case "contactor": {
      const item = unavailableOf(/牵引接触器/);
      const powered = stateOf(evidence, "牵电状态");
      const busUp = evidence.inverters.some(
        (inverter) => inverter.busVoltageV !== null && inverter.busVoltageV > 400,
      );
      return {
        tone: "data",
        title: busUp
          ? "变频器母线电压已建立，接触器吸合过"
          : "变频器母线电压没建立，接触器多半没吸合",
        lines: [
          ...(powered === null ? [] : [{ label: powered.label, value: powered.value }]),
          ...inverterLines(evidence),
        ],
        note: item?.reason ?? "牵引接触器没有独立反馈位，这里用母线电压当旁证。",
        recommend: busUp
          ? { match: ["吸合"], why: "母线电压已建立，说明变频器前级已送电。" }
          : undefined,
      };
    }

    case "pump": {
      const pump = stateOf(evidence, "泵电机");
      if (pump === null || pump.ok === null) {
        return null;
      }
      return {
        tone: "data",
        title: `泵电机当前${pump.value}`,
        lines: stateLine(evidence, "泵闭锁牵引"),
        recommend: {
          match: pump.ok ? ["正常"] : ["没有"],
          why: pump.ok ? "泵运行状态位为运行中。" : "泵运行状态位为未运行。",
        },
      };
    }

    case "voltage": {
      const item = unavailableOf(/控制变压器|端子/);
      return {
        tone: "none",
        title: "供电电压要现场实测",
        lines: inverterLines(evidence),
        note:
          item?.reason ??
          "控制变压器与电网侧电压没有采集点，必须万用表实测。上面的母线电压只反映变频器直流侧。",
      };
    }

    case "insulation": {
      const item = unavailableOf(/绝缘/);
      return {
        tone: "none",
        title: "绝缘与漏电必须现场摇测",
        lines: [],
        note: item?.reason ?? "摇表数据不进系统。注意：摇绝缘前必须断开与变频器的连接。",
      };
    }

    case "inverter-local": {
      const item = unavailableOf(/LOC/);
      return {
        tone: "none",
        title: "变频器面板状态不回传",
        lines: inverterLines(evidence),
        note: item?.reason ?? "本地/远程（LOC/REM）只能到变频器观察窗口看。",
      };
    }

    case "terminal": {
      return {
        tone: "none",
        title: "端子电压与短接测试必须现场做",
        lines: stateLine(evidence, "HPC 通讯"),
        note: "端子级电压没有采集点。注意：短接属危险电压操作，按矿方规程执行。",
      };
    }

    default:
      return null;
  }
};

/** 结论页复盘：牵引三段现状 + 松闸链 + 左右对称，换件前再核一眼。 */
const buildResultCard = (evidence: TractionEvidence): EvidenceCard => ({
  tone: "data",
  title: "结论前再核一眼数据",
  lines: [
    { label: "三段链", value: evidence.chain.verdictText },
    { label: "松闸链", value: evidence.brake.text },
    ...evidence.loadBalance.map((item) => ({
      label: item.label,
      value: `左 ${item.left}${item.unit} · 右 ${item.right}${item.unit}`,
    })),
    ...inverterLines(evidence),
  ],
  note: "左右负荷/转矩长期偏差大，说明主从同步跑偏，处理完当前故障要顺带查。",
});

export const tractionProvider = {
  cardForNode: (node: DiagnosisNode, evidence: TractionEvidence): EvidenceCard | null => {
    if (node.type === "result") {
      return buildResultCard(evidence);
    }
    const kind = resolveEvidenceKind(node);
    return kind === null ? null : buildCard(kind, evidence);
  },
};
