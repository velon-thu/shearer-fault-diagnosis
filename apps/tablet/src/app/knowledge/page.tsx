"use client";

import {
  KnowledgeAssetsResponseSchema,
  createApiSuccessResponseSchema,
  type KnowledgeAsset,
  type KnowledgeAssetsResponse,
} from "@shearer/contracts";
import { useEffect, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";

const KnowledgeAssetsApiResponseSchema = createApiSuccessResponseSchema(
  KnowledgeAssetsResponseSchema,
);

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

const getAssetBadgeClass = (group: "drawing" | "install" | "troubleshoot") => {
  if (group === "drawing") {
    return "info";
  }

  if (group === "install") {
    return "warn";
  }

  return "success";
};

const getAssetBadgeText = (item: KnowledgeAsset) => item.meta.split("·")[0]?.trim() ?? "资料";

type AssetPanelProps = {
  group: "drawing" | "install" | "troubleshoot";
  items: KnowledgeAsset[];
  loading: boolean;
  title: string;
  subtitle: string;
};

function AssetPanel({ group, items, loading, title, subtitle }: AssetPanelProps) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">
            <span className="accent-bar" />
            {title}
          </h3>
          <p className="panel-subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="panel-body">
        <div className="asset-list">
          {loading ? (
            <div className="empty">正在加载知识库资料...</div>
          ) : items.length === 0 ? (
            <div className="empty">当前分类下暂无资料。</div>
          ) : (
            items.map((item, index) => (
              <article className="asset-item" key={`${group}-${item.title}`}>
                <div className="asset-item-head">
                  <span className="asset-item-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className={`badge ${getAssetBadgeClass(group)}`}>
                    {getAssetBadgeText(item)}
                  </span>
                </div>
                <div className="asset-title">{item.title}</div>
                <div className="asset-meta">{item.meta}</div>
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function KnowledgePage() {
  const shellState = useAppShellState();
  const [assets, setAssets] = useState<KnowledgeAssetsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadAssets = async () => {
      try {
        setLoading(true);

        const response = await fetch(`${resolveHttpBase()}/api/knowledge/assets`, {
          cache: "no-store",
        });
        const json = await response.json();
        const parsed = KnowledgeAssetsApiResponseSchema.parse(json);

        if (cancelled) {
          return;
        }

        setAssets(parsed.data);
        setErrorMessage(null);
      } catch {
        if (!cancelled) {
          setErrorMessage("知识库资料加载失败，请先启动 IPC 服务。");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadAssets();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell
      shellState={shellState}
      subtitle="图纸图册、安装指导视频、故障排查视频"
      tagText="资料库"
      title="采煤机知识库"
    >
      {errorMessage ? <div className="system-note">{errorMessage}</div> : null}

      <section className="page active">
        <div className="grid-3">
          <AssetPanel
            group="drawing"
            items={assets?.drawing ?? []}
            loading={loading}
            subtitle="按机型与部件分类归档"
            title="机械 / 电气图纸图册"
          />
          <AssetPanel
            group="install"
            items={assets?.install ?? []}
            loading={loading}
            subtitle="适用于新机入井与部件更换"
            title="安装指导视频"
          />
          <AssetPanel
            group="troubleshoot"
            items={assets?.troubleshoot ?? []}
            loading={loading}
            subtitle="现场问题闭环与示教资料"
            title="故障排查视频"
          />
        </div>
      </section>
    </AppShell>
  );
}
