"use client";

import {
  ShmLiveResponseSchema,
  createApiSuccessResponseSchema,
  type ShmLiveResponse,
  type ShmVariable,
} from "@shearer/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";

const ShmLiveApiResponseSchema = createApiSuccessResponseSchema(ShmLiveResponseSchema);

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

const SHEET_ORDER = ["电机", "变频器", "传感器", "状态"] as const;

const POLL_MS = 1000;
const HIGHLIGHT_MS = 2500;

type ChangeMap = Map<number, number>; // add -> 最近变化时刻

export default function ShmMonitorPage() {
  const shellState = useAppShellState();
  const [live, setLive] = useState<ShmLiveResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [activeSheet, setActiveSheet] = useState<string>("全部");
  const [faultsActiveOnly, setFaultsActiveOnly] = useState(true);
  const prevValuesRef = useRef<Map<number, number>>(new Map());
  const changesRef = useRef<ChangeMap>(new Map());
  const [, forceTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(`${resolveHttpBase()}/api/shm/live`, {
          cache: "no-store",
        });
        const parsed = ShmLiveApiResponseSchema.parse(await response.json());

        if (cancelled) {
          return;
        }

        const now = Date.now();
        const prev = prevValuesRef.current;

        for (const v of parsed.data.variables) {
          const before = prev.get(v.add);

          if (before !== undefined && before !== v.raw) {
            changesRef.current.set(v.add, now);
          }

          prev.set(v.add, v.raw);
        }

        setLive(parsed.data);
        setErrorMessage(null);
      } catch {
        if (!cancelled) {
          setErrorMessage("共享内存数据加载失败，请确认 IPC 服务已启动。");
        }
      }
    };

    poll();
    const timer = setInterval(() => {
      poll();
      forceTick((n) => n + 1);
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const filteredVariables = useMemo(() => {
    if (!live) {
      return [];
    }

    const text = filterText.trim().toLowerCase();

    return live.variables.filter((v) => {
      if (activeSheet !== "全部" && v.sheet !== activeSheet) {
        return false;
      }

      if (!text) {
        return true;
      }

      return (
        v.name.toLowerCase().includes(text) ||
        v.stdTag.toLowerCase().includes(text) ||
        v.category.toLowerCase().includes(text) ||
        String(v.add).includes(text)
      );
    });
  }, [live, filterText, activeSheet]);

  const groupedBySheet = useMemo(() => {
    const groups = new Map<string, ShmVariable[]>();

    for (const sheet of SHEET_ORDER) {
      groups.set(sheet, []);
    }

    for (const v of filteredVariables) {
      const list = groups.get(v.sheet) ?? [];
      list.push(v);
      groups.set(v.sheet, list);
    }

    return [...groups.entries()].filter(([, list]) => list.length > 0);
  }, [filteredVariables]);

  const activeFaults = useMemo(
    () => (live ? live.faults.filter((f) => f.active) : []),
    [live],
  );

  const shownFaults = useMemo(() => {
    if (!live) {
      return [];
    }

    return faultsActiveOnly ? activeFaults : live.faults;
  }, [live, faultsActiveOnly, activeFaults]);

  const mappedCount = live
    ? live.variables.filter((v) => v.org !== "").length
    : 0;
  const now = Date.now();

  const isChanged = (add: number) => {
    const at = changesRef.current.get(add);
    return at !== undefined && now - at < HIGHLIGHT_MS;
  };

  const replayerChip = (() => {
    if (!live || !live.available) {
      return { text: "共享内存未创建", className: "red" };
    }

    if (!live.meta) {
      return { text: "元数据不可读", className: "orange" };
    }

    return live.meta.replayerAlive
      ? { text: "回放器写入中", className: "green" }
      : { text: "回放器已停止", className: "orange" };
  })();

  return (
    <AppShell
      shellState={shellState}
      subtitle="org 回放器 → 共享内存(td3sharemem) 写入实况：全部变量、当前值与映射状态"
      tagText="1s 刷新"
      title="共享内存监视"
    >
      {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

      <section className="page active">
        {/* ===== 回放器状态 ===== */}
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3 className="panel-title">
                <span className="accent-bar" />
                回放器状态
              </h3>
              <p className="panel-subtitle">
                共享内存 {live?.shmName ?? "--"} · 定义变量{" "}
                {live?.variables.length ?? 0} 个（已映射 {mappedCount} 个，未映射恒 0）
              </p>
            </div>
            <span className={`pill ${replayerChip.className}`}>{replayerChip.text}</span>
          </div>
          <div className="panel-body">
            <div className="kpi-row">
              <div className="kpi">
                <div className="kpi-name">已写入记录</div>
                <div className="kpi-value">{live?.meta?.records ?? "--"}</div>
              </div>
              <div className="kpi">
                <div className="kpi-name">文件进度</div>
                <div className="kpi-value">
                  {live?.meta ? `${live.meta.fileIndex}/${live.meta.fileTotal}` : "--"}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-name">写入间隔</div>
                <div className="kpi-value">
                  {live?.meta ? `${live.meta.intervalMs} ms` : "--"}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-name">激活故障位</div>
                <div className="kpi-value">{activeFaults.length}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ===== 操作来源实况 ===== */}
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3 className="panel-title">
                <span className="accent-bar" />
                操作来源（8 输入 + 2 输出）
              </h3>
              <p className="panel-subtitle">
                32 位操作码 = 操作1(高16位) + 操作2(低16位)，亮起的指令为当前按下/输出中。
              </p>
            </div>
          </div>
          <div className="panel-body">
            <table className="data-table">
              <thead>
                <tr>
                  <th>组</th>
                  <th>来源</th>
                  <th>类型</th>
                  <th>操作码</th>
                  <th>当前指令</th>
                </tr>
              </thead>
              <tbody>
                {(live?.ops ?? []).map((g) => (
                  <tr key={g.groupNo}>
                    <td>{g.groupNo}</td>
                    <td>{g.sourceName}</td>
                    <td>
                      <span className={`badge ${g.sourceType === "输入" ? "info" : "warn"}`}>
                        {g.sourceType}
                      </span>
                    </td>
                    <td>
                      <code>{g.hex}</code>
                    </td>
                    <td>
                      {g.activeOps.length === 0 ? (
                        <span className="meta-line">--</span>
                      ) : (
                        g.activeOps.map((op) => (
                          <span className="badge success" key={op} style={{ marginRight: 4 }}>
                            {op}
                          </span>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ===== 变量总表 ===== */}
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3 className="panel-title">
                <span className="accent-bar" />
                变量写入实况
              </h3>
              <p className="panel-subtitle">
                黄色高亮 = 最近 2.5s 内值有变化；「未映射」= Excel 未给 ORG 列，恒写 0。
              </p>
            </div>
            <input
              className="date-input"
              onChange={(event) => setFilterText(event.target.value)}
              placeholder="搜索 名称 / std_tag / 部件 / 地址"
              style={{ width: 260 }}
              value={filterText}
            />
          </div>
          <div className="panel-body">
            <div className="chip-row" style={{ marginBottom: 12 }}>
              {["全部", ...SHEET_ORDER].map((sheet) => (
                <button
                  className={`button ${activeSheet === sheet ? "" : "ghost"}`}
                  key={sheet}
                  onClick={() => setActiveSheet(sheet)}
                  type="button"
                >
                  {sheet}
                </button>
              ))}
            </div>
            {groupedBySheet.length === 0 ? (
              <div className="empty">没有匹配的变量。</div>
            ) : (
              groupedBySheet.map(([sheet, vars]) => (
                <div key={sheet} style={{ marginBottom: 18 }}>
                  <h4 className="chart-title" style={{ margin: "8px 0" }}>
                    {sheet}（{vars.length}）
                  </h4>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>地址</th>
                        <th>部件</th>
                        <th>名称</th>
                        <th>std_tag</th>
                        <th>ORG</th>
                        <th>原始值</th>
                        <th>当前值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vars.map((v) => (
                        <tr
                          key={v.add}
                          style={
                            isChanged(v.add)
                              ? { background: "rgba(250, 204, 21, 0.18)" }
                              : undefined
                          }
                        >
                          <td>{v.add}</td>
                          <td>{v.category}</td>
                          <td>{v.name}</td>
                          <td>
                            <code>{v.stdTag}</code>
                          </td>
                          <td>
                            {v.org === "" ? (
                              <span className="badge error">未映射</span>
                            ) : (
                              <code>{v.org}</code>
                            )}
                          </td>
                          <td>{v.raw}</td>
                          <td>
                            {v.kind === "status" ? (
                              <span className={`badge ${v.value === 1 ? "success" : "info"}`}>
                                {v.value === 1 ? "1 · 有效" : "0"}
                              </span>
                            ) : (
                              <strong>
                                {v.value}
                                {v.unit ? ` ${v.unit}` : ""}
                              </strong>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ===== 故障位 ===== */}
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3 className="panel-title">
                <span className="accent-bar" />
                故障位（{activeFaults.length} 激活 / {live?.faults.length ?? 0} 总数）
              </h3>
              <p className="panel-subtitle">
                trigger 说明：bit=1 触发；bit_inv=0 触发（-C 反逻辑）；eq/neq=等值/非等值触发。
              </p>
            </div>
            <button
              className="button ghost"
              onClick={() => setFaultsActiveOnly((v) => !v)}
              type="button"
            >
              {faultsActiveOnly ? "显示全部" : "只看激活"}
            </button>
          </div>
          <div className="panel-body">
            {shownFaults.length === 0 ? (
              <div className="empty">当前没有激活的故障位。</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>故障码(地址)</th>
                    <th>名称</th>
                    <th>ORG 触发</th>
                    <th>原始值</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {shownFaults.map((f) => (
                    <tr key={f.code}>
                      <td>{f.code}</td>
                      <td>{f.name}</td>
                      <td>
                        <code>{f.trigger}</code>
                      </td>
                      <td>{f.raw}</td>
                      <td>
                        <span className={`badge ${f.active ? "error" : "success"}`}>
                          {f.active ? "激活" : "正常"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ===== 内部故障 FIFO ===== */}
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3 className="panel-title">
                <span className="accent-bar" />
                内部故障 FIFO（3400~3411）
              </h3>
              <p className="panel-subtitle">
                每组 4 字，新故障码从第 0 位压入；首位即最近一次内部故障码。
              </p>
            </div>
          </div>
          <div className="panel-body">
            <table className="data-table">
              <thead>
                <tr>
                  <th>模块</th>
                  <th>字0（最新）</th>
                  <th>字1</th>
                  <th>字2</th>
                  <th>字3</th>
                </tr>
              </thead>
              <tbody>
                {(live?.fifos ?? []).map((f) => (
                  <tr key={f.module}>
                    <td>
                      <strong>{f.module}</strong>
                    </td>
                    {f.words.map((w, i) => (
                      <td key={i}>
                        <code>
                          {w}（0x{w.toString(16).toUpperCase().padStart(4, "0")}）
                        </code>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
