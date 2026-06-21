# 节点接入底座：领域模型与执行契约实施计划

## 范围

本计划定义后续开发 `panorama`、`scene3d`、`voice`、`music` 四类节点前必须补齐的节点接入底座。

目标不是现在实现四类节点，而是让后续每个新节点都沿现有链路接入：

```txt
自研 DOM/SVG 主画布
  -> CanvasNode / NodeInstance 参数
  -> 后端权限和参数校验
  -> WorkflowRun / WorkflowNodeRun
  -> BullMQ / worker / provider adapter
  -> MediaAsset / NodeArtifact
  -> WebSocket / 轮询状态
  -> 画布刷新产物和失败原因
```

当前已确认的现有基础：

- 前端已有 `CanvasNode` 和 `CanvasState`。
- 后端已有 `Workflow`、`WorkflowVersion`、`WorkflowRun`、`WorkflowNodeRun`。
- 资产侧已有 `MediaAsset`、`ProductionAsset`、`ProductionAssetSnapshot`。
- 模型侧已有 `ModelCapabilityProfile` 和 `ModelCapabilityRevision`。
- 当前 `ModelCapability` 仍以 `TEXT_GENERATOR`、`IMAGE_GENERATOR`、`VIDEO_GENERATOR` 为主。
- 当前执行入口已有 `/api/workflow/execute`。
- 当前 `workflow-schema.service.ts` 已有 workflow schema 和敏感字段脱敏。

## 不动项

- 不迁移主画布，不引入 React Flow / `@xyflow/react` / ELK.js。
- 不创建第二套节点系统。
- 不让节点直接调用第三方供应商 API。
- 不让普通用户填写或看到 API Key / API URL。
- 不把密钥、provider URL、Authorization header 写入前端、日志、`inputJson` 或 `outputJson`。
- 不用前端状态替代后端运行记录。

## 分阶段实施方案

### Phase 1：统一节点契约

目标：先把节点类型、输入、输出、参数、运行状态和产物引用收敛为统一契约。

建议改动：

- 在前端类型层为 `CanvasNode` 增加受控节点类型方向，至少覆盖：
  - `image`
  - `video`
  - `panorama`
  - `scene3d`
  - `voice`
  - `music`
  - `editing`
- 定义通用 `NodeInputRef`、`NodeOutputRef`、`NodeArtifactRef` 方向，用于表达素材和下游引用。
- 定义节点参数快照规则：前端保存可编辑参数，后端运行时保存输入、参数、模型能力和产物快照。
- 保持旧 `CanvasNode.type: string` 的兼容迁移路径，避免一次性破坏已有图片/视频节点。

验收重点：

- 老项目和旧节点仍可读取。
- 图片/视频节点现有字段不丢失。
- 新节点类型只是受控扩展，不改变主画布布局逻辑。

### Phase 2：后端 schema 和运行契约

目标：后端能够识别新节点类型，并拒绝不完整或越权的节点运行请求。

建议改动：

- 扩展 workflow schema，保留敏感字段脱敏。
- 为新节点准备后端 zod schema：
  - `panorama`：全景 assetId、视角、热点、reference frame 设置。
  - `scene3d`：scene JSON、GLB/glTF assetId、相机、灯光、关键帧。
  - `voice`：文本、角色、voice profile、参考音频 assetId、输出格式。
  - `music`：提示词、风格、BPM、时长、参考音频 assetId、输出格式。
- 所有素材输入必须先通过 `MediaAsset` 权限校验。
- 执行前必须创建真实 `WorkflowRun` / `WorkflowNodeRun` 或沿现有运行记录模型补齐节点级关联。

验收重点：

- 请求缺少 assetId、参数 schema 或权限时必须失败。
- 失败响应必须有可理解原因和运行 ID。
- 密钥字段仍会被脱敏。

### Phase 3：模型能力和参数 schema 扩展

目标：让四类节点从模型中心读取能力和参数，而不是前端硬编码供应商参数。

建议能力方向：

```txt
PANORAMA_PROCESSOR
SCENE3D_RENDERER
VOICE_GENERATOR
SPEECH_TO_TEXT
MUSIC_GENERATOR
AUDIO_PROCESSOR
```

实施要求：

- 如果需要修改 `ModelCapability` enum，必须写 Prisma migration。
- 每个 capability 都必须有参数 schema、来源、版本、hash、同步时间和健康状态。
- 历史运行使用执行时 schema snapshot。
- 前端只渲染后端发布的安全参数 schema。

验收重点：

- 普通用户只选择能力和参数，不填写 API Key / API URL。
- 管理员 / 经理在模型中心维护供应商、密钥和连接测试。
- 供应商原始响应不能直接传给前端。

### Phase 4：资产和 artifact 关联

目标：所有节点产物都能被下游节点、剪辑、审核和导出复用。

建议 artifact 类型方向：

```txt
panorama_view
scene_json
camera_metadata
reference_frame
voice_audio
music_audio
subtitle_timeline
audio_timeline_metadata
```

实施要求：

- 图片、视频、全景图、GLB/glTF、语音、音乐都进入 `MediaAsset`。
- 节点产物保存 assetId、snapshotId、nodeId、runId、metadata 和下游引用关系。
- 大媒体文件不写 PostgreSQL。
- 资产读取必须校验用户、团队、项目、可见性和审核状态。

验收重点：

- 刷新页面后产物仍可恢复。
- 跨项目、跨用户读取必须失败。
- 下游节点必须通过 assetId 引用上游产物。

### Phase 5：先实现 PanoramaNode v1

推荐第一个实现 `PanoramaNode`，因为它风险最低，能验证新节点接入底座：

- 读取全景图片 `MediaAsset`。
- 保存 yaw、pitch、fov、热点 metadata。
- 生成或保存 reference frame。
- 将 reference frame 写入 `MediaAsset`。
- 下游图片、视频、3D 导演台节点可引用该 frame 和 camera metadata。

`PanoramaNode` 成功后，再做 `Scene3DNode`、`VoiceNode`、`MusicNode`。

## 数据库影响

本计划本身不修改数据库。

后续 Phase 2 / Phase 3 / Phase 4 可能需要：

- 扩展 `ModelCapability` enum。
- 新增或扩展节点 artifact 记录。
- 关联 `WorkflowNodeRun`、`MediaAsset`、`ProductionAsset`。
- 保存节点参数和模型能力 snapshot。

实际 schema 改动必须单独写 migration 计划和回滚策略。

## 权限影响

后续实现必须保持：

- 普通用户不能看到或填写 API Key / API URL。
- 供应商凭据只允许管理员 / 经理在模型中心维护。
- 所有素材输入和产物读取都必须走后端权限校验。
- `scene3d`、`voice`、`music` 参考素材不能跨项目、跨团队、跨用户越权读取。

## 安全风险

重点风险：

- 全景图、GLB/glTF、音频文件上传绕过 MIME / magic number 校验。
- Provider URL SSRF。
- 供应商响应泄露密钥、内部路径或上游原始错误。
- 大文件写入数据库。
- 前端缓存导致跨用户媒体泄露。
- 假进度、假完成或 worker 只写日志不回填状态。

安全要求：

- 使用 `codex-security:*` 做凭据、上传、媒体读取、SSRF、跨用户资源审查。
- 所有失败必须记录运行 ID 和可理解原因。
- 所有输出进入 `MediaAsset` / artifact，而不是前端临时对象。

## MCP、Skills 和工具调用

后续开发必须使用：

- Context7：查询 Three、R3F、Drei、Prisma、BullMQ、FFmpeg、供应商 SDK 官方文档。
- Browser / in-app browser：验证 UI、WebGL、音频播放、DOM、控制台、截图。
- `codex-security:*`：安全审查。
- `jiying-project-development`：保持本项目规则。

工具要求：

- 本地检索优先 `rg`。
- 多文件改动前更新 `docs/plan/`。
- UI 可见改动必须浏览器验证。
- 依赖引入必须说明理由、影响、替代方案和回滚。

## 验收命令

本计划是文档计划，只需文档级验证：

```txt
git status --short
```

后续真正实现节点接入底座时至少运行：

```txt
npm run lint
npm run build
npm run workflow:smoke:production-assets
npm run security:smoke:media-stream-access
npm run security:smoke:reference-asset-access
```

如果涉及 pipeline assistant：

```txt
npm run pipeline:smoke:assistant:all
```

如果涉及账号、角色、项目权限：

```txt
npm run account:smoke:all
```

## 浏览器验证方式

本计划无 UI 改动，不做浏览器验证。

后续实现时必须覆盖：

- `/pipeline` 画布打开无控制台错误。
- 新节点可选中、编辑、保存、刷新恢复。
- WebGL 画面非空。
- 音频可播放。
- 运行状态和失败原因可见。
- 普通用户看不到 API Key / API URL。

## 回滚策略

本计划文档可通过删除以下文件回滚：

```txt
docs/plan/2026-06-21-node-domain-execution-contract.md
```

后续代码实现必须在各自计划中提供：

- migration rollback。
- 依赖移除方案。
- 旧节点兼容策略。
- 数据回填或清理方案。

## 执行结果

- 已确认当前项目已有 `CanvasNode`、`WorkflowRun`、`WorkflowNodeRun`、`MediaAsset`、`ProductionAsset`、`ModelCapabilityProfile` 等基础。
- 已确认当前不应创建第二套节点系统。
- 已确认下一步应优先补节点领域模型和执行契约，再实现 `PanoramaNode v1`。
- 本计划未修改业务代码、依赖、数据库 schema 或 UI。

