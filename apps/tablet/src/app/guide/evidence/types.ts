/** 各棵诊断树共用的证据卡片模型。 */
export type EvidenceCard = {
  /** data = 库里有据可依；none = 本机没有这个测点，只能现场实测 */
  tone: "data" | "none";
  title: string;
  lines: Array<{ label: string; value: string }>;
  note?: string;
  /**
   * 数据倾向的选项文本（用于在选项里做高亮）与理由。
   * 同一问在不同模块里用词不完全一样（调高树 q01 有的写"单边"有的写"单侧"），
   * 所以这里给一组候选词，命中任意一个即高亮。
   */
  recommend?: { match: string[]; why: string };
};
