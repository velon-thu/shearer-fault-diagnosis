"use client";

import {
  FaultCodeResultSchema,
  InternalFaultRulesSchema,
  createApiSuccessResponseSchema,
  type FaultRuleItem,
} from "@shearer/contracts";
import { useEffect, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";

const FaultCodeResultApiResponseSchema = createApiSuccessResponseSchema(FaultCodeResultSchema);
const InternalFaultRulesApiResponseSchema = createApiSuccessResponseSchema(InternalFaultRulesSchema);

const resolveHttpBase = () => {
  if (typeof window === "undefined") {
    return "";
  }

  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }

  const { protocol, hostname, port } = window.location;

  if ((hostname === "localhost" || hostname === "127.0.0.1") && port === "3000") {
    return `${protocol}//${hostname}:18080`;
  }

  return `${protocol}//${window.location.host}`;
};

const TYPE_TEXT = ["提示", "警告", "停机"];

/** 弹窗内容 */
type ModalContent = {
  code: string;
  title: string;
  description?: string;
  suggestions?: string[];
  notFound?: boolean;
};

/**
 * 变频器故障：mock 占位数据。
 * TODO: 等变频器故障代码仓库到位后替换（系统/内部故障已接真实解析）。
 */
type FaultEntry = { code: string; name: string; description: string; suggestions: string[] };

const INVERTER_FAULTS: FaultEntry[] = [
  { code: "0x0001", name: "变频器过流保护", description: "输出电流瞬时超过保护阈值。", suggestions: ["检查电机及电缆是否短路或绝缘下降。", "检查负载是否突变或卡死。", "复位后重新启动，记录发生工况。"] },
  { code: "0x0002", name: "母线过压保护", description: "直流母线电压超过上限，常见于制动能量回馈过大。", suggestions: ["检查供电电压是否偏高。", "检查制动单元与制动电阻。", "适当延长减速时间。"] },
  { code: "0x0003", name: "母线欠压保护", description: "直流母线电压低于下限。", suggestions: ["检查供电电压与上级开关。", "检查整流模块。", "确认供电容量满足要求。"] },
  { code: "0x0004", name: "IGBT过温保护", description: "功率模块温度超过保护阈值。", suggestions: ["检查冷却水路流量与水温。", "清理散热器。", "降低负载运行观察温升。"] },
  { code: "0x0005", name: "输出缺相保护", description: "变频器输出侧检测到缺相。", suggestions: ["检查输出电缆与接线端子。", "检查电机接线盒。", "测量三相输出平衡度。"] },
  { code: "0x0006", name: "输入缺相保护", description: "变频器输入侧检测到缺相。", suggestions: ["检查输入电缆及上级开关。", "检查快速熔断器。", "测量三相输入电压。"] },
  { code: "0x0007", name: "接地故障保护", description: "检测到输出对地漏电流超限。", suggestions: ["检查电机与电缆对地绝缘。", "排查水汽侵入。", "绝缘恢复后复位。"] },
  { code: "0x0008", name: "电机过载保护", description: "电机热模型累计过载。", suggestions: ["检查负载是否长期偏重。", "核对电机额定参数设置。", "冷却后复位启动。"] },
  { code: "0x0009", name: "变频器过载保护", description: "变频器输出能力累计过载。", suggestions: ["降低负载或牵引速度。", "检查变频器容量匹配。", "检查散热条件。"] },
  { code: "0x000A", name: "编码器故障", description: "速度反馈信号丢失或异常。", suggestions: ["检查编码器接线与屏蔽。", "检查编码器供电。", "必要时更换编码器。"] },
  { code: "0x000B", name: "通讯超时故障", description: "变频器与主控通讯超时。", suggestions: ["检查通讯电缆与终端电阻。", "检查通讯参数设置。", "重启变频器观察。"] },
  { code: "0x000C", name: "参数校验失败", description: "参数存储区校验错误。", suggestions: ["恢复出厂参数后重新设置。", "记录故障前的参数操作。", "反复出现需更换控制板。"] },
  { code: "0x000D", name: "预充电故障", description: "上电预充电过程未完成。", suggestions: ["检查预充电回路与接触器。", "检查母线电容状态。", "测量预充电电阻。"] },
  { code: "0x000E", name: "风机故障", description: "冷却风机运行异常。", suggestions: ["检查风机供电与转动是否卡阻。", "清理风道。", "更换故障风机。"] },
  { code: "0x000F", name: "制动单元故障", description: "制动斩波器回路异常。", suggestions: ["检查制动电阻阻值。", "检查制动单元接线。", "复位后监测母线电压。"] },
  { code: "0x0010", name: "载波频率降额", description: "高温下自动降低载波频率。", suggestions: ["改善散热条件。", "属于自动保护，可继续运行。", "持续出现需检查冷却系统。"] },
  { code: "0x0011", name: "对地短路保护", description: "上电自检检测到对地短路。", suggestions: ["断开电机电缆分段排查。", "测量电机对地绝缘。", "排除后重新上电。"] },
  { code: "0x0012", name: "温度传感器异常", description: "模块温度采样信号异常。", suggestions: ["检查温度传感器接插件。", "记录故障出现频次。", "反复出现需更换驱动板。"] },
  { code: "0x0013", name: "母线电容老化预警", description: "母线电容容量下降预警。", suggestions: ["安排检修窗口更换电容。", "监测母线电压纹波。", "避免频繁启停。"] },
  { code: "0x00FF", name: "未知内部故障", description: "变频器内部未定义故障码。", suggestions: ["记录完整故障码并联系厂家。", "断电 5 分钟后重新上电。", "反复出现需返厂检测。"] },
];

const KEY_ROWS: string[][] = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
];

type Category = "system" | "inverter";
type ViewMode = "menu" | "grid" | "custom";

export default function FaultCodesPage() {
  const shellState = useAppShellState();
  const [view, setView] = useState<ViewMode>("menu");
  const [category, setCategory] = useState<Category>("system");
  const [bocHpcRules, setBocHpcRules] = useState<FaultRuleItem[]>([]);
  const [modal, setModal] = useState<ModalContent | null>(null);
  const [input, setInput] = useState("");
  const [searching, setSearching] = useState(false);

  // 内部故障目录（BOC/HPC 现成解析条目）
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(`${resolveHttpBase()}/api/internal-fault-rules`, {
          cache: "no-store",
        });
        const parsed = InternalFaultRulesApiResponseSchema.parse(await response.json());
        if (!cancelled) {
          setBocHpcRules(parsed.data.bocHpc);
        }
      } catch {
        // 目录加载失败时方块区为空，自定义查询仍可用
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const openCategory = (next: Category) => {
    setCategory(next);
    setView("grid");
  };

  // 系统（内部）故障：常用 20 条取 BOC/HPC 目录前 20
  const systemTiles = bocHpcRules.slice(0, 20);

  const openSystemTile = (rule: FaultRuleItem) => {
    setModal({
      code: String(rule.code),
      title: rule.name,
      description: `BOC/HPC 内部故障目录条目 · 级别：${TYPE_TEXT[rule.type] ?? rule.type}`,
    });
  };

  const openInverterTile = (fault: FaultEntry) => {
    setModal({
      code: fault.code,
      title: fault.name,
      description: fault.description,
      suggestions: fault.suggestions,
    });
  };

  // 自定义查询
  const lookupCustom = async () => {
    const typed = input.trim();
    if (!typed) {
      return;
    }

    if (category === "inverter") {
      const normalized = typed.toUpperCase();
      const hit = INVERTER_FAULTS.find((f) => f.code.toUpperCase() === normalized || f.code.toUpperCase() === `0X${normalized}`.replace("0X0X", "0X"));
      setModal(
        hit
          ? { code: hit.code, title: hit.name, description: hit.description, suggestions: hit.suggestions }
          : { code: typed.toUpperCase(), title: "未找到该故障代码", description: "当前变频器故障库中没有此代码，请核对后重新输入。", notFound: true },
      );
      return;
    }

    // 系统（内部）故障：后端三级解析——BOC/HPC 表 → 0x22xx~0x26xx → MOC 位解析
    try {
      setSearching(true);
      const response = await fetch(
        `${resolveHttpBase()}/api/fault-codes/search?category=inverter&code=${encodeURIComponent(typed)}`,
        { cache: "no-store" },
      );
      const parsed = FaultCodeResultApiResponseSchema.parse(await response.json());
      const result = parsed.data;
      setModal(
        result.found
          ? {
              code: typed.toUpperCase(),
              title: result.description ?? "解析成功",
              description: result.tip ?? undefined,
            }
          : {
              code: typed.toUpperCase(),
              title: "无法解析该代码",
              description: "该代码不在 BOC/HPC 故障表中，也不符合停机操作码与 MOC 码的解析规则，视为无效代码。",
              notFound: true,
            },
      );
    } catch {
      setModal({
        code: typed.toUpperCase(),
        title: "查询失败",
        description: "查询服务暂不可用，请确认服务已启动。",
        notFound: true,
      });
    } finally {
      setSearching(false);
    }
  };

  const categoryTitle = category === "system" ? "系统故障代码查询" : "变频器故障代码查询";

  return (
    <AppShell hideFloatingHome={view === "custom"} shellState={shellState} title="故障代码查询">
      <section className="page active">
        {view === "menu" ? (
          /* ===== 入口：二选一 ===== */
          <div className="fc-menu">
            <button className="fc-menu-card" onClick={() => openCategory("system")} type="button">
              <span className="fc-menu-icon" style={{ background: "linear-gradient(180deg, #54a5ff, #2e6be6)" }}>系</span>
              <span className="fc-menu-title">系统故障代码查询</span>
            </button>
            <button className="fc-menu-card" onClick={() => openCategory("inverter")} type="button">
              <span className="fc-menu-icon" style={{ background: "linear-gradient(180deg, #ffb03a, #f07b22)" }}>变</span>
              <span className="fc-menu-title">变频器故障代码查询</span>
            </button>
          </div>
        ) : view === "grid" ? (
          /* ===== 常见故障代码方块 ===== */
          <>
            <div className="sensor-detail-head">
              <button className="sensor-back-btn" onClick={() => setView("menu")} type="button">
                ‹ 返回
              </button>
              <h1 className="sensor-detail-title">{categoryTitle}</h1>
            </div>
            <div className="fc-grid">
              {category === "system"
                ? systemTiles.map((rule) => (
                    <button
                      className="fc-tile"
                      key={rule.code}
                      onClick={() => openSystemTile(rule)}
                      type="button"
                    >
                      <span className="fc-tile-code">{rule.code}</span>
                      <span className="fc-tile-name">{rule.name}</span>
                    </button>
                  ))
                : INVERTER_FAULTS.map((fault) => (
                    <button
                      className="fc-tile"
                      key={fault.code}
                      onClick={() => openInverterTile(fault)}
                      type="button"
                    >
                      <span className="fc-tile-code">{fault.code}</span>
                      <span className="fc-tile-name">{fault.name}</span>
                    </button>
                  ))}
            </div>
            <div className="sensor-pager" style={{ justifyContent: "center" }}>
              <button
                className="sensor-settings-btn"
                onClick={() => {
                  setInput("");
                  setView("custom");
                }}
                type="button"
              >
                自定义故障查询
              </button>
            </div>
          </>
        ) : (
          /* ===== 自定义查询：大键盘 + 规则提示 ===== */
          <>
            <div className="sensor-detail-head">
              <button className="sensor-back-btn" onClick={() => setView("grid")} type="button">
                ‹ 返回
              </button>
              <h1 className="sensor-detail-title">{categoryTitle} · 自定义</h1>
            </div>
            <div className="fc-custom">
              {category === "system" ? (
                <div className="fc-rules">
                  <div className="fc-rules-item">
                    <strong>① 直接查表</strong>
                    输入十进制代码（如 17），命中 BOC/HPC 故障表直接给出含义
                  </div>
                  <div className="fc-rules-item">
                    <strong>② 停机操作码 0x22xx ~ 0x26xx</strong>
                    高8位=来源（22左端头站 · 23右端头站 · 24左遥控器 · 25右遥控器 · 26顺槽远程），
                    低8位=命令（Bit7急停 · Bit6总停 · Bit5左截停 · Bit4右截停 · Bit3破停 · Bit1泵停）
                  </div>
                  <div className="fc-rules-item">
                    <strong>③ MOC 码按二进制解析</strong>
                    Bit15~9=来源代码（查系统代码表），Bit8~0=停止代码
                    （Bit0左截停 · Bit1右截停 · Bit2泵停 · Bit3破碎停 · Bit4牵引停 · Bit7总停 · Bit8断电急停）
                  </div>
                </div>
              ) : null}
              <div className="fc-input-display">{input || "请输入故障代码"}</div>
              <div className="fc-keyboard">
                {KEY_ROWS.map((row, rowIndex) => (
                  <div className="fc-key-row" key={rowIndex}>
                    {row.map((key) => (
                      <button
                        className="fc-key"
                        key={key}
                        onClick={() => setInput((v) => (v.length < 12 ? v + key : v))}
                        type="button"
                      >
                        {key}
                      </button>
                    ))}
                  </div>
                ))}
                <div className="fc-key-row">
                  <button className="fc-key fc-key-wide" onClick={() => setInput("")} type="button">
                    清空
                  </button>
                  <button
                    className="fc-key fc-key-wide"
                    onClick={() => setInput((v) => v.slice(0, -1))}
                    type="button"
                  >
                    ⌫ 删除
                  </button>
                  <button
                    className="fc-key fc-key-confirm"
                    disabled={!input.trim() || searching}
                    onClick={() => void lookupCustom()}
                    type="button"
                  >
                    {searching ? "解析中…" : "确 认"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ===== 详情弹窗（点击外部收起） ===== */}
        {modal ? (
          <div className="fc-modal-backdrop" onClick={() => setModal(null)}>
            <div className="fc-modal" onClick={(event) => event.stopPropagation()}>
              <div className="fc-modal-head">
                <span className="fc-modal-code">{modal.code}</span>
                <h2 className="fc-modal-title">{modal.title}</h2>
              </div>
              {modal.description ? <p className="fc-modal-desc">{modal.description}</p> : null}
              {modal.suggestions && modal.suggestions.length > 0 ? (
                <>
                  <div className="fc-modal-sub">处理建议</div>
                  <ol className="fc-modal-suggestions">
                    {modal.suggestions.map((tip, index) => (
                      <li key={index}>{tip}</li>
                    ))}
                  </ol>
                </>
              ) : null}
              <button className="fc-modal-close" onClick={() => setModal(null)} type="button">
                关 闭
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
