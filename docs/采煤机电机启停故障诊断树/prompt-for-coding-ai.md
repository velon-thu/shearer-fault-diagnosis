# 给编码 AI 的实现指令

请解压本文件包，并严格执行：

1. 阅读 `README.md`、`ui-spec.md` 和 `diagnosis-trees.yaml`。
2. 以 `diagnosis-trees.yaml` 作为诊断业务逻辑唯一数据源，不得自行改写、补充或推测诊断分支。
3. 使用一个通用诊断页面，根据 `currentNodeId` 动态渲染问题或结果；用 `historyStack` 实现“上一步”。
4. 当选项的 `next` 为 `null` 时，展示“该分支待补录”，不得生成虚构结论。
5. 参考 `source-frames/` 与 `ui-spec.md` 高度复刻原微信小程序的颜色、布局、字体层级和按钮位置。
6. 高风险节点在继续前必须显示安全确认，内容来自根字段 `safety_notice` 和节点 `notes`。
7. 使用 `acceptance-tests.md` 中的所有路径逐条测试，确保每条选择路径抵达指定结果。
8. 诊断树必须与 UI 解耦，后续修改 YAML/JSON 后无需改动页面代码。

推荐实现：微信小程序原生 TypeScript + WXML + WXSS。若使用其他框架，仍需保持数据驱动结构。
