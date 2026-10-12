/**
 * 引导性诊断树的加载器。
 *
 * 种子文件 seed/diagnosis-trees.json 由 tools/build-diagnosis-trees.py 从 docs 下
 * 各棵树的 diagnosis-trees.yaml 无损转换而来。这里只做"读进来 + schema 校验 + 原样
 * 下发"，**不裁剪、不改写、不合并节点**——树的业务逻辑以 YAML 为唯一数据源。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DiagnosisTreesResponseSchema, type DiagnosisTreesResponse } from "@shearer/contracts";

const packageRoot = resolve(__dirname, "..", "..");
const SEED_PATH = resolve(packageRoot, "seed", "diagnosis-trees.json");

const EMPTY: DiagnosisTreesResponse = { generatedAt: "", trees: [] };

let cache: DiagnosisTreesResponse | null = null;

/** 读取全部诊断树。文件缺失或损坏时返回空集，前端显示"诊断树未安装"，不影响其他页面。 */
export const readDiagnosisTrees = (): DiagnosisTreesResponse => {
  if (cache) {
    return cache;
  }
  if (!existsSync(SEED_PATH)) {
    cache = EMPTY;
    return cache;
  }
  try {
    cache = DiagnosisTreesResponseSchema.parse(JSON.parse(readFileSync(SEED_PATH, "utf-8")));
  } catch {
    cache = EMPTY;
  }
  return cache;
};
