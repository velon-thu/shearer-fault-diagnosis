/**
 * 诊断树 ←→ 机器数据的绑定注册表。
 *
 * 诊断树本身（docs 的 YAML）是唯一数据源，一个字都不动；绑定层只回答两个问题：
 *   1. 当前这个节点，库里有没有能说话的数据？
 *   2. 如果有，数据倾向哪个选项？
 *
 * 三条硬规矩，每棵树都一样：
 *   · 数据只做**建议**，永远不替人点选，也不自动跳转。
 *   · 本机没有的测点如实写"请现场实测"，绝不拿别的数凑答案。
 *   · 判定口径与后端一致：指令段 → 输出段 → 效果段。
 *
 * 加一棵树 = 加一个 provider 文件 + 在下面两张表里各写一行。
 */
import {
  ArmEvidenceSchema,
  MotorEvidenceSchema,
  TractionEvidenceSchema,
  createApiSuccessResponseSchema,
  type DiagnosisNode,
} from "@shearer/contracts";
import { armProvider } from "./arm";
import { motorProvider } from "./motor";
import { tractionProvider } from "./traction";
import type { EvidenceCard } from "./types";

export type { EvidenceCard } from "./types";

const ArmApiSchema = createApiSuccessResponseSchema(ArmEvidenceSchema);
const TractionApiSchema = createApiSuccessResponseSchema(TractionEvidenceSchema);
const MotorApiSchema = createApiSuccessResponseSchema(MotorEvidenceSchema);

/** 已解析的证据，按树种区分（不同树的数据形状本来就不一样，不强行抽象） */
export type TreeEvidence =
  | { kind: "arm"; data: ReturnType<typeof ArmEvidenceSchema.parse> }
  | { kind: "traction"; data: ReturnType<typeof TractionEvidenceSchema.parse> }
  | { kind: "motor"; data: ReturnType<typeof MotorEvidenceSchema.parse> };

type EvidenceKindId = TreeEvidence["kind"];

// 树 id → 证据种类。树 id 由 tools/build-diagnosis-trees.py 固定。
const KIND_BY_TREE: Record<string, EvidenceKindId> = {
  "arm-height": "arm",
  traction: "traction",
  "motor-start-stop": "motor",
};

const ENDPOINT: Record<EvidenceKindId, string> = {
  arm: "/api/diagnosis/arm-evidence",
  traction: "/api/diagnosis/traction-evidence",
  motor: "/api/diagnosis/motor-evidence",
};

/** 这棵树有没有配套的数据证据；没有就只走纯诊断树，不报错 */
export const evidenceRequestFor = (
  treeId: string,
): { kind: EvidenceKindId; path: string } | null => {
  const kind = KIND_BY_TREE[treeId];
  return kind === undefined ? null : { kind, path: ENDPOINT[kind] };
};

export const parseEvidence = (kind: EvidenceKindId, payload: unknown): TreeEvidence => {
  if (kind === "arm") {
    return { kind, data: ArmApiSchema.parse(payload).data };
  }
  if (kind === "traction") {
    return { kind, data: TractionApiSchema.parse(payload).data };
  }
  return { kind, data: MotorApiSchema.parse(payload).data };
};

/** moduleId 只有电机启停树用得上（四个模块各盯一台电机），其余 provider 忽略。 */
export const cardForNode = (
  node: DiagnosisNode,
  moduleId: string | null,
  evidence: TreeEvidence | null,
): EvidenceCard | null => {
  if (evidence === null) {
    return null;
  }
  if (evidence.kind === "arm") {
    return armProvider.cardForNode(node, evidence.data);
  }
  if (evidence.kind === "traction") {
    return tractionProvider.cardForNode(node, evidence.data);
  }
  return motorProvider.cardForNode(node, moduleId ?? "", evidence.data);
};

/** 选机型页用：数据收敛出的候选模块（只有调高树有多机型） */
export const recommendedModuleIds = (evidence: TreeEvidence | null): string[] =>
  evidence?.kind === "arm"
    ? evidence.data.profile.candidates.map((candidate) => candidate.moduleId)
    : [];

export const profileFacts = (
  evidence: TreeEvidence | null,
): { facts: Array<{ label: string; value: string }>; note: string } | null => {
  if (evidence?.kind !== "arm" || evidence.data.profile.facts.length === 0) {
    return null;
  }
  return {
    facts: evidence.data.profile.facts,
    note: `${evidence.data.profile.candidates[0]?.reasons.join("；") ?? "机型数据不足"}；阀型（比例阀 / 普通阀）数据判不了，请对图纸确认。`,
  };
};
