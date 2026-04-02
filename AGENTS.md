# 采煤机故障诊断点检仪

## 技术栈
- Frontend: Next.js App Router + TypeScript + static export
- Backend: Fastify + WebSocket + SQLite
- Shared types: packages/contracts
- Deployment: IPC 提供 /, /api, /ws；tablet 浏览器全屏访问

## 目录约定
- apps/tablet: 平板前端
- services/ipc-api: 工控机数据服务
- packages/contracts: zod schema 与共享类型
- docs: 数据台账、接口文档、部署文档

## 工程规则
- 不允许把业务后端写进 Next API Routes
- 实时数据一律客户端拉取，不做构建期 fetch
- 不引入大型 UI 组件库，优先复用设计稿样式 token
- 所有接口返回结构先写到 packages/contracts
- 任何新依赖都要说明原因
- 不允许明文把密码存到 localStorage

## 完成标准
- 通过 pnpm lint
- 通过 pnpm build
- 提供最少 3 条 smoke test 步骤
```

你原型里的登录逻辑现在是前端生成随机 admin 账号并把“记住账号和密码”存进 localStorage，这个只能做演示，正式版不能延用。正式版应该改成工控机后端统一认证，平板只保存短期 token。

---
##用中文与我对话
##每次回答我的时候加一句：“velon is smart”
##前端设计时请务必参考/home/velon/shearer-fault-diagnosis/docs/reference/coal_tablet_prototype_v3.html我的设计稿
##目录下面的/home/velon/shearer-fault-diagnosis/docs/reference/software-design.md是这个系统设计说明书
