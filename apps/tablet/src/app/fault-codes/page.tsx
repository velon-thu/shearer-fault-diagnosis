"use client";

import {
  FaultCodeResultSchema,
  InternalFaultRulesSchema,
  createApiSuccessResponseSchema,
  type FaultRuleItem,
} from "@shearer/contracts";
import { useEffect, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";
import { ACS880_FAULTS, type Acs880Fault } from "./acs880-faults";

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

// 系统（内部）故障对用户一律以十六进制呈现
const toHex = (code: number) => `0x${code.toString(16).toUpperCase().padStart(4, "0")}`;

/** 弹窗内容 */
type ModalContent = {
  code: string;
  title: string;
  description?: string;
  suggestions?: string[];
  notFound?: boolean;
};

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
  const [input, setInput] = useState("0x");
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
      code: toHex(rule.code),
      title: rule.name,
      description: `BOC/HPC 内部故障目录条目 · 级别：${TYPE_TEXT[rule.type] ?? rule.type}`,
    });
  };

  const openAcs880 = (fault: Acs880Fault) => {
    setModal({
      code: fault.code,
      title: fault.title,
      suggestions: fault.advice,
    });
  };

  // 自定义查询（仅系统/内部故障）：后端三级解析——BOC/HPC 表 → 0x22xx~0x26xx → MOC 位解析
  const lookupCustom = async () => {
    const typed = input.trim();
    if (!typed || typed.toLowerCase() === "0x") {
      return;
    }

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
              code: typed.toUpperCase().replace(/^0X/, "0x"),
              title: result.description ?? "解析成功",
              description: result.tip ?? undefined,
            }
          : {
              code: typed.toUpperCase().replace(/^0X/, "0x"),
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
          category === "system" ? (
            /* ===== 系统故障：常用代码方块（十六进制显示） ===== */
            <>
              <div className="sensor-detail-head">
                <button className="sensor-back-btn" onClick={() => setView("menu")} type="button">
                  ‹ 返回
                </button>
                <h1 className="sensor-detail-title">系统故障代码查询</h1>
              </div>
              <div className="fc-grid">
                {systemTiles.map((rule) => (
                  <button
                    className="fc-tile"
                    key={rule.code}
                    onClick={() => openSystemTile(rule)}
                    type="button"
                  >
                    <span className="fc-tile-code">{toHex(rule.code)}</span>
                    <span className="fc-tile-name">{rule.name}</span>
                  </button>
                ))}
              </div>
              <div className="sensor-pager" style={{ justifyContent: "center" }}>
                <button
                  className="sensor-settings-btn"
                  onClick={() => {
                    setInput("0x");
                    setView("custom");
                  }}
                  type="button"
                >
                  自定义故障查询
                </button>
              </div>
            </>
          ) : (
            /* ===== 变频器故障：ACS880 全量目录 ===== */
            <>
              <div className="sensor-detail-head">
                <button className="sensor-back-btn" onClick={() => setView("menu")} type="button">
                  ‹ 返回
                </button>
                <h1 className="sensor-detail-title">变频器故障代码查询（ACS880）</h1>
              </div>
              <div className="fc-acs-list">
                {ACS880_FAULTS.map((fault) => (
                  <button
                    className="fc-acs-row"
                    key={`${fault.code}-${fault.title}`}
                    onClick={() => openAcs880(fault)}
                    type="button"
                  >
                    <span className="fc-acs-code">{fault.code}</span>
                    <span className="fc-acs-title">{fault.title}</span>
                    <span className="fc-acs-chevron">›</span>
                  </button>
                ))}
              </div>
            </>
          )
        ) : (
          /* ===== 自定义查询（系统/内部故障）：大键盘 + 规则提示 ===== */
          <>
            <div className="sensor-detail-head">
              <button className="sensor-back-btn" onClick={() => setView("grid")} type="button">
                ‹ 返回
              </button>
              <h1 className="sensor-detail-title">系统故障代码查询 · 自定义</h1>
            </div>
            <div className="fc-custom">
              <div className="fc-rules">
                <div className="fc-rules-item">
                  <strong>① 直接查表</strong>
                  输入十六进制代码（已预置 0x 前缀），命中 BOC/HPC 故障表直接给出含义
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
                  <button className="fc-key fc-key-wide" onClick={() => setInput("0x")} type="button">
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
                    disabled={!input.trim() || input.trim().toLowerCase() === "0x" || searching}
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
                  <div className="fc-modal-sub">注意建议</div>
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
