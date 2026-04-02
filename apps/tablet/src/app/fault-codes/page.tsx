"use client";

import {
  FaultCodeResultSchema,
  type FaultCategory,
  type FaultCodeResult,
  createApiSuccessResponseSchema,
} from "@shearer/contracts";
import { useEffect, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";

const FaultCodeResultApiResponseSchema = createApiSuccessResponseSchema(FaultCodeResultSchema);

const systemCodes = [
  "0x0021",
  "0x0028",
  "0x0035",
  "0x0042",
  "0x0059",
  "0x0067",
  "0x0074",
  "0x0081",
  "0x0098",
  "0x00A5",
  "0x00B3",
  "0x00C7",
  "0x00D9",
  "0x00E2",
  "0x00F8",
  "0x0105",
  "0x0119",
  "0x0126",
  "0x0138",
  "0x0147",
] as const;

const inverterCodes = [
  "2310",
  "2330",
  "2340",
  "3130",
  "3210",
  "3211",
  "3220",
  "4110",
  "4210",
  "4290",
  "4310",
  "5210",
  "7000",
  "3181",
  "5080",
  "5682",
  "5690",
  "5692",
] as const;

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

const getDefaultCode = (category: FaultCategory) => (category === "system" ? "0x0094" : "3130");

const normalizeCode = (category: FaultCategory, code: string) => {
  const trimmed = code.trim();

  if (!trimmed) {
    return getDefaultCode(category);
  }

  if (category === "system") {
    const cleaned = trimmed.replace(/^0x/i, "").toUpperCase();
    return `0x${cleaned}`;
  }

  return trimmed;
};

const getCategoryLabel = (category: FaultCategory) =>
  category === "system" ? "系统故障" : "变频器故障";

export default function FaultCodesPage() {
  const shellState = useAppShellState();
  const [category, setCategory] = useState<FaultCategory>("system");
  const [codeInput, setCodeInput] = useState("0x0094");
  const [queryResult, setQueryResult] = useState<FaultCodeResult | null>(null);
  const [activeChipKey, setActiveChipKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const queryFaultCode = async (
    nextCategory: FaultCategory,
    rawCode: string,
    highlight = false,
  ) => {
    const normalizedCode = normalizeCode(nextCategory, rawCode);

    try {
      setLoading(true);

      const response = await fetch(
        `${resolveHttpBase()}/api/fault-codes/search?category=${nextCategory}&code=${encodeURIComponent(normalizedCode)}`,
        {
          cache: "no-store",
        },
      );
      const json = await response.json();
      const parsed = FaultCodeResultApiResponseSchema.parse(json);

      setCategory(nextCategory);
      setCodeInput(normalizedCode);
      setQueryResult(parsed.data);
      setActiveChipKey(highlight ? `${nextCategory}:${normalizedCode}` : "");
      setErrorMessage(null);
    } catch {
      setErrorMessage("故障代码查询失败，请先启动 IPC 服务。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void queryFaultCode("system", "0x0094", false);
  }, []);

  return (
    <AppShell
      shellState={shellState}
      subtitle="系统故障与变频器故障双词典，支持点击与自定义查询"
      tagText="代码词典"
      title="故障代码查询"
    >
      {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

      <section className="page active">
        <div className="two-col">
          <div className="stack">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h3 className="panel-title">
                    <span className="accent-bar" />
                    常见系统故障代码
                  </h3>
                  <p className="panel-subtitle">点击代码即可查看释义与建议动作。</p>
                </div>
              </div>
              <div className="panel-body">
                <div className="code-grid">
                  {systemCodes.map((code) => (
                    <div
                      className={`code-chip ${activeChipKey === `system:${code}` ? "active" : ""}`}
                      key={code}
                    >
                      <button
                        className="code-btn"
                        onClick={() => void queryFaultCode("system", code, true)}
                        type="button"
                      >
                        {code}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-head">
                <div>
                  <h3 className="panel-title">
                    <span className="accent-bar" />
                    常见变频器故障代码
                  </h3>
                  <p className="panel-subtitle">同样支持点击查询与手动输入检索。</p>
                </div>
              </div>
              <div className="panel-body">
                <div className="code-grid">
                  {inverterCodes.map((code) => (
                    <div
                      className={`code-chip ${activeChipKey === `inverter:${code}` ? "active" : ""}`}
                      key={code}
                    >
                      <button
                        className="code-btn"
                        onClick={() => void queryFaultCode("inverter", code, true)}
                        type="button"
                      >
                        {code}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="stack">
            <div className="panel">
              <div className="panel-head">
                <div>
                  <h3 className="panel-title">
                    <span className="accent-bar" />
                    自定义故障查询
                  </h3>
                  <p className="panel-subtitle">示例：系统故障 0x0094 / 变频器故障 3130。</p>
                </div>
              </div>
              <div className="panel-body">
                <div className="search-row">
                  <select
                    className="control"
                    onChange={(event) => setCategory(event.target.value as FaultCategory)}
                    value={category}
                  >
                    <option value="system">系统故障</option>
                    <option value="inverter">变频器故障</option>
                  </select>
                  <input
                    className="search-input"
                    onChange={(event) => setCodeInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void queryFaultCode(category, codeInput, false);
                      }
                    }}
                    placeholder="输入故障代码，例如 0x0094 或 3130"
                    value={codeInput}
                  />
                  <button
                    className="button primary"
                    onClick={() => void queryFaultCode(category, codeInput, false)}
                    type="button"
                  >
                    查询
                  </button>
                </div>

                <div className="result-box">
                  {loading ? (
                    <div className="empty">正在查询故障代码...</div>
                  ) : queryResult?.found ? (
                    <>
                      <div className="result-code">
                        <span className="badge info">{getCategoryLabel(queryResult.category)}</span>
                        <span>{queryResult.code}</span>
                      </div>
                      <div className="result-desc">{queryResult.description}</div>
                      <div className="result-tip">{queryResult.tip}</div>
                    </>
                  ) : (
                    <div className="empty">
                      当前原型中未录入 <strong>{queryResult?.code ?? codeInput}</strong> 的详细释义。
                      <br />
                      正式版可从知识库 / 后端词典动态同步该故障信息。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
