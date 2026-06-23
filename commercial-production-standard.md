# JIYING 商用成品技术标准、开发规则与内容审核

> 本文是 JIYING 后续开发新内容时使用的单一商用成品标准文档。它把技术标准、开发规则、内容标准审核和 Canvas Workflow Stack Lock 合并在一起。本文定义目标技术栈和开发边界，并锁定当前主画布方向为自研固定顺序 DOM/SVG 画布；React Flow / `@xyflow/react` 和 ELK.js 不再作为主画布技术要求。未明确纳入计划的前端、后端、数据库和运行入口迁移，仍必须单独写实施计划。

## 1. 产品定位

JIYING 是商用级 AI 创作平台，目标不是单次 AI 生成工具，而是从公开展示、创作工作台、模型能力、节点工作流、生产资产、审核到导出的完整产品。

产品由两部分组成：

```txt
公开展示站 / 创作者社区
  -> 首页
  -> 作品展示
  -> 模板展示
  -> 模型能力展示
  -> 创作者主页
  -> 项目详情
  -> 登录注册
  -> 定价
  -> 帮助中心
  -> 公告
  -> SEO 页面

创作工作台 / 画布编辑器
  -> 剧本 / 创作目标
  -> 自动拆解镜头
  -> 固定顺序画布节点工作流
  -> 图片 / 视频 / 3D / 剪辑节点逐步执行
  -> 素材审核和团队资产沉淀
  -> 一键剪辑成片 / 导出
```

产品原则：

- 商用产品第一，演示页面第二。
- 公开展示和创作工作台同等重要。
- 节点工作流第一，单次生成第二。
- 后端真实状态第一，前端表现第二。
- 创作者控制第一，AI 自动化第二。
- 安全、隐私、权限和审计第一，接入速度第二。

## 2. 技术栈转换边界

当任务只是锁定商用成品技术栈和开发规则时，不应顺手改动业务代码；若用户明确要求依赖或实现清理，必须先写 `docs/plan/` 并按计划执行。

仅做标准锁定时禁止顺手改动：

- 前端业务代码。
- 后端业务代码。
- 数据库 schema。
- 依赖安装。
- 运行入口。
- 构建脚本。
- worker 代码。
- 队列代码。
- 权限代码。

后续真正迁移技术栈时，必须单独写实施计划，说明范围、不动项、旧实现清理、数据影响、权限影响、安全风险、验收命令和回滚策略。

## 3. 最终前端技术栈

### 3.1 公开展示站 / 创作者社区

固定技术栈：

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS 4
- Radix UI primitives
- TanStack Query
- Zod

职责：

- 服务公开页面。
- 服务 SEO。
- 服务作品和模板展示。
- 服务创作者主页。
- 服务项目详情和分享。
- 服务登录注册、定价、帮助和公告。

设计要求：

- 展示真实作品、真实模板、真实模型能力。
- 页面不能是空壳营销页。
- 首页必须明确产品身份、作品质量和创作入口。
- 作品页必须支持缩略图、作者、标签、能力来源和详情。
- 模型能力页必须展示能力、参数范围、适用节点和可用状态。
- 移动端必须可读、可点、无遮挡。

### 3.2 创作工作台 / 画布编辑器

固定技术栈：

- React 19
- Vite 6
- TypeScript
- Tailwind CSS 4
- TanStack Query
- Zod
- idb-keyval
- 自研固定顺序 DOM/SVG 画布
- 自研阶段顺序 / 父子关系布局算法
- Three.js
- React Three Fiber
- Drei
- lucide-react
- motion
- textarea-caret

按需引入而非当前固定栈：

- Radix UI primitives
- Zustand
- React Hook Form

职责：

- 固定顺序节点画布。
- 图片节点。
- 视频节点。
- 3D 导演台节点。
- 剪辑和导出节点。
- 参数面板。
- 运行状态。
- 失败诊断。
- 产物回写。
- 本地草稿缓存。

画布编辑器不能迁移到 Next.js。公开展示站使用 Next.js，创作工作台使用 Vite。

### 3.3 共享前端包

固定共享包：

- Shared UI package
- Shared API client package
- Shared domain types package
- Shared validation schema package

规则：

- 共享包只放真正跨应用复用的能力。
- 页面业务逻辑不能塞进共享 UI。
- 类型定义必须和后端 API、数据库领域模型保持一致。
- 表单校验必须使用共享 schema。

## 4. 最终后端技术栈

固定技术栈：

- NestJS
- NestJS Fastify adapter
- TypeScript
- Prisma
- Temporal
- Redis
- BullMQ
- WebSocket
- Python
- FastAPI
- FFmpeg
- Blender headless rendering workers

当前仓库说明：

- 当前后端实现仍是 Express + TypeScript + Prisma + WebSocket。
- 迁移 NestJS / Temporal 不属于主画布清理范围，必须另写计划、迁移路径、验收命令和回滚策略。
- 在迁移前，Express 后端仍必须承担真实权限、资产、工作流、模型中心和审计职责。

职责：

- NestJS 是产品控制面。
- NestJS 负责权限、团队、项目、模型中心、工作流、资产、审核、审计、计费和对外 API。
- Temporal 负责编排跨节点、跨服务、长时间运行、人工审核等待和恢复能力。
- BullMQ 负责媒体和模型执行队列。
- Redis 支撑队列、锁、限流、短期状态和缓存。
- WebSocket 推送节点运行状态和工作流状态。
- Python/FastAPI workers 负责模型执行、ComfyUI-style pipelines、GPU 任务、媒体分析和模型 runtime。
- FFmpeg workers 负责转码、裁剪、拼接、封面和最终导出。
- Blender headless workers 负责高质量 3D 渲染和 3D 导演台产物生成。

规则：

- 前端不直接调用模型供应商。
- 节点不直接调用第三方 API。
- Python workers 不绕过 NestJS 权限、资产、审计和模型中心。
- WebSocket 只做状态推送，不做数据库替代。
- Worker 只写日志不回填状态视为失败实现。

## 5. 最终数据库、存储和基础设施

固定技术栈：

- PostgreSQL 16
- PostgreSQL JSONB
- pgvector
- Redis
- MinIO
- ClickHouse
- HashiCorp Vault

职责：

- PostgreSQL 是业务真相源。
- JSONB 存节点参数快照、模型参数 schema 快照和 3D 场景文档。
- pgvector 支撑素材、提示词、项目和模型结果的语义检索。
- Redis 支撑队列、锁、短期状态、限流和缓存。
- MinIO 存图片、视频、GLB、缩略图、工程文件和导出文件。
- ClickHouse 存运行事件、模型成本、节点耗时、错误分布和质量分析。
- Vault 管理 provider credentials、加密密钥和敏感配置。

禁止：

- 用 MongoDB 替代 PostgreSQL。
- 把图片、视频、GLB、导出文件写入 PostgreSQL。
- 把 API Key 写入普通 JSON 字段。
- 把 API Key 写入运行 input/output。
- 把 WebSocket 状态当成唯一真相源。

## 6. 内容标准审核

新增内容前必须判断它属于哪一类：

| 内容类型 | 必须满足 | 禁止 |
|---|---|---|
| 公开展示页 | 有真实作品、真实入口、真实状态 | 空壳营销页 |
| 作品页 | 有作者、封面、产物、权限、详情 | 静态假数据 |
| 模板页 | 有模板结构、适用节点、参数约束 | 只放图片展示 |
| 模型能力页 | 有 provider、model、capability、schema、健康状态 | 硬编码前端参数 |
| 创作者主页 | 有真实作品、头像、身份、数据权限 | 编造统计 |
| 画布节点 | 有输入、参数、模型、运行、产物、失败原因 | 纯前端模拟 |
| 3D 导演台 | 有 scene JSON、相机、灯光、缩略图、资产归属 | 临时前端状态 |
| 导出页 | 有真实导出 job、文件、权限、失败原因 | 假完成 |

内容上线前必须回答：

- 这个内容是否有真实数据来源。
- 这个内容是否有后端权限校验。
- 这个内容是否能刷新后恢复状态。
- 这个内容失败时用户能看到什么。
- 这个内容是否会暴露密钥、内部路径和跨用户资源。

## 7. Canvas Workflow Stack Lock

画布默认是固定顺序影视生产工作流。

```txt
剧本
  -> 分镜
  -> 图片生成
  -> 视频生成
  -> 3D 场景 / 构图
  -> 剪辑 / 导出
```

规则：

- 节点默认不可自由拖拽。
- 用户默认不可手动画线。
- 边由系统按阶段、父子关系和数据顺序生成。
- 节点位置由数据顺序、阶段、父子关系和自研布局算法计算。
- 用户可以选中节点、编辑参数、添加节点、删除节点、运行节点、查看产物、查看失败原因、重试节点。
- 分支必须归属于镜头、节点、素材、版本和实验组。
- 画布状态必须可保存、可恢复、可审计。

标准执行链路：

```txt
Canvas Node UI
  -> 保存 NodeInstance 参数
  -> 后端校验用户权限
  -> 后端校验 ParameterSchemaVersion
  -> 创建 WorkflowRun / NodeRun
  -> Temporal 编排工作流
  -> BullMQ 下发执行 job
  -> Worker 读取 ModelCapability 和 ProviderCredential
  -> ProviderAdapter 调模型 API
  -> 写入 MediaAsset / NodeArtifact / NodeRun
  -> WebSocket 推送状态
  -> 画布刷新节点状态和产物
```

禁止：

- 节点直接调用第三方模型 API。
- 节点把运行状态只存在前端内存。
- 节点只写 console，不写数据库状态。
- 节点运行失败只显示“失败”，不提供可理解原因和运行 ID。
- 前端自己拼接 provider URL、API key、Authorization header。

## 8. 核心领域模型

后续功能必须围绕以下领域模型设计：

```txt
Workflow
WorkflowVersion
NodeDefinition
NodeInstance
NodeEdge
WorkflowRun
NodeRun
NodeArtifact
MediaAsset
ModelProvider
ModelCapability
ParameterSchemaVersion
ProviderCredential
AuditLog
```

每个节点必须能回答：

- 输入是什么。
- 参数是什么。
- 绑定哪个模型能力。
- 当前状态是什么。
- 产物在哪里。
- 失败原因是什么。
- 是否可重试。
- 是否影响后续节点。
- 谁触发了本次运行。
- 本次运行使用哪个参数快照。
- 本次运行使用哪个模型能力快照。

## 9. No Fake Progress And No Mock Completion States

这是硬规则。

禁止：

- 假进度条。
- 假完成状态。
- 前端模拟“生成成功”。
- 没有 worker 执行却显示“已完成”。
- 没有数据库记录却显示“已保存”。
- 没有真实上传却显示“上传成功”。
- 没有真实导出文件却显示“导出完成”。
- 使用 `setTimeout`、随机数和前端状态机伪造执行进度。
- 把供应商调用失败吞掉后显示成功。
- 把未实现能力包装成“后台处理中”。

必须：

- 每次执行创建真实 `WorkflowRun` 和 `NodeRun`。
- 每个运行状态来自数据库、队列、worker 和 provider 回调。
- 每个产物写入 `MediaAsset` 和 `NodeArtifact`。
- 每个失败有用户可理解原因、内部错误码、运行 ID 和重试动作。
- 每个长任务有 queued、running、succeeded、failed、cancelled、timed_out 状态。
- 每个状态变化可审计、可追踪、可复现。

允许显示“进行中”的前提：

- 后端已有运行记录。
- 队列已有 job。
- 前端显示真实 run id。
- 刷新页面后状态仍可恢复。

## 10. 模型中心和供应商接入

普通用户：

- 选择可用模型能力。
- 调整被允许的创作参数。
- 查看预计消耗、运行状态、失败原因和产物。
- 不填写 API Key。
- 不填写 API URL。
- 不测试供应商连接。

管理员 / 经理：

- 添加供应商。
- 配置 API Key。
- 配置 API URL。
- 配置组织 ID、区域、代理、超时、并发和配额。
- 测试连接。
- 同步模型列表。
- 同步参数 schema。
- 启用、停用、灰度供应商和模型。

ProviderAdapter 必须实现：

```txt
testConnection(config)
discoverModels(config)
discoverParameters(model)
executeTextToImage(input)
executeImageToImage(input)
executeImageToVideo(input)
executeTextToVideo(input)
executeEditOrUpscale(input)
normalizeError(error)
```

参数 schema 规则：

- 使用官方 API 和官方文档建立参数 schema。
- 保存来源、版本、hash、同步时间和维护人。
- 新运行使用最新 schema。
- 历史运行使用执行时 schema snapshot。
- 前端只渲染后端发布的安全 ParameterSchemaVersion。
- 供应商返回字段必须经过 allowlist 和 schema validation。

## 11. 3D 导演台节点标准

3D 导演台是正式节点，不是前端小组件。

`Scene3DNode` 必须保存：

- scene JSON
- glTF / GLB 资产关联
- 相机
- 灯光
- 构图
- 角色和物体位置
- 镜头路径
- 关键帧
- 景别
- 焦距
- 预览缩略图
- 参考帧
- 下游节点关联关系

3D 节点输出：

- 预览图。
- reference frame。
- camera metadata。
- scene JSON。
- thumbnail asset。
- downstream artifact references。

规则：

- 3D 场景保存必须走后端。
- 3D 缩略图必须写入 `MediaAsset`。
- 3D 场景 JSON 必须有 owner、team、project、workflow、node 归属。
- 3D 渲染失败必须写入 `NodeRun` 错误状态。
- 3D 产物必须能被图片节点、视频节点和剪辑节点关联使用。

## 12. 资产、审核和导出

所有媒体产物都必须进入资产系统。

资产必须记录：

- 所属用户。
- 所属团队。
- 所属项目。
- 来源节点。
- 来源运行。
- MIME。
- 文件大小。
- hash。
- 可见范围。
- 审核状态。
- 关联关系。

禁止：

- 使用裸文件路径绕过权限。
- 前端直接访问未鉴权媒体文件。
- 把 base64 大文件写入数据库。
- 上传后不检查 MIME、magic number、大小和配额。
- 跨用户、跨团队、跨项目读取素材。

导出必须：

- 创建真实导出运行记录。
- 写入队列 job。
- 由 FFmpeg worker 生成文件。
- 写入 `MediaAsset`。
- 记录导出参数、输入素材、耗时、失败原因和下载权限。

## 13. 安全和隐私规则

硬规则：

- API Key 不进前端。
- API Key 不进日志。
- API Key 不进 `inputJson`。
- API Key 不进 `outputJson`。
- API URL 不由普通用户填写。
- Authorization header 不进前端。
- ProviderCredential 必须加密保存。
- 密钥由 Vault 管理。
- 所有写操作后端校验角色和资源归属。
- 所有媒体读取后端校验权限。
- 供应商 URL 做 SSRF 防护。
- 错误信息不能泄露密钥、内部路径和供应商完整响应。
- 重要行为写 `AuditLog`。

安全重点：

- 登录注册。
- 团队和角色。
- 模型中心。
- 供应商凭据。
- 文件上传。
- 媒体流读取。
- 工作流执行。
- worker input/output。
- 导出文件。
- 公开作品页。
- 创作者主页。

## 14. UI 和设计标准

公开展示站：

- 可以有品牌表达和作品展示。
- 首屏必须让用户理解产品身份、作品质量和创作入口。
- 作品、模板、模型能力、创作者信息必须可检索、可筛选、可分享。
- SEO 页面必须服务真实公开内容，不制造空壳页面。
- 页面必须有移动端适配。

创作工作台：

- 密集、实用、可扫描。
- 页面首屏给工作区。
- 工具按钮优先图标 + tooltip。
- 信息分层靠间距、排版和轻表面对比。
- 少用重边框、大卡片和长说明。
- 节点卡片显示最有行动价值的信息。
- 复杂参数渐进展开。
- 失败态必须短文案 + 详情入口。
- 文本不能溢出、遮挡、压住控件。
- 弹层、菜单、下拉必须检查遮挡、裁剪和视口溢出。

新增用户可见 UI 前必须：

- 先读同类组件。
- 对齐现有密集生产工具风格。
- 设计空、加载、成功、失败、权限不足、无数据、超时状态。
- 浏览器截图验证。
- DOM 和控制台检查。

## 15. 代码组织和模块边界

目标结构：

```txt
apps/portal
  Next.js 公开展示站和创作者社区

apps/studio
  Vite 创作工作台和画布编辑器

apps/api
  NestJS API 控制面

apps/workers
  TypeScript workers

services/python-workers
  FastAPI AI / media / 3D workers

packages/ui
  共享 UI primitives

packages/api-client
  共享 API client

packages/domain
  共享领域类型

packages/schemas
  共享 Zod schema

prisma/schema.prisma
  数据库真相源

docs/plan
  多步骤计划和结果回填

docs/audit
  审计和体验走查结果
```

规则：

- UI、API、service、worker、database 分层。
- 不把业务真相拆成前端一份、后端一份、脚本一份。
- 不为同一功能保留两套入口。
- 新实现替代旧实现时同步删除旧代码。
- 单个非测试 `.ts` / `.tsx` 文件目标不超过 800 行。
- 不创建第二套全局 CSS。
- 不保留无意义 fallback。

## 16. 开发规则

触发以下场景时，动手前必须写计划：

- 多文件改动。
- 多步骤改动。
- 架构改动。
- 数据库改动。
- 权限改动。
- 工作流改动。
- 模型接入改动。
- 队列改动。
- 3D 节点改动。
- UI 重大改动。
- 引入新依赖。

计划必须包含：

- 范围。
- 不动项。
- 旧实现清理计划。
- 数据库影响。
- 权限影响。
- 安全风险。
- 验收命令。
- 浏览器验证方式。
- 回滚策略。

涉及第三方库、模型 API、自研画布、R3F、Three、Prisma、BullMQ、Temporal、Redis、Next.js、NestJS、FastAPI、FFmpeg、Blender 时，必须先查官方文档。

涉及画布节点工作流、模型供应商接入、参数同步、队列执行、凭据管理、安全策略时，必须参考真实开源项目和官方文档。

工具不可用时必须明确说明，不得假装已经查过。

## 17. 验收门

| 改动类型 | 必跑 |
|---|---|
| TypeScript / React | `npm run lint` |
| 前端构建 / 依赖 / 运行入口 | `npm run build` |
| 工作流 / 队列 / 素材 | `npm run workflow:smoke:production-assets` |
| Pipeline assistant | `npm run pipeline:smoke:assistant:all` |
| 账户 / 角色 / 权限 | `npm run account:smoke:all` |
| 安全相关 | 对应安全 smoke + 安全审查 |
| UI 可见改动 | 浏览器截图 / DOM / 控制台检查 |
| 公开展示站 | SEO 路由、公开详情页、分享预览、移动端截图 |
| 3D 节点 | WebGL 非空、场景保存、缩略图资产、后端权限 |
| 导出链路 | FFmpeg worker、导出文件、MediaAsset、下载权限 |

完成说明必须写清：

- 改了什么。
- 清理了什么旧实现。
- 运行了哪些验证命令。
- 哪些未验证。
- 未验证原因。
- 是否影响普通用户 API Key / API URL 可见性。
- 是否存在安全、权限、队列、素材和工作流风险。

## 18. 标准用户旅程

发布前和重大改动后，至少走查：

| 编号 | 旅程 | 成功标准 |
|---|---|---|
| J1 | 公开站浏览作品 | 用户能看到作品、创作者、模板、详情和进入创作入口 |
| J2 | 剧本到生成画布 | 文案能拆成镜头和节点，节点按阶段排好，可配置模型和参数 |
| J3 | 模型中心配置 | 管理员 / 经理能配置供应商、测试连接、同步模型参数；普通用户看不到 API Key 输入 |
| J4 | 素材驱动生成 | 素材能上传、选择、绑定到节点，并被后续生成使用 |
| J5 | 3D 导演台生成参考帧 | 3D 场景能保存、生成缩略图和参考帧，并被下游节点使用 |
| J6 | 生产资产审核 | 个人素材能提交、审核、转为团队资源，权限正确 |
| J7 | 失败诊断和重试 | 失败运行能看到原因、运行 ID、重试入口和系统状态 |
| J8 | 一键导出成片 | 剪辑导出走真实 worker，生成可下载资产，权限正确 |

## 19. 禁止清单

禁止默认引入：

- Electron
- Mantine
- `@xyflow/react` / React Flow 作为主画布默认底座
- ELK.js 作为主画布默认布局依赖
- Fabric
- Konva
- tldraw
- Yjs
- WebAV
- Pixi
- MongoDB
- 普通用户 API Key 输入
- 普通用户 API URL 输入

禁止行为：

- 假进度。
- 假完成。
- 纯前端模拟成功。
- 只改 UI 不接后端。
- 只写日志不回填状态。
- 旧入口和新入口并存。
- 无意义 fallback。
- API Key 暴露到前端。
- 密钥写入日志。
- 大媒体文件写入 PostgreSQL。
- 供应商原始响应直接传给前端。
- Worker 绕过权限和资产系统。
- WebSocket 作为唯一状态来源。
- 文档和代码长期不一致。


