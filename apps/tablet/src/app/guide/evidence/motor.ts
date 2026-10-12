/**
 * 电机启停故障诊断树的节点 ←→ 机器数据绑定。
 *
 * 四棵树里这一棵对得最直：诊断树一路问"有没有启动提示 → 电机起没起 → 能不能持续
 * 运转 → 是不是漏电 → 接触器吸没吸合"，而共享内存里每台电机恰好就是这五个状态位
 * （启动预警 / 启动过程中 / 接触器吸合 / 运行中 / 漏电闭锁），一问一位。
 *
 * 四个模块各自盯一台电机（自启动油泵那一支盯泵 + HPC），所以绑定要看当前模块。
 *
 * 公共规矩不变：只提示不代选；端子电压、短接试吸合、绝缘摇测一律写明现场实测。
 * 尤其"短接"是高风险带电操作，卡片里必须原样保留安全提醒，不能显得像可以随手做。
 */
import type { DiagnosisNode, MotorEvidence, MotorUnit } from "@shearer/contracts";
import type { EvidenceCard } from "./types";

type EvidenceKind =
  | "start-prompt" // 按下启动按钮后有没有启动提示
  | "started" // 提示结束后电机起没起
  | "holding" // 能否持续平稳运转
  | "faults" // 屏幕上有没有故障提示
  | "leak" // 漏电提示
  | "insulation" // 绝缘摇测
  | "stop-source" // 停止信号来自哪里
  | "button-stuck" // 按钮是否卡死
  | "pump-lock" // 牵引/截割被泵电机闭锁
  | "contactor" // 接触器是否吸合（自启动油泵）
  | "hpc" // HPC 状态
  | "voltage" // 控制变压器电压
  | "jumper" // 短接试吸合
  | "terminal"; // 端子 24V

// 正则锚定"这一问实际在问什么"。短接/端子类要排在接触器类之前，
// 因为那些节点正文里也会出现"接触器是否吸合"。
const RULES: Array<{ kind: EvidenceKind; test: RegExp }> = [
  // 控制变压器要排在短接之前：那几问的正文以"短接后接触器不吸合"开头，
  // 但真正问的是控制变压器输出电压。
  { kind: "voltage", test: /控制变压器/ },
  { kind: "jumper", test: /短接/ },
  { kind: "terminal", test: /是否有F\+24V|是否有DV24V|上是否有DV24V|F\+24V电压/ },
  { kind: "insulation", test: /绝缘状况|对地绝缘/ },
  { kind: "leak", test: /是否提示.*漏电|还是.*漏电/ },
  { kind: "button-stuck", test: /是否卡死/ },
  { kind: "stop-source", test: /停止信号可能来自|有停止信号进入控制系统/ },
  { kind: "start-prompt", test: /是否有.*启动提示|无.*启动提示/ },
  { kind: "started", test: /是否正常启动/ },
  { kind: "holding", test: /是否可以持续平稳运转/ },
  { kind: "pump-lock", test: /被泵电机闭锁/ },
  { kind: "hpc", test: /HPC的状态是否为绿色|HPC状态是否为绿色/ },
  { kind: "contactor", test: /接触器是否.*吸合|接触器是否自动吸合/ },
  { kind: "faults", test: /是否有故障提示|是否有电压异常或漏电提示/ },
];

const resolveEvidenceKind = (node: DiagnosisNode): EvidenceKind | null =>
  RULES.find((rule) => rule.test.test(node.text))?.kind ?? null;

// 模块 → 这一支在排查哪台电机
const MOTOR_BY_MODULE: Record<string, string[]> = {
  height_pump_start_stop: ["pump"],
  cutting_motor_start: ["left-cutter", "right-cutter"],
  crusher_motor_start: ["crusher"],
  auto_oil_pump: ["pump"],
};

const pad = (n: number) => String(n).padStart(2, "0");

const fmtClock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const motorsOf = (evidence: MotorEvidence, moduleId: string): MotorUnit[] => {
  const ids = MOTOR_BY_MODULE[moduleId] ?? [];
  return evidence.motors.filter((motor) => ids.includes(motor.id));
};

const stageOf = (motor: MotorUnit, label: string) =>
  motor.stages.find((stage) => stage.label === label) ?? null;

const stageLines = (motors: MotorUnit[], labels: string[]) =>
  motors.flatMap((motor) =>
    labels.map((label) => {
      const stage = stageOf(motor, label);
      return {
        label: `${motor.name} · ${label}`,
        value:
          stage === null
            ? "读不到"
            : `${stage.on === null ? "读不到" : stage.on ? "置起" : "未置起"}${
                stage.onCount > 0
                  ? ` · 窗口内 ${stage.onCount} 次${
                      stage.lastOnTs === null ? "" : `，最近 ${fmtClock(stage.lastOnTs)}`
                    }`
                  : ""
              }`,
      };
    }),
  );

const sourceLines = (
  entries: MotorEvidence["stopSources"],
  ops: string[],
): Array<{ label: string; value: string }> => {
  const rows = entries
    .filter((entry) => ops.includes(entry.op) && entry.totalCount > 0)
    .flatMap((entry) =>
      entry.sources.map((source) => ({
        label: `${entry.op} · ${source.source}`,
        value: `${source.count} 次${source.lastTs === null ? "" : ` · 最近 ${fmtClock(source.lastTs)}`}`,
      })),
    );
  return rows.length > 0 ? rows : [{ label: "窗口内", value: "没有相关指令记录" }];
};

// 未配备的电机（本机破碎机五位全 0）统一走这张卡，不硬给结论
const notInstalledCard = (motors: MotorUnit[]): EvidenceCard => ({
  tone: "none",
  title: `${motors.map((motor) => motor.name).join("、")}在本机判为未配备`,
  lines: [],
  note: motors[0]?.verdictText ?? "该电机的状态位全程为 0，数据帮不上忙，按现场实际情况作答。",
});

const buildCard = (
  kind: EvidenceKind,
  evidence: MotorEvidence,
  moduleId: string,
): EvidenceCard | null => {
  const motors = motorsOf(evidence, moduleId);
  const unavailableOf = (topic: RegExp) =>
    evidence.unavailable.find((item) => topic.test(item.topic));
  const someInstalled = motors.some((motor) => motor.installed);
  const needsMotor = ["start-prompt", "started", "holding", "leak", "contactor"];
  if (needsMotor.includes(kind) && motors.length > 0 && !someInstalled) {
    return notInstalledCard(motors);
  }

  switch (kind) {
    case "start-prompt": {
      const lines = stageLines(motors, ["启动预警", "启动过程中"]);
      const prompted = motors.some(
        (motor) =>
          (stageOf(motor, "启动预警")?.onCount ?? 0) > 0 ||
          (stageOf(motor, "启动过程中")?.onCount ?? 0) > 0,
      );
      const noStartCmd = unavailableOf(/启动类指令记录/);
      return {
        tone: "data",
        title: prompted
          ? "窗口内有启动提示记录（启动预警/启动过程中位置起过）"
          : "窗口内没有启动提示记录",
        lines,
        note: noStartCmd?.reason,
        recommend: prompted
          ? { match: ["有"], why: "系统的启动预警与启动过程位在窗口内置起过，说明启动命令已经开始执行。" }
          : undefined,
      };
    }

    case "started": {
      const running = motors.some((motor) => motor.verdict === "ok");
      return {
        tone: "data",
        title: motors.map((motor) => motor.verdictText).join(" "),
        lines: stageLines(motors, ["接触器吸合", "运行中"]),
        recommend: running
          ? { match: ["已启动"], why: "运行中状态位当前是置起的。" }
          : undefined,
      };
    }

    case "holding": {
      const lines = motors.map((motor) => ({
        label: motor.name,
        value: `窗口内累计运行 ${Math.round((motor.runSeconds ?? 0) / 60)} 分钟 · 掉停 ${motor.restartCount} 次`,
      }));
      const steady = motors.every(
        (motor) => motor.restartCount === 0 && (motor.runSeconds ?? 0) > 0,
      );
      const flappy = motors.some((motor) => motor.restartCount >= 3);
      return {
        tone: "data",
        title: steady
          ? "窗口内没有中途掉停"
          : flappy
            ? "窗口内多次起来又掉，符合「接触器吸合后又断开」的表现"
            : "窗口内有过掉停",
        lines: [
          ...lines,
          ...motors.map((motor) => ({
            label: `${motor.name}电流/负荷`,
            value: `${motor.currentA ?? "—"} A · ${motor.loadPct ?? "—"}% · ${motor.tempC ?? "—"}℃`,
          })),
        ],
        note: "掉停次数只统计运行位由 1 变 0，正常停机操作也会计入，要结合停止指令来源一起看。",
        recommend: steady
          ? { match: ["可以"], why: "运行位在窗口内没有掉过。" }
          : undefined,
      };
    }

    case "faults": {
      const faults = evidence.activeFaults;
      return {
        tone: "data",
        title:
          faults.length > 0
            ? `当前有 ${faults.length} 条电机相关激活故障`
            : "当前没有电机相关激活故障",
        lines: faults.slice(0, 6).map((fault) => ({
          label: fault.type === 2 ? "停机" : "警告",
          value: `${fault.name} · ${fmtClock(fault.occurTs)}`,
        })),
        note: "屏幕监视画面不一定显示全部故障，仍要进故障查询核对。",
        recommend: {
          match: faults.length > 0 ? ["有故障"] : ["无故障"],
          why:
            faults.length > 0
              ? "实时故障流里有电机相关的激活条目。"
              : "实时故障流里没有电机相关的激活条目。",
        },
      };
    }

    case "leak": {
      const leaky = motors.filter((motor) => stageOf(motor, "漏电闭锁")?.on === true);
      return {
        tone: "data",
        title:
          leaky.length > 0
            ? `${leaky.map((motor) => motor.name).join("、")}漏电闭锁位已置起`
            : "相关电机的漏电闭锁位都没有置起",
        lines: stageLines(motors, ["漏电闭锁"]),
        note: "漏电闭锁位只说明系统认定漏电，是不是真漏电要现场摇测绝缘才算数。",
      };
    }

    case "insulation": {
      const item = unavailableOf(/绝缘/);
      return {
        tone: "none",
        title: "绝缘必须现场实测",
        lines: [],
        note:
          item?.reason ??
          "绝缘数据不进系统。注意：220V 对地绝缘用万用表直接量，严禁使用摇表。",
      };
    }

    case "stop-source": {
      return {
        tone: "data",
        title: "窗口内的停止类指令来源",
        lines: sourceLines(evidence.stopSources, ["总停", "急停", "泵停", "左截停", "右截停", "破停"]),
        note: "这正是这一问要查的「停止信号来自哪里」。来源集中在某个操作台，就先查那一路。",
      };
    }

    case "button-stuck": {
      const item = unavailableOf(/按钮/);
      return {
        tone: "none",
        title: "按钮卡死与否要现场看",
        lines: sourceLines(evidence.stopSources, ["总停", "泵停", "左截停", "右截停", "破停"]),
        note:
          item?.reason ??
          "按钮机械状态不回传。上面是同期停止指令的来源分布，某一路反复出现可作为卡死的旁证。",
      };
    }

    case "pump-lock": {
      const flags = evidence.flags.filter((flag) => flag.on !== null);
      const locked = flags.some((flag) => flag.on === true);
      return {
        tone: "data",
        title: locked ? "系统当前有闭锁提示" : "系统当前没有闭锁提示",
        lines: flags.map((flag) => ({
          label: flag.label,
          value: flag.on ? "有提示" : "无",
        })),
        recommend: {
          match: locked ? ["有"] : ["没有"],
          why: locked
            ? "闭锁状态位已置起，说明接触器吸合反馈没进系统。"
            : "闭锁状态位都没置起，系统允许继续操作。",
        },
      };
    }

    case "contactor": {
      const on = motors.some((motor) => stageOf(motor, "接触器吸合")?.on === true);
      return {
        tone: "data",
        title: on ? "接触器吸合位当前置起" : "接触器吸合位当前未置起",
        lines: stageLines(motors, ["接触器吸合", "运行中"]),
        recommend: {
          match: on ? ["吸合"] : ["不吸合"],
          why: on ? "接触器吸合状态位是置起的。" : "接触器吸合状态位没有置起。",
        },
      };
    }

    case "hpc": {
      const hpc = evidence.moduleOk.find((module) => module.name === "HPC");
      if (!hpc) {
        return null;
      }
      return {
        tone: "data",
        title: `HPC 通讯当前${hpc.ok ? "正常（绿色）" : "中断"}`,
        lines: evidence.moduleOk.map((module) => ({
          label: module.name,
          value: module.ok ? "在线" : "离线",
        })),
        recommend: {
          match: hpc.ok ? ["绿色"] : ["红或黄"],
          why: `系统记录的 HPC 通讯位是${hpc.ok ? "正常" : "中断"}。`,
        },
      };
    }

    case "voltage": {
      const item = unavailableOf(/控制变压器/);
      return {
        tone: "none",
        title: "控制电源电压要现场实测",
        lines: [],
        note: item?.reason ?? "控制变压器 132V/220V 没有采集点，必须万用表实测。",
      };
    }

    case "jumper": {
      const item = unavailableOf(/短接/);
      return {
        tone: "none",
        title: "短接试吸合是高风险带电操作",
        lines: stageLines(motors, ["接触器吸合"]),
        note:
          item?.reason ??
          "短接属高风险带电操作，数据无法替代，须按矿方规程由有资质人员执行。",
      };
    }

    case "terminal": {
      return {
        tone: "none",
        title: "MOC 端子电压必须实测",
        lines: evidence.moduleOk.map((module) => ({
          label: module.name,
          value: module.ok ? "在线" : "离线",
        })),
        note: "端子级电压没有采集点。模块通讯在线只说明模块还活着，不代表端口没坏。",
      };
    }

    default:
      return null;
  }
};

/** 结论页复盘：四台电机的启动链现状，换件前再核一眼。 */
const buildResultCard = (evidence: MotorEvidence, moduleId: string): EvidenceCard => {
  const scoped = motorsOf(evidence, moduleId);
  const motors = scoped.length > 0 ? scoped : evidence.motors;
  return {
    tone: "data",
    title: "结论前再核一眼数据",
    lines: motors.map((motor) => ({
      label: motor.name,
      value: motor.verdictText,
    })),
    note: "掉停次数偏高、但每次都能重新起来的，多半是控制回路虚接或接触器吸持不良，换件前先复查线路。",
  };
};

export const motorProvider = {
  cardForNode: (
    node: DiagnosisNode,
    moduleId: string,
    evidence: MotorEvidence,
  ): EvidenceCard | null => {
    if (node.type === "result") {
      return buildResultCard(evidence, moduleId);
    }
    const kind = resolveEvidenceKind(node);
    return kind === null ? null : buildCard(kind, evidence, moduleId);
  },
};
