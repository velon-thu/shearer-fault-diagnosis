"use client";

import {
  KnowledgeAssetsResponseSchema,
  createApiSuccessResponseSchema,
  type KnowledgeAssetsResponse,
} from "@shearer/contracts";
import { useEffect, useRef, useState } from "react";
import { AppShell, useAppShellState } from "@/components/app-shell";
import { KB_ARTICLES, KB_GROUPS, type KbArticle, type KbBlock } from "./content";
import { resolveHttpBase } from "@/lib/api-base";

const KnowledgeAssetsApiResponseSchema = createApiSuccessResponseSchema(
  KnowledgeAssetsResponseSchema,
);

type AssetType = keyof KnowledgeAssetsResponse;

// 资料库（图纸 / 视频）来自后端，和正文条目并列放在左侧目录最后一组
const ASSET_ITEMS: { id: AssetType; label: string }[] = [
  { id: "drawing", label: "图纸图册" },
  { id: "install", label: "安装指导视频" },
  { id: "troubleshoot", label: "故障排查视频" },
];

type Selection = { kind: "article"; id: string } | { kind: "asset"; id: AssetType };

function ArticleBody({ blocks }: { blocks: KbBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;

        switch (block.kind) {
          case "h":
            return (
              <h2 className="kb-h" key={key}>
                {block.text}
              </h2>
            );
          case "p":
            return (
              <p className="kb-p" key={key}>
                {block.text}
              </p>
            );
          case "ol":
            return (
              <ol className="kb-ol" key={key}>
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            );
          case "ul":
            return (
              <ul className="kb-ul" key={key}>
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            );
          case "chips":
            return (
              <div className="kb-chips" key={key}>
                {block.items.map((item) => (
                  <span className="kb-chip" key={item}>
                    {item}
                  </span>
                ))}
              </div>
            );
          case "defs":
            return (
              <div className="kb-defs" key={key}>
                {block.items.map((item) => (
                  <div className="kb-def" key={`${item.term}-${item.desc}`}>
                    <span className="kb-def-term">{item.term}</span>
                    <span className="kb-def-desc">{item.desc}</span>
                  </div>
                ))}
              </div>
            );
          case "fault":
            return (
              <section className="kb-fault" key={key}>
                <h3 className="kb-fault-title">{block.symptom}</h3>
                <ol className="kb-causes">
                  {block.causes.map((cause) => (
                    <li key={cause}>{cause}</li>
                  ))}
                </ol>
              </section>
            );
          case "note":
            return (
              <div className="kb-note" key={key}>
                {block.text}
              </div>
            );
          default:
            return null;
        }
      })}
    </>
  );
}

export default function KnowledgePage() {
  const shellState = useAppShellState();
  const [assets, setAssets] = useState<KnowledgeAssetsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection>({
    kind: "article",
    id: KB_ARTICLES[0]?.id ?? "",
  });
  const readerRef = useRef<HTMLElement | null>(null);

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
          setErrorMessage("资料库列表加载失败，请先启动 IPC 服务。正文内容不受影响。");
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

  // 换条目后回到顶部，避免停在上一篇的滚动位置
  useEffect(() => {
    readerRef.current?.scrollTo({ top: 0 });
  }, [selected]);

  const article: KbArticle | undefined =
    selected.kind === "article"
      ? KB_ARTICLES.find((item) => item.id === selected.id)
      : undefined;
  const assetItem = selected.kind === "asset" ? ASSET_ITEMS.find((item) => item.id === selected.id) : undefined;
  const assetList = selected.kind === "asset" ? (assets?.[selected.id] ?? []) : [];

  return (
    <AppShell shellState={shellState} title="采煤机知识库">
      <section className="page active">
        <div className="kb-shell">
          <aside className="kb-sidebar">
            {KB_GROUPS.map((group) => (
              <div className="kb-group" key={group.id}>
                <div className="kb-group-label">{group.label}</div>
                {group.articles.map((item) => (
                  <button
                    className={`kb-nav-item${
                      selected.kind === "article" && selected.id === item.id ? " on" : ""
                    }`}
                    key={item.id}
                    onClick={() => setSelected({ kind: "article", id: item.id })}
                    type="button"
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            ))}

            <div className="kb-group">
              <div className="kb-group-label">资料库</div>
              {ASSET_ITEMS.map((item) => (
                <button
                  className={`kb-nav-item${
                    selected.kind === "asset" && selected.id === item.id ? " on" : ""
                  }`}
                  key={item.id}
                  onClick={() => setSelected({ kind: "asset", id: item.id })}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </aside>

          <article className="kb-reader" ref={readerRef}>
            {article ? (
              <>
                <h1 className="kb-title">{article.title}</h1>
                <ArticleBody blocks={article.blocks} />
              </>
            ) : assetItem ? (
              <>
                <h1 className="kb-title">{assetItem.label}</h1>
                {errorMessage ? <div className="kb-note">{errorMessage}</div> : null}
                <div className="kb-assets">
                  {loading ? (
                    <div className="empty">正在加载资料...</div>
                  ) : assetList.length === 0 ? (
                    <div className="empty">当前分类下暂无资料。</div>
                  ) : (
                    assetList.map((asset, index) => (
                      <div className="kb-asset" key={asset.title}>
                        <span className="kb-asset-no">{String(index + 1).padStart(2, "0")}</span>
                        <span className="kb-asset-text">
                          <span className="kb-asset-title">{asset.title}</span>
                          <span className="kb-asset-meta">{asset.meta}</span>
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="empty">请选择左侧条目。</div>
            )}
          </article>
        </div>
      </section>
    </AppShell>
  );
}
