# 文件说明

- `diagnosis-trees.yaml`：推荐直接喂给编码 AI，作为诊断业务逻辑的唯一数据源。
- `diagnosis-trees.json`：与 YAML 等价，适合微信小程序直接加载。
- `diagnosis-trees.md`：人类可读版，包含节点、跳转表和 Mermaid 流程图。
- `raw/`：自动抽帧、机器 OCR 与录屏观测跳转；用于核对。机器 OCR 可能有错字，不能替代规范化 YAML。
- `source-frames/`：每个录屏的唯一页面截图，文件名与 `source_page` 对应。

## 推荐实现方式

只做一个通用诊断页面，由 `currentNodeId` 渲染问题与选项；使用 `historyStack` 实现“上一步”。不要给每个问题单独建页面，也不要把“上一步”写进诊断树业务选项。

遇到 `next: null` 的选项，先显示“该分支待补录/待确认”，不要让生成模型自行编造故障结论。
