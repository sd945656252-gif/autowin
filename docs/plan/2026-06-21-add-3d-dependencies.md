# 3D 节点依赖补充计划

## 范围

本次只补充未来 `PanoramaNode` 和 `Scene3DNode` 所需的 3D 前端依赖：

- `three`
- `@react-three/fiber`
- `@react-three/drei`

本次会更新：

- `package.json`
- `package-lock.json`

## 不动项

- 不实现 `PanoramaNode`。
- 不实现 `Scene3DNode`。
- 不修改主画布代码。
- 不迁移 React Flow / `@xyflow/react` / ELK.js。
- 不修改 Prisma schema。
- 不修改后端 API、worker、队列或权限逻辑。
- 不改变普通用户 API Key / API URL 不可见规则。

## 版本和兼容性

通过 npm registry 查询到当前版本：

- `three`: `0.184.0`
- `@react-three/fiber`: `9.6.1`
- `@react-three/drei`: `10.7.7`

兼容性结论：

- 当前项目使用 React `19.0.1` / React DOM `19.0.1`。
- `@react-three/fiber@9.6.1` peer dependency 支持 React `>=19 <19.3`。
- `@react-three/drei@10.7.7` peer dependency 要求 React `^19`、React DOM `^19`、R3F `^9.0.0`、Three `>=0.159`。
- 因此上述版本与当前 React 19 项目兼容。

## 旧实现清理

本次没有旧实现清理。

后续实现 3D 节点时必须继续遵守：

- 不创建第二套主画布。
- 不恢复 React Flow / ELK。
- 3D 依赖只服务节点内部预览、全景查看、导演台编辑器和渲染，不作为主画布底座。

## 数据库影响

无数据库影响。

## 权限影响

无权限逻辑影响。

未来 3D 节点实现时，所有 GLB / glTF / 全景图 / reference frame 资产读取仍必须走后端权限校验。

## 安全风险

本次只是新增前端依赖，没有直接运行时安全逻辑变更。

未来实现 3D 节点时需要重点关注：

- GLB / glTF / 全景图上传 MIME 和 magic number 校验。
- 媒体流读取权限。
- WebGL 资源加载失败和跨用户资产泄露。
- 3D 场景 JSON 不写入密钥、内部路径或未授权 asset URL。

## 验收命令

依赖安装后运行：

```txt
npm run build
```

如构建失败，必须先修复依赖或版本兼容问题，不继续节点开发。

## 浏览器验证方式

本次没有 UI 可见改动，不做浏览器截图验证。

后续 `PanoramaNode` / `Scene3DNode` UI 实现时必须验证：

- `/pipeline` 页面可打开。
- WebGL canvas 非空。
- 控制台无关键错误。
- 资产加载失败有可理解错误。

## 回滚策略

如果依赖安装导致构建失败且无法修复：

- 从 `package.json` 移除 `three`、`@react-three/fiber`、`@react-three/drei`。
- 重新生成 `package-lock.json`。
- 确认 `npm run build` 恢复通过。

## 执行结果

- 已安装 `three@0.184.0`。
- 已安装 `@react-three/fiber@9.6.1`。
- 已安装 `@react-three/drei@10.7.7`。
- 已更新 `package.json` 和 `package-lock.json`。
- 已确认依赖树中 R3F / Drei / Three 版本可解析。
- 已运行 `npm run lint`，通过。
- 已运行 `npm run build`，通过。
- `npm install` 报告 3 个 npm audit 漏洞提示（2 moderate，1 high），本次未执行 `npm audit fix`，因为这可能带来额外依赖升级或破坏性变更。
- 本次未实现任何 3D 节点 UI，未做浏览器验证。
