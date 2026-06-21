# JIYING 四类未来节点标准设计

> 本文定义后续 3D 全景图、3D 导演台、语音、音乐节点的统一标准。它是设计标准，不是实现补丁；真正实现任一节点前，仍必须按 `commercial-production-standard.md`、`project-development-standard.md` 和 `docs/plan/` 单独写实施计划。

## 1. 适用范围

本文覆盖四类未来节点：

- `PanoramaNode`：3D 全景图节点。
- `Scene3DNode`：3D 导演台节点。
- `VoiceNode`：语音节点。
- `MusicNode`：音乐节点。

本文不做以下事情：

- 不实现节点 UI。
- 不修改 `CanvasNode`、Prisma schema、API routes 或 worker。
- 不新增依赖。
- 不引入新的主画布底座。
- 不让普通用户填写或看到 API Key / API URL。

## 2. 通用节点契约

四类节点都必须属于当前自研固定顺序 DOM/SVG 主画布。主画布只负责节点编排、阶段布局、选择、编辑入口和状态展示；节点内部可以有专用编辑器，但不能替换主画布。

每个节点必须能回答：

- 输入是什么。
- 参数是什么。
- 绑定哪个模型能力或处理能力。
- 当前状态是什么。
- 产物写在哪里。
- 失败原因是什么。
- 是否可重试。
- 是否影响下游节点。
- 谁触发了运行。
- 使用了哪个参数快照和模型能力快照。

标准执行链路：

```txt
Canvas Node UI
  -> 保存 NodeInstance / CanvasNode 参数
  -> 后端校验用户、角色、项目和素材权限
  -> 后端校验 ParameterSchema / ModelCapability
  -> 创建 WorkflowRun / NodeRun
  -> 入队 BullMQ 或调用对应 worker
  -> Worker / ProviderAdapter 执行
  -> 写入 MediaAsset / NodeArtifact / WorkflowRun 输出
  -> WebSocket / 轮询推送状态
  -> 画布刷新节点状态和产物
```

禁止：

- 节点直接调用第三方模型 API。
- 节点把运行状态只存在前端内存。
- 前端拼接 provider URL、API key、Authorization header。
- 使用假进度、假完成、前端模拟成功。
- 生成、上传、保存、导出失败后仍显示成功。
- 供应商原始响应直接透传给前端。

## 3. 统一数据和产物标准

### 3.1 节点类型预留

未来类型方向：

```txt
panorama
scene3d
voice
music
```

这些是设计方向，不代表当前已经修改类型或数据库枚举。真正落地时必须单独更新类型、API、schema 和迁移计划。

### 3.2 模型能力方向预留

未来能力方向：

```txt
PANORAMA_PROCESSOR
SCENE3D_RENDERER
VOICE_GENERATOR
SPEECH_TO_TEXT
MUSIC_GENERATOR
AUDIO_PROCESSOR
```

如果供应商能力来自模型中心，必须有：

- provider。
- model。
- capability。
- 参数 schema。
- schema 来源。
- schema hash。
- 同步时间。
- 健康状态。
- 是否可执行。

### 3.3 Artifact 类型方向

未来 artifact 应覆盖：

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

所有真实媒体文件必须写入 `MediaAsset`。节点产物只保存引用、参数快照、metadata 和下游关系，不把大媒体文件写入 PostgreSQL。

## 4. PanoramaNode 标准

`PanoramaNode` 用于在影视工作流中查看、标注和复用 3D 全景图素材。

### 4.1 输入

- 全景图片 `MediaAsset`，例如 equirectangular JPG/PNG/WebP。
- 可选全景视频 `MediaAsset`。
- 可选参考镜头、角色、场景、构图说明。
- 可选上一节点生成的图片、视频或 3D 场景输出。

### 4.2 参数

- 初始视角：yaw、pitch、fov。
- 视角范围限制。
- 热点列表：位置、标签、说明、目标节点或资产引用。
- 参考帧导出设置：宽、高、格式。
- 预览质量：仅用于前端预览，不影响原始资产。

### 4.3 输出

- 全景预览状态。
- 视角 metadata。
- 热点 metadata。
- reference frame `MediaAsset`。
- 下游节点可引用的 camera metadata 和 frame artifact。

### 4.4 验收

- 全景素材读取必须走后端权限校验。
- 刷新页面后视角、热点和引用关系可恢复。
- 导出的 reference frame 必须写入 `MediaAsset`。
- WebGL 或图片渲染失败必须给出可理解错误。
- 不允许只用前端临时状态保存热点和视角。

## 5. Scene3DNode 标准

`Scene3DNode` 是 3D 导演台节点，不是临时 3D 小组件。它用于构图、相机、灯光、角色/物体摆放、镜头路径和参考帧生成。

### 5.1 输入

- GLB / glTF / 图片 / 视频 `MediaAsset`。
- 剧本、镜头、角色、场景、风格参考。
- 上游图片节点或视频节点产物。
- 可选全景节点输出的视角和 reference frame。

### 5.2 参数

- scene JSON。
- 相机：位置、旋转、焦距、景别、运动路径。
- 灯光：类型、强度、颜色、位置。
- 角色和物体：资产引用、变换、可见性。
- 关键帧：时间、目标、插值方式。
- 构图辅助：安全框、比例、参考层。

### 5.3 输出

- scene JSON artifact。
- camera metadata artifact。
- 缩略图 `MediaAsset`。
- reference frame `MediaAsset`。
- 可选预览视频或相机路径预览。
- 下游图片、视频、剪辑节点可引用的资产和 metadata。

### 5.4 验收

- 3D 场景保存必须走后端。
- scene JSON 必须有 owner、team、project、workflow、node 归属。
- 缩略图和 reference frame 必须写入 `MediaAsset`。
- WebGL 画面必须非空，浏览器控制台不能有关键渲染错误。
- 渲染失败必须写入运行错误状态，不能显示假完成。

## 6. VoiceNode 标准

`VoiceNode` 用于语音生成、配音、旁白、角色台词和语音处理。

### 6.1 输入

- 剧本、分镜、台词文本。
- 角色、情绪、语速、语言、音色选择。
- 可选参考音频 `MediaAsset`。
- 可选视频或剪辑时间轴片段。

### 6.2 参数

- voice model / voice profile。
- 语言、情绪、语速、音量、停顿。
- 角色绑定。
- 分句和字幕策略。
- 输出格式和采样率。
- 可选 reference voice assetId。

### 6.3 输出

- 语音音频 `MediaAsset`。
- subtitle timeline artifact。
- audio timeline metadata。
- 台词到音频时间戳映射。
- 可选语音质量分析 metadata。

### 6.4 验收

- 语音生成必须创建真实运行记录。
- 音频文件必须写入 `MediaAsset`。
- 参考音频读取必须校验权限。
- 失败必须显示供应商归一化后的可理解原因。
- API Key、API URL、原始供应商响应不能进入前端和运行 JSON。

## 7. MusicNode 标准

`MusicNode` 用于配乐生成、音乐素材整理和剪辑时间线下游引用。

### 7.1 输入

- 文字描述、风格、情绪、节奏、用途。
- 剧本、分镜或剪辑段落。
- 可选参考音乐或声音素材 `MediaAsset`。
- 可选视频或剪辑时间轴片段。

### 7.2 参数

- music model / capability。
- 风格、情绪、BPM、调性、时长。
- 是否循环。
- 段落结构：intro、verse、build、drop、outro。
- 输出格式、采样率、响度目标。

### 7.3 输出

- 音乐音频 `MediaAsset`。
- BPM、key、loop points。
- audio timeline metadata。
- 剪辑节点可引用的片段边界。
- 可选 stems 或版本列表。

### 7.4 验收

- 音乐生成必须走后端和模型中心。
- 输出音频必须写入 `MediaAsset`。
- 失败必须可重试并带运行 ID。
- 下游剪辑节点必须能引用音频 assetId。
- 不允许前端模拟“生成完成”。

## 8. 技术栈和依赖边界

当前不新增依赖。

3D 实现阶段再按单独计划补充：

- `three`
- `@react-three/fiber`
- `@react-three/drei`

这些库只服务 3D 全景图和 3D 导演台的节点内部编辑器，不作为主画布底座。

音频 v1 优先使用：

- 原生 `HTMLAudioElement`。
- Web Audio API。
- 后端 FFmpeg / `fluent-ffmpeg` 做转码、裁剪、混音、封面和导出。

暂不引入：

- React Flow / `@xyflow/react`。
- ELK.js。
- tldraw。
- Konva。
- Fabric。
- WebAV。
- Pixi。
- 完整 DAW 库。
- 普通用户 API Key / API URL 输入入口。

## 9. MCP、Skills 和工具调用

后续实现四类节点时必须使用：

- Context7：查询 Three、R3F、Drei、Prisma、BullMQ、FFmpeg、供应商 SDK 官方文档。
- Browser / in-app browser：验证 WebGL、音频播放、DOM、控制台和截图。
- `codex-security:*`：审查上传、媒体读取、SSRF、凭据、跨用户资源和 provider 回调。
- `jiying-project-development`：保持 JIYING 项目规则一致。

工具调用要求：

- 本地检索优先 `rg`。
- UI 可见改动必须浏览器验证。
- 安全相关改动必须跑对应 security smoke 或安全审查。
- 不把密钥、token、供应商 URL、Authorization header 写入文档、前端、日志或运行 JSON。

## 10. 实现顺序建议

推荐顺序：

1. 先补节点领域类型和后端 schema。
2. 再补 `PanoramaNode`，因为它主要是资产预览、视角 metadata 和 reference frame。
3. 再补 `Scene3DNode`，因为它需要 scene JSON、WebGL、缩略图和下游引用。
4. 再补 `VoiceNode`，接入 TTS/STT provider adapter 和音频资产。
5. 最后补 `MusicNode`，接入音乐 provider、音频 metadata 和剪辑引用。

每一步都必须单独写 `docs/plan/`，不能一次性把四类节点全部实现。

## 11. 文档级验收

本文只完成标准定义。后续实现任一节点时，验收必须至少覆盖：

- `npm run lint`
- `npm run build`
- 对应 workflow / media / security smoke。
- 浏览器验证：WebGL 非空、音频可播放、DOM 无遮挡、控制台无关键错误。
- 刷新恢复：节点参数、运行状态、资产引用和失败原因可恢复。
- 普通用户 API Key / API URL 不可见。

