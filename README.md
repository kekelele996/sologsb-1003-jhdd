# 开源文档本地化翻译工作台

面向开源文档维护者的 Markdown 本地化工作台。支持左右对照翻译、受保护语法识别、本地术语检查、句子讨论和逐条审校。

## 功能

- 导入 Markdown 文档并保持标题、段落、代码块、链接与变量占位符的片段边界。
- 源文与译文左右对照编辑；代码块、链接 URL、`{{variable}}`、`{variable}` 和 `%s` 等占位符自动识别并保护。
- 本地术语表检查漏译、变量缺失、链接不一致、术语偏差和代码块改动；检查请求由 MSW 模拟接口执行。
- 译者可为任意句子留下讨论，字段包括作者、内容、解决状态和时间。
- 翻译模式支持逐段编辑，审校模式支持逐条确认、单条退回和勾选片段后的批量退回。
- 修改历史包含编辑、确认、退回、冲突处理和导入记录；可解决本地与远端翻译冲突。
- 快捷键：`J` / `K` 快速跳到下一条 / 上一条问题，`C` 确认当前片段，`R` 退回当前片段，`Ctrl/⌘ + Z` 撤销，`Ctrl/⌘ + Shift + Z` 重做。
- 草稿自动写入 `localStorage`，刷新或断网后恢复；有未保存内容时离开页面会提示。
- 窄屏下自动将三栏重排为单栏，源文与译文上下排列，翻译和审校操作仍可完成。

## 技术栈

- Next.js 15 + React 19 + TypeScript
- TanStack Query
- shadcn/ui 组件结构（Radix Tabs、Slot、CVA、Tailwind CSS）
- MSW 浏览器模拟接口
- localStorage 草稿持久化

## 本地开发

```bash
npm install
npm run dev
```

开发端口由 Next.js 决定，源码不硬编码宿主端口。首次运行会由 `public/mockServiceWorker.js` 注册 MSW。

## 生产构建

```bash
npm install
npm run build
```

项目使用 Next.js 静态导出，产物位于 `out/`。

## Docker

```bash
docker build -t sologsb-1003 .
docker run --rm -p 10003:80 sologsb-1003
```

容器内的 nginx 监听 `80`，访问 `http://localhost:10003`。刷新路由和 MSW worker 均由 nginx 提供。
