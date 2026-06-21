# 四类未来节点标准设计文档计划

## 范围

- 新增 `docs/jiying-node-standard-design.md`。
- 定义未来四类节点标准：
  - 3D 全景图节点 `PanoramaNode`。
  - 3D 导演台节点 `Scene3DNode`。
  - 语音节点 `VoiceNode`。
  - 音乐节点 `MusicNode`。
- 明确这些节点的通用契约、输入、参数、输出、验收、MCP / skills / 工具调用和技术栈边界。

## 不动项

- 不修改业务代码。
- 不修改 `CanvasNode`、Prisma schema、API routes、worker 或前端组件。
- 不新增依赖。
- 不安装 `three`、`@react-three/fiber`、`@react-three/drei`。
- 不引入 React Flow、`@xyflow/react`、ELK.js、tldraw、Konva、Fabric、WebAV、Pixi 或完整 DAW 库。
- 不改变普通用户 API Key / API URL 不可见规则。
- 不修改当前自研固定顺序 DOM/SVG 主画布技术栈。

## 旧实现清理计划

本次是文档补充，没有旧实现清理。

后续真正实现节点时必须避免：

- 保留平行节点系统。
- 保留无意义 fallback。
- 让前端临时状态替代后端运行状态。
- 让节点直接调用第三方供应商 API。

## 数据库影响

本次无数据库影响。

文档只记录未来方向，不创建或修改：

- Prisma model。
- enum。
- migration。
- seed。
- 运行数据。

## 权限影响

本次无运行时权限影响。

文档继续锁定以下规则：

- 普通用户不能填写或看到 API Key / API URL。
- 供应商、密钥、连接测试和参数同步只允许管理员 / 经理在模型中心维护。
- 所有媒体读取、参考资产、3D 场景、音频素材和导出产物都必须走后端权限校验。
- 未来节点产物必须写入 `MediaAsset` / `NodeArtifact` 或对应运行记录，不能只存在前端。

## 安全风险

本次只写文档，没有直接运行时风险。

未来实现四类节点时的安全重点：

- 上传文件 MIME、magic number、大小和配额校验。
- 媒体流读取权限。
- GLB / glTF / 全景图 / 音频素材跨用户访问控制。
- Provider URL SSRF 防护。
- API Key、Authorization header、供应商原始响应脱敏。
- 运行 `inputJson` / `outputJson` 不写入密钥。
- 失败原因可理解，但不能泄露内部路径或供应商完整响应。

## 验收命令

本次文档补充只做文档级验证：

```txt
git status --short
```

不运行以下命令：

- `npm run lint`
- `npm run build`
- `npm run workflow:smoke:production-assets`
- 浏览器截图验证

原因：本次不改 TypeScript、React、依赖、schema、运行入口或 UI 可见内容。

## 浏览器验证方式

本次没有 UI 可见改动，不做浏览器验证。

后续实现节点时必须补浏览器验证：

- 3D 全景图：素材可加载、视角可交互、热点可恢复、reference frame 可生成。
- 3D 导演台：WebGL 非空、场景可保存、缩略图写入资产、控制台无关键错误。
- 语音节点：音频可播放、字幕/时间轴可显示、失败态可见。
- 音乐节点：音频可播放、BPM/loop metadata 可显示、剪辑节点可引用。

## 回滚策略

删除以下文件即可回滚本次文档补充：

```txt
docs/jiying-node-standard-design.md
docs/plan/2026-06-21-future-media-node-standard-design.md
```

## 执行结果

- 已新增 `docs/jiying-node-standard-design.md`。
- 未修改业务代码。
- 未修改依赖。
- 未修改数据库 schema。
- 未修改 UI。
- 未改变普通用户 API Key / API URL 可见性。

