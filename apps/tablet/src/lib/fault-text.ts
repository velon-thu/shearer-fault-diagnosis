/**
 * 故障处理建议的排版工具。
 *
 * `fault_rule.handle` 的原文自带序号（"1.xxx。2.xxx。"），而前端一律用 <ol> 渲染，
 * 所以拆条时要把序号吃掉，否则会显示成 "1. 1. xxx"。
 *
 * 坑在于正文里还有别的数字带点：参数号 `99.13`、`20.12`，量值 `2.5MPa`。
 * 判据是**序号后面不能再跟数字**，靠 lookahead 区分：
 *   "1.检查…"   → 1 是序号，拆
 *   "参数99.13" → 99. 后面跟 1，是参数号，不拆
 */
export const splitHandle = (handle?: string | null): string[] => {
  const text = (handle ?? "").trim();
  if (!text) {
    return [];
  }
  return text
    .split(/\d+\s*[.、](?=\s*[^\d\s])/)
    .map((part) => part.trim())
    .filter(Boolean);
};
