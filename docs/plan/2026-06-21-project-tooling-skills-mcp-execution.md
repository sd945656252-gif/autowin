# JIYING 项目工具、Skills、MCP 执行计划

## 范围

- 新增一个本机 Codex 项目级 skill：`jiying-project-development`。
- 新增项目内工具链说明文档，固定本项目推荐使用的 MCP、skills、工具调用和依赖补充边界。
- 验证 Context7 MCP 是否已经可被当前 Codex 会话发现。

## 不动项

- 不改主画布底座，继续使用自研固定顺序 DOM/SVG 画布。
- 不重新引入 React Flow、`@xyflow/react`、ELK.js、tldraw、Konva、Fabric。
- 不新增前端运行依赖、数据库依赖、队列依赖或模型供应商 SDK。
- 不修改普通用户 API Key / API URL 可见性规则。
- 不改业务代码、数据库 schema、运行入口或 worker 执行链路。

## 旧实现清理

本次没有业务旧实现清理。React Flow / ELK 清理已经在前序画布栈清理中完成，本次只补工具执行规则。

## 数据库影响

无数据库 schema、迁移或数据写入影响。

## 权限影响

无产品权限逻辑改动。文档和 skill 会继续锁定：普通用户不能看到或填写 API Key / API URL，供应商凭据只允许管理员 / 经理在模型中心维护。

## 安全风险

- 不把本机 `config.toml` 中的任何 token、provider key 或私密 URL 写入项目文档。
- Skill 只写规则和流程，不保存密钥。
- Context7 查询官方文档时不得发送密钥、凭据、个人信息或专有代码片段。

## 验收命令

- `python C:\Users\0130\.codex\skills\.system\skill-creator\scripts\quick_validate.py C:\Users\0130\.codex\skills\jiying-project-development`
- `git status --short`

## 浏览器验证方式

本次不涉及 UI 可见改动，不需要浏览器截图。后续任何 UI 可见改动仍必须使用浏览器、DOM、截图或控制台验证。

## 回滚策略

- 删除 `C:\Users\0130\.codex\skills\jiying-project-development`。
- 删除本计划和新增的项目工具链说明文档。

## 执行结果

- 已新增本机 Codex skill：`C:\Users\0130\.codex\skills\jiying-project-development`。
- 已新增项目文档：`docs/jiying-tooling-skills-mcp-stack.md`。
- 已通过 Context7 解析 Vite 官方文档库 ID `/vitejs/vite`，确认 Context7 MCP 当前可用。
- 已运行 skill 校验：`Skill is valid!`。
- 未新增项目运行依赖，未改业务代码，未改数据库 schema，未改主画布技术栈。
- 本次无 UI 可见改动，因此未做浏览器截图验证。
