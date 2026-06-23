# JIYING 工具、Skills、MCP 与技术栈补充建议

本文记录当前项目已经确认和推荐采用的工程工具边界。它不是业务需求文档；真正改业务、依赖、数据库、队列、模型或 UI 前，仍必须按 `commercial-production-standard.md` 和 `project-development-standard.md` 写 `docs/plan/`。

## 已执行

- 已配置并在当前 Codex 会话中发现 Context7 MCP，用于查询库、框架、SDK、CLI 和云服务的当前官方文档。
- 已新增本机 Codex skill：`jiying-project-development`。
- 已保持当前主画布技术栈：自研固定顺序 DOM/SVG 画布，不引入 React Flow / `@xyflow/react` / ELK.js。

本机 skill 路径：

```txt
C:\Users\0130\.codex\skills\jiying-project-development
```

## MCP 建议

### 必备

| MCP / 工具 | 用途 | 当前处理 |
|---|---|---|
| Context7 | React、Vite、Tailwind、Prisma、BullMQ、Redis、Three/R3F、供应商 SDK 等官方文档查询 | 已配置，使用前不得发送密钥或敏感代码 |
| Browser / in-app browser | UI 可见改动、DOM、控制台、截图验证 | 已可用，UI 改动必须用 |
| GitHub connector / skills | PR、review comment、CI、issue、发布协作 | 有 GitHub 任务时使用 |
| codex-security skills | API Key、SSRF、上传、媒体读取、权限、跨用户数据、安全审查 | 安全相关改动必须用 |

### 暂不引入

| MCP / 工具 | 暂不引入原因 |
|---|---|
| Supabase | 当前项目真相源是 PostgreSQL + Prisma，不把 Supabase 当成默认后端 |
| Vercel 项目管理工具 | 当前没有部署迁移任务，不把 Vercel 当成默认运行平台 |
| Canva / Figma | 当前不是设计资产生成或 Figma 交付任务 |
| Slack / Google Drive | 当前不是团队协作资料同步任务 |

## Skills 建议

| Skill | 触发场景 |
|---|---|
| `jiying-project-development` | 任何 JIYING/autowin-source 代码、文档、工具、依赖、工作流、画布、模型、队列、3D 或安全改动 |
| `skill-creator` | 创建或更新项目级 Codex skill |
| `browser:control-in-app-browser` | 打开 localhost、检查 DOM、控制台、截图、真实 UI 验证 |
| `codex-security:*` | 凭据、上传、媒体权限、SSRF、跨用户数据、审计、安全扫描 |
| `github:*` | PR、CI、review comment、GitHub issue |
| `openai-docs` / `openai-platform-api-key` | OpenAI 产品、OpenAI API Key、OpenAI SDK 接入 |
| `vercel:react-best-practices` | 大范围 React/TSX 组件改动后的质量检查 |

## 工具调用规范

- 本地检索优先用 `rg` 和 `rg --files`。
- 改项目前先确认仓库根、Git 状态和项目结构。
- 涉及第三方库、框架、SDK、CLI 或云服务时，优先用 Context7 查询官方文档。
- UI 可见改动必须用浏览器验证，不能只靠构建通过。
- 安全相关改动必须做对应安全 smoke 或安全审查。
- 不把 API Key、token、供应商 URL、Authorization header 写入前端、日志、文档或运行 JSON。

## 技术栈建议

### 当前继续保持

- 前端：React 19、Vite 6、TypeScript、Tailwind CSS 4、TanStack Query、Zod。
- 画布：自研固定顺序 DOM/SVG 画布 + 自研阶段顺序 / 父子关系布局算法。
- 3D：Three.js、React Three Fiber、Drei 只服务 3D 导演台编辑器，不作为主画布底座。
- 后端：Express、TypeScript、Prisma、PostgreSQL、WebSocket、Redis、BullMQ。
- 辅助：lucide-react、motion、textarea-caret、idb-keyval 继续保留，不与主画布方向冲突。

### 可后续补充，但必须单独确认

| 技术 | 补充条件 |
|---|---|
| Playwright | 需要把浏览器验收自动化进 CI，覆盖 pipeline、模型中心、素材、3D、导出等真实旅程 |
| OpenAPI / JSON Schema | API 数量和节点参数 schema 增长到需要契约生成、校验和前后端同步 |
| 对象存储 SDK | 本地媒体文件存储无法满足商用部署、权限隔离和横向扩展 |
| Vault / KMS | ProviderCredential 加密管理进入正式部署阶段 |
| pgvector | 需要素材、提示词、项目、模型结果的语义检索 |
| ClickHouse | 需要成本、耗时、错误分布、质量分析和运行事件分析 |
| Temporal / NestJS / FastAPI workers | 进入控制面重构、长工作流编排或 Python/GPU worker 正式拆分阶段 |

### 继续禁止默认引入

- React Flow / `@xyflow/react`
- ELK.js
- tldraw
- Konva
- Fabric
- Electron
- Mantine
- WebAV
- Pixi
- 普通用户 API Key / API URL 输入入口

## 执行结论

当前项目最应该先补的是工程执行规则和验证工具，而不是更换主技术栈。主画布保持自研 DOM/SVG，后续真正值得补的是参数 schema 契约、自动化浏览器验收、安全扫描、对象存储和凭据管理，但这些都应按具体功能计划逐项引入。

