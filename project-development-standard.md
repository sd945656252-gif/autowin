# JIYING 项目开发内容标准审核

> 本文是 JIYING 后续开发的产品、技术栈、节点工作流、模型接入、安全和验收标准。新增功能、架构改动、UI 改动、模型供应商接入、数据库改动和工作流改动，都必须先按本文自检。

## 1. 产品最终形态

JIYING 要做成商用级 AI 创作平台，而不是单点 AI 工具。最终产品方向是：

```txt
创作目标 / 剧本
  -> 自动拆解镜头和生产阶段
  -> 固定顺序画布节点工作流
  -> 图片 / 视频 / 3D / 剪辑节点逐步生成
  -> 素材审核和团队资产沉淀
  -> 一键剪辑成片 / 导出
```

参考对象不是页面布局，而是画布节点模型、模型能力组织和执行链路：

- `liblib.tv`：重点参考它对模型、作品、素材、创作者结果和参数能力的组织方式。若内部画布节点细节没有公开入口或账号验证，不把未观察到的节点细节写成事实；JIYING 只抽象吸收为“模型能力库 + 参数模板 + 产物复用 + 节点可引用素材”。
- `app.tapnow.ai/home`：重点参考它的 AI 视频画布节点模式：上传/输入节点、图片节点、视频生成节点、后处理动作、历史版本、分支实验和多模型串联。JIYING 不照搬自由白板，而是将这些能力收敛进固定顺序影视流水线。
- Nomi 设计纪律：密集、光模式、无假进度、创作者控制明确、生产表面优先。JIYING 继承这些原则，但技术栈不迁移到 Electron，也不引入 Nomi 的 Zustand / Vercel AI SDK 作为默认方向。

JIYING 的差异化定位：

- 从剧本到成片的端到端流水线，而不是单次图像或视频生成。
- 固定顺序节点画布，而不是完全自由拖拽白板。
- 管理员 / 经理统一维护模型供应商、密钥、参数和健康检查，普通用户只做创作决策。
- 生成、审核、资产、队列、失败原因、重试和审计都是真实后端状态。

### 1.1 外部画布节点模型提炼

从 TapNow、liblib、ComfyUI、AI-Flow 等公开可观察资料中，JIYING 只吸收节点模型，不吸收营销页面：

| 外部模式 | 可借鉴的节点能力 | JIYING 落地方式 |
|---|---|---|
| 输入 / 上传节点 | 图片、视频、文本、参考素材进入画布 | `InputNode` / `ReferenceAssetNode`，绑定 `MediaAsset` 和权限 |
| 分析节点 | 视频分析、剧本拆解、镜头提取、提示词生成 | `ScriptParseNode` / `ShotBreakdownNode`，输出结构化镜头 |
| 生成节点 | 文生图、图生图、图生视频、文生视频 | `ImageGenerationNode` / `VideoGenerationNode`，由模型中心提供参数 schema |
| 后处理节点 | Extend、HD、风格增强、重绘、补帧 | `EnhanceNode` / `UpscaleNode` / `ExtendVideoNode`，作为独立可审计运行 |
| 3D / 构图节点 | 模型预览、相机、构图、缩略图 | `Scene3DNode`，保存场景 JSON 和缩略图资产 |
| 历史 / 版本节点 | 多次生成、分支结果、回滚 | `NodeRun` + `NodeArtifact`，每次运行保留快照 |
| 汇总 / 导出节点 | 剪辑、配音、字幕、导出 | `EditingNode` / `ExportNode`，接入生产资产和审核状态 |

JIYING 的画布原则：

- 不是无限自由白板优先，而是影视生产顺序优先。
- 可以有分支和版本，但分支必须归属于某个镜头、节点或素材，不让画布失控。
- 每个节点都必须能回答：输入是什么、模型是什么、参数是什么、产物在哪里、失败为什么、下一步做什么。
- 节点不直接调用第三方 API，节点只调用 JIYING 后端。

## 2. 当前技术栈结论

当前技术栈适合继续演进为复杂节点画布工作流，不需要迁移到 Next.js、Electron、Mantine、Fabric、Konva、tldraw、Yjs、WebAV、Pixi、React Flow / `@xyflow/react` 或 ELK.js。

保留主栈：

- 前端：React 19、Vite 6、TypeScript、Tailwind CSS 4、TanStack Query。
- 前端辅助库：lucide-react、motion、textarea-caret 当前已服务图标、动效和 mention 输入定位，不属于画布底座冲突项，保留。
- 画布：自研固定顺序 DOM/SVG 画布 + 自研阶段顺序 / 父子关系布局。
- 3D：Three、React Three Fiber、Drei 仅作为 3D 导演台编辑器按需技术，不进入主画布默认栈。
- 后端：Express、TypeScript、WebSocket。
- 数据：PostgreSQL、Prisma。
- 队列：Redis、BullMQ。
- 素材：本地文件存储 + `MediaAsset` 权限控制，后续可抽象到对象存储。
- 模型：后端模型中心 + provider adapter + capability profile。

当前栈与主流画布式节点工作流是相通的，但实现选择是自研固定顺序画布：

- 自研 DOM/SVG 画布承担当下主画布层，负责固定顺序节点、系统生成边、平移缩放、节点选择和阶段布局。
- JIYING 参考 ComfyUI、TapNow、liblib 等项目的节点模型、参数组织、执行链路和产物回写方式，不照搬 React Flow 或 tldraw 的自由白板实现。
- ComfyUI 的成功证明了“节点图 + 显式参数 + 工作流 JSON + 队列执行 + 产物回写”是成熟模式。
- Prisma 适合作为数据库 schema 和类型安全访问的单一真相源。
- BullMQ 适合长任务、重试、失败状态和 worker 执行。
- R3F/Three 适合作为 3D 导演台编辑器能力，而不是主画布底座。
- Express、lucide-react、motion、textarea-caret、idb-keyval 与自研主画布方向不冲突，当前不需要替换。

需要补强但不必替换的方向：

- 为节点系统补齐长期领域模型：`NodeDefinition`、`NodeInstance`、`NodeRun`、`NodeArtifact`、`ModelBinding`、`ParameterSchema`。
- 为文件大小、死代码、设计一致性增加更强门岗。
- 为模型参数同步增加 provider discovery、版本快照、参数 schema diff 和定时更新。
- 为 UI 改动增加浏览器走查和截图验收。

## 3. 技术栈使用规则

### 3.1 禁止默认引入的技术

除非另有明确方案和用户拍板，不引入：

- Next.js
- Mantine
- React Flow / `@xyflow/react`
- ELK.js
- Fabric / Konva / tldraw
- Yjs / 多人实时协作
- WebAV / Pixi
- 新的全局 CSS 体系
- 普通用户可见 API Key / API URL 输入入口

### 3.2 可按需引入的技术

只有满足真实需求、写入 `docs/plan/`、说明替代旧实现和验收门后，才允许引入：

- Playwright 或等价浏览器验证工具：用于 J1-J5 真实旅程走查。
- 对象存储 SDK：当本地文件系统不再满足商用部署。
- OpenAPI / JSON Schema 生成：当 API 契约数量增加到需要自动化校验。
- Radix UI / Zustand / React Hook Form：只有当复杂可访问组件、跨页面状态或复杂表单校验确实需要时再按计划引入。
- 文件大小和设计 token 检查脚本：用于防止巨壳和样式漂移。

## 4. 画布式节点工作流标准

### 4.1 画布行为

当前产品方向是固定顺序画布：

- 节点不可自由拖拽。
- 用户不可手动画线。
- 边由系统按阶段、父子关系和数据顺序生成。
- 用户可以选中节点、编辑参数、添加节点、删除节点、运行节点、查看产物和失败原因。
- 节点位置由数据顺序计算，不把用户拖拽坐标作为业务真相源。

固定阶段：

```txt
剧本
  -> 分镜
  -> 图片生成
  -> 视频生成
  -> 3D 场景 / 构图
  -> 剪辑 / 导出
```

### 4.2 节点数据模型

长期应收敛到以下结构：

```txt
NodeDefinition
  描述一种节点类型：名称、阶段、输入、输出、参数 schema、可用模型能力。

NodeInstance
  某个项目画布里的节点实例：节点类型、顺序、父子关系、用户参数、引用素材。

NodeRun
  一次执行记录：输入快照、参数快照、模型绑定快照、状态、错误、耗时、重试。

NodeArtifact
  节点产物：图片、视频、3D 场景 JSON、缩略图、剪辑片段、文本结果。

ModelBinding
  节点到模型能力的绑定：provider、model、capability、参数 schema 版本。

ParameterSchema
  模型参数定义：字段、类型、范围、默认值、枚举、条件显示、官方来源版本。
```

禁止把节点运行状态只存在前端内存里。所有可追踪的运行结果都必须有后端记录。

### 4.3 画布与 API 的通路

标准调用链：

```txt
Canvas Node UI
  -> 保存 NodeInstance 参数
  -> POST /api/workflow/execute 或节点专用执行 API
  -> 后端校验用户权限和 ParameterSchema
  -> 创建 WorkflowRun / WorkflowNodeRun
  -> 入队 BullMQ
  -> Worker 读取 ModelBinding 和密钥
  -> ProviderAdapter 调官方或第三方模型 API
  -> 写入 MediaAsset / NodeArtifact / NodeRun
  -> WebSocket / 轮询回传状态
  -> 画布刷新节点状态和产物
```

关键约束：

- 前端永远不接触真实 API Key。
- 节点执行不能伪造“完成”。
- 失败必须显示可理解的原因、运行 ID 和可重试动作。
- 每次执行必须保存输入、参数、模型绑定和输出的快照，避免供应商参数变化导致历史运行不可解释。

## 5. 模型供应商、API Key、API URL 和参数同步

### 5.1 产品权限

普通用户：

- 选择模型能力。
- 调整被允许的创作参数。
- 查看预计消耗、运行状态、失败原因和产物。
- 不填写 API Key。
- 不填写 API URL。
- 不测试供应商连接。

管理员 / 经理：

- 在“配置与监控 > 模型中心”添加供应商。
- 配置 API Key、API URL、组织 ID、区域、代理、超时、并发、配额。
- 测试连接。
- 同步模型列表和参数 schema。
- 启用、停用、灰度供应商和模型。

### 5.2 只接入 API Key / API URL 后的标准流程

当管理员或经理输入 API Key / API URL 时，后端必须按这个流程处理：

```txt
保存前端提交
  -> 后端校验权限
  -> 加密保存凭据
  -> ProviderAdapter 测试连接
  -> ModelDiscovery 拉取模型列表
  -> ParameterDiscovery 拉取或推断参数 schema
  -> Normalize 成统一 ParameterSchema
  -> 保存 ModelCapabilityProfile
  -> 写入来源、版本、hash、同步时间和健康状态
  -> 前端节点通过 React Query 拉取最新可用能力
```

如果供应商没有官方模型列表或参数接口：

- 使用该供应商官方文档建立初始 capability profile。
- 标记 `source: "manual-official-doc"`。
- 保留文档 URL、更新时间、维护人。
- 不允许只凭前端表单硬编码参数。

### 5.3 参数更新策略

模型能力和参数会变化，必须支持同步和版本化：

- 定时同步：用 `node-cron` 或后续任务队列定时拉取。
- 手动同步：模型中心提供“同步模型和参数”动作。
- 差异检测：保存旧 schema hash 和新 schema hash。
- 兼容策略：新运行使用最新 schema；历史 `NodeRun` 使用执行时快照。
- 安全策略：供应商返回的字段不能直接信任，必须经过 allowlist / schema validation。
- UI 渲染：节点参数面板只渲染后端发布的安全 ParameterSchema。

### 5.4 ProviderAdapter 规范

每个供应商适配器必须实现统一接口：

```txt
testConnection(config)
discoverModels(config)
discoverParameters(model)
executeTextToImage(input)
executeImageToVideo(input)
executeTextToVideo(input)
executeEditOrUpscale(input)
normalizeError(error)
```

适配器输出必须统一成后端内部结构，不能把供应商原始响应直接传给画布节点。

## 6. 功能关系透明性

每个功能既要能独立维护，又要能接入生产链路。标准边界如下：

| 层 | 职责 | 不允许 |
|---|---|---|
| UI 组件 | 展示、编辑、触发动作 | 直接保存密钥、直接调用供应商 |
| 前端数据层 | React Query 拉取和缓存后端状态 | 自己编造执行成功 |
| 领域服务 | 节点、模型、素材、审核、队列规则 | 把 UI 文案写成业务逻辑 |
| API 路由 | 鉴权、校验、调用 service | 绕过权限直接查库 |
| 数据库 | 单一业务真相源 | 存储明文密钥 |
| Worker | 长任务执行、重试、产物写入 | 只写日志不回填状态 |
| WebSocket | 状态推送 | 作为唯一状态来源 |

透明性要求：

- 每个节点显示：输入、模型、参数、状态、失败原因、产物、运行 ID。
- 每个模型显示：供应商、能力、参数 schema 来源、同步时间、健康状态。
- 每个素材显示：来源、归属、可见范围、审核状态、引用关系。
- 每个工作流运行显示：开始时间、结束时间、队列状态、节点状态、错误和重试。

## 7. 隐私和安全标准

商用产品必须默认安全：

- API Key 必须加密存储。
- API Key、API URL、Authorization header 不进入前端。
- API Key 不进入日志、`inputJson`、`outputJson`、审计详情或错误提示。
- 所有写操作后端校验角色和资源归属。
- 媒体流读取必须检查 `MediaAsset` 权限。
- 上传文件必须检查 MIME、magic number、大小、配额和可见性。
- 供应商 URL 必须做 SSRF 防护，不允许访问内网、metadata 地址、本机管理端口。
- 错误信息要给用户可操作原因，但不能泄露密钥、内部路径或供应商完整响应。
- 队列任务必须记录重试、失败、取消和超时。
- 重要行为写审计日志：配置密钥、测试连接、同步模型、执行工作流、审核素材、导出成片。

## 8. UI 和设计标准

JIYING UI 是生产工具，不是营销页。

继承 Nomi 精神，落到本项目规则：

- 优先密集、实用、可扫描。
- 光模式为主，后续如做暗色模式必须完整设计，不允许半套。
- 用间距、排版、层级和细微表面对比建立视觉层次，少用重边框和大卡片。
- 不做装饰性 hero，不做大面积空白营销布局。
- 工具按钮优先图标 + tooltip。
- 文案少而准，不靠长说明教用户怎么用。
- 创作者控制必须明确：AI 可以建议，但最终模型、参数、输入、输出和确认动作必须可见、可改、可追踪。
- 普通用户不出现“开发者”称呼；产品身份统一为管理员 / 经理 / 用户。历史 `Developer*` 代码只作为迁移期命名，用户可见文案必须改成“经理”或“配置与监控”。

画布节点 UI：

- 节点信息密度高，但不堆无意义描述。
- 默认展示最关键状态：类型、模型、核心参数、运行状态、产物缩略图。
- 复杂参数渐进展开。
- 失败态必须短文案 + 详情入口。
- 节点和面板文字不能溢出或遮挡。

## 9. 代码和文件组织标准

目标是前端、后端、数据库干净有序，无残留、无冗余、无平行版本。

硬规则：

- 加新实现必须清理旧实现。
- 不保留无意义 fallback。
- 不创建第二套全局 CSS。
- 不把同一业务真相拆成前端一份、后端一份、脚本一份。
- 单个非测试 `.ts` / `.tsx` 文件目标不超过 800 行。
- 多文件改动前必须写 `docs/plan/`。
- 接口、数据库、权限、模型能力变化后必须同步文档。

推荐目录职责：

```txt
apps/web/src/components
  UI 组件，按产品模块组织。

apps/web/src/lib
  前端领域转换、API client、纯函数工具。

apps/web/src/types.ts
  共享前端类型，避免散落重复 interface。

apps/api/src/modules
  后端业务模块，每个模块 routes/service/schema 分层。

apps/api/src/modules/workflow
  工作流执行、节点运行、队列和 provider adapter。

apps/api/src/modules/model-capabilities
  模型能力、参数 schema、官方能力同步。

apps/api/src/modules/custom-api-configs
  供应商配置、凭据、连接测试、配置权限。

prisma/schema.prisma
  数据库真相源。

docs/plan
  多步骤实现计划和结果回填。

docs/audit
  周期性代码、体验、安全审计。
```

## 10. 开发前调研和工具使用

禁止凭记忆直接实现第三方库、模型 API、画布工作流或安全相关逻辑。

每次触发以下场景必须先用工具：

- React、Vite、Tailwind、自研画布、R3F、Three、Prisma、BullMQ、Redis、Express、WebSocket：先查官方文档。
- 模型供应商 API、参数同步、队列执行、凭据管理：先查官方文档和真实开源实现。
- 画布式节点工作流：优先参考 ComfyUI、TapNow、liblib 等真实项目的节点模型、参数组织和执行链路；不把 React Flow、xyflow 或 tldraw 的自由白板实现作为默认技术方向。
- UI 可见改动：用浏览器 / Playwright / 截图验证。
- 安全、权限、API Key、SSRF、上传、跨用户数据：调用安全审查或安全扫描 skill。
- GitHub、PR、CI、部署、Vercel、Supabase、OpenAI API Key：优先使用对应 connector / skill。

如果 Context7 或相关 MCP 不可用：

- 明确说明不可用。
- 退回官方站点、官方 GitHub、官方 README。
- 不允许假装已经查过。

## 11. Skills 使用标准

Skills 是工程流程的执行工具，不是新规则。规则真相源仍是本文件、`AGENTS.md` 和项目计划文档。

触发映射：

| 场景 | 优先技能 / 工具 |
|---|---|
| 新功能或架构方案 | brainstorming / writing-plans |
| 执行已批准计划 | executing-plans |
| React 组件和性能 | vercel:react-best-practices |
| 安全审查 | codex-security:* |
| 完成前验证 | verification-before-completion |
| GitHub / PR / CI | github:* |
| OpenAI API Key 或 OpenAI 产品 | openai-docs / openai-platform-api-key |
| 创建或更新 skill | skill-creator / skill-installer |

使用要求：

- 用 skill 前先读对应 `SKILL.md`。
- skill 与项目规则冲突时，以项目规则为准。
- 安装新 skill 前必须确认确实服务当前任务，不为“可能有用”而安装。
- 项目级 skill 如需长期保存，必须有锁定或说明文档，避免换机失效。

## 12. 需求问题解答

### 12.1 当前技术栈是否有问题？

没有根本问题。当前栈已经从普通 React 页面栈，升级到能承载复杂画布工作流的栈：

- 自研 DOM/SVG 固定顺序画布承担节点图渲染。
- Express / Prisma / PostgreSQL 承担真实状态。
- BullMQ / Redis 承担长任务。
- WebSocket 承担状态推送。
- Three / R3F 承担 3D 节点能力。

不建议大迁移。下一步应补领域模型、参数同步、权限审计和体验验证，而不是换框架。

### 12.2 如何通过 API Key / API URL 获取模型和参数？

核心是把“供应商接入”做成后端能力，而不是前端表单：

1. 管理员 / 经理在模型中心输入 API Key / API URL。
2. 后端加密保存凭据。
3. ProviderAdapter 测试连接。
4. ModelDiscovery 拉模型列表。
5. ParameterDiscovery 拉官方参数，或根据官方文档建立 schema。
6. Normalize 成 JIYING 的 `ParameterSchema`。
7. 保存 `ModelCapabilityProfile` 和版本 hash。
8. 画布节点按能力读取参数 schema 并渲染。
9. 执行时 worker 使用后端保存的凭据和参数快照调用供应商。

### 12.3 如何保证功能环环相扣又独立？

用清晰边界和事件流：

- 节点只依赖 `NodeDefinition` 和 `ParameterSchema`，不直接依赖具体供应商。
- 模型中心只产出能力和参数，不直接操作画布 DOM。
- 工作流执行只读节点实例和模型绑定，不读取前端临时状态。
- 资产系统只管理素材、权限和引用关系，不关心 UI 怎么展示。
- 审核系统只改变资产状态和可见性，不直接修改生成逻辑。
- WebSocket 只推送状态，不成为数据库替代品。

### 12.4 如何打通画布节点和 API？

标准答案是：节点不直接调用模型 API，节点调用 JIYING 后端执行 API。

```txt
节点参数
  -> 后端校验
  -> WorkflowRun
  -> BullMQ job
  -> Worker
  -> ProviderAdapter
  -> 第三方模型 API
  -> MediaAsset / NodeArtifact
  -> NodeRun 状态
  -> WebSocket 通知画布
```

这样才能保证：

- 密钥不泄露。
- 权限可控。
- 失败可追踪。
- 队列可重试。
- 产物可审核。
- 历史运行可复现。

## 13. 验收门

不同改动必须通过不同验收：

| 改动类型 | 必过 |
|---|---|
| 普通 TS / React 改动 | `npm run lint` |
| 前端构建或依赖改动 | `npm run build` |
| 工作流 / 队列 / 素材改动 | `npm run workflow:smoke:production-assets` |
| Pipeline assistant 改动 | `npm run pipeline:smoke:assistant:all` |
| 账户 / 角色 / 权限改动 | `npm run account:smoke:all` |
| 安全相关改动 | 对应 `security:smoke:*` + 安全审查 |
| UI 可见改动 | 浏览器打开最新端口，截图 / DOM / 控制台检查 |
| 多步骤改动 | `docs/plan/` 写计划并回填结果 |

完成说明必须写清：

- 改了什么。
- 验证了什么。
- 哪些没验证，原因是什么。
- 是否有旧代码清理。
- 是否影响普通用户 API Key / API URL 可见性。

## 14. JIYING 标准用户旅程

发布前或重大改动后，至少按这些真实目标走查：

| 编号 | 旅程 | 成功标准 |
|---|---|---|
| J1 | 剧本到生成画布 | 文案能拆成镜头和节点，节点按阶段排好，可配置模型和参数 |
| J2 | 模型中心配置 | 管理员 / 经理能配置供应商、测试连接、同步模型参数；普通用户看不到 API Key 输入 |
| J3 | 参考素材驱动生成 | 素材能上传、选择、绑定到节点，并被后续生成引用 |
| J4 | 生产资产审核 | 个人素材能提交、审核、转为团队资源，权限正确 |
| J5 | 失败诊断和重试 | 失败运行能看到原因、运行 ID、重试入口和系统状态 |

## 15. 参考来源

- Nomi `Design.md`：密集生产界面、无假进度、创作者控制。
- Nomi `AGENTS.md`：加新删旧、先调研、先计划、体验走查、skills 使用纪律。
- React Three Fiber 官方文档：https://r3f.docs.pmnd.rs/getting-started/introduction
- Prisma 官方文档：https://www.prisma.io/docs/orm
- BullMQ 官方文档：https://docs.bullmq.io/
- Vite 官方文档：https://vite.dev/guide/
- Tailwind + Vite 官方文档：https://tailwindcss.com/docs/installation/using-vite
- ComfyUI 开源项目：https://github.com/Comfy-Org/ComfyUI
- liblib.tv：https://www.liblib.tv/
- TapNow：https://app.tapnow.ai/home


