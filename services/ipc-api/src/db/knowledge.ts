import type { KnowledgeAsset, KnowledgeAssetsResponse } from "@shearer/contracts";
import { type DatabaseSync } from "node:sqlite";
import { knowledgeAssets } from "../mock";
import { initializeSqlite } from "./sqlite";

type KnowledgeAssetType = keyof KnowledgeAssetsResponse;

type KnowledgeAssetRow = {
  asset_type: string;
  title: string;
  meta: string | null;
};

const KNOWLEDGE_TABLE = "knowledge_assets";

const KNOWLEDGE_TYPES: KnowledgeAssetType[] = ["drawing", "install", "troubleshoot"];

const isKnowledgeAssetType = (value: string): value is KnowledgeAssetType =>
  KNOWLEDGE_TYPES.includes(value as KnowledgeAssetType);

const toKnowledgeAsset = (row: KnowledgeAssetRow): KnowledgeAsset => ({
  title: row.title,
  meta: row.meta ?? "",
});

const insertKnowledgeAsset = (
  db: DatabaseSync,
  assetType: KnowledgeAssetType,
  asset: KnowledgeAsset,
  sortOrder: number,
) => {
  db.prepare(
    `
      INSERT INTO ${KNOWLEDGE_TABLE} (
        asset_type,
        title,
        meta,
        sort_order
      )
      VALUES (?, ?, ?, ?)
    `,
  ).run(assetType, asset.title, asset.meta, sortOrder);
};

export const initializeKnowledgeStore = (db: DatabaseSync = initializeSqlite()) => {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${KNOWLEDGE_TABLE}`).get() as {
    count: number;
  };

  if (row.count > 0) {
    return db;
  }

  for (const assetType of KNOWLEDGE_TYPES) {
    knowledgeAssets[assetType].forEach((asset, index) => {
      insertKnowledgeAsset(db, assetType, asset, index);
    });
  }

  return db;
};

export const readKnowledgeAssetsFromSqlite = (
  db: DatabaseSync = initializeKnowledgeStore(),
): KnowledgeAssetsResponse => {
  const rows = initializeKnowledgeStore(db)
    .prepare(
      `
        SELECT asset_type, title, meta
        FROM ${KNOWLEDGE_TABLE}
        ORDER BY asset_type ASC, sort_order ASC, id ASC
      `,
    )
    .all() as KnowledgeAssetRow[];

  const grouped: KnowledgeAssetsResponse = {
    drawing: [],
    install: [],
    troubleshoot: [],
  };

  for (const row of rows) {
    if (!isKnowledgeAssetType(row.asset_type)) {
      continue;
    }

    grouped[row.asset_type].push(toKnowledgeAsset(row));
  }

  return grouped;
};
