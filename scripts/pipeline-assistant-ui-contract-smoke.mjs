import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function includesAll(source, values, label) {
  const missing = values.filter((value) => !source.includes(value));
  assert(missing.length === 0, `${label} missing: ${missing.join(", ")}`);
}

const chatPanel = read("apps/web/src/components/ChatPanel.tsx");
const scriptEditor = read("apps/web/src/components/ScriptEditor.tsx");
const canvas = read("apps/web/src/components/Canvas.tsx");
const videoEditor = read("apps/web/src/components/VideoEditor.tsx");
const pipelineNav = read("apps/web/src/components/PipelineNav.tsx");
const developerTabs = read("apps/web/src/components/developer/developerTabs.ts");
const promptOptimizationPanel = read("apps/web/src/components/developer/PromptOptimizationPanel.tsx");
const promptMatrix = read("apps/web/src/components/PromptMatrix.tsx");

includesAll(chatPanel, [
  "pipeline-assistant-panel",
  "pipeline-assistant-title",
  "pipeline-assistant-messages",
  "pipeline-assistant-input",
  "pipeline-assistant-send",
  "pipeline-assistant-upload",
  "pipeline-assistant-file-input",
  "pipeline-assistant-action-card",
  "pipeline-assistant-confirm-action",
  "pipeline-assistant-reject-action",
  "pipeline-assistant-revise-action",
  "pipeline-assistant-error",
  "pipeline-assistant-model-center-link"
], "ChatPanel test contract");

includesAll(chatPanel, [
  "SCRIPT_01",
  "ART_03",
  "SHOT_04",
  "EDIT_05",
  "阶段技能：",
  "专业记忆：",
  "写入前需确认",
  "创建/写入/生成",
  "文字模型：",
  "前往模型中心"
], "ChatPanel stage and model UX contract");

includesAll(pipelineNav, [
  "displayId: '01'",
  "displayId: '02'",
  "displayId: '03'",
  "displayId: '04'",
  "name: '剧本'",
  "name: '美术设计'",
  "name: '镜头设计'",
  "name: '剪辑'"
], "Pipeline 01-04 visible stage contract");

assert(!pipelineNav.includes("id: '03'"), "PipelineNav should not expose the legacy director stage as a visible node.");

includesAll(developerTabs, [
  "prompt-optimization",
  "提示词优化"
], "Developer prompt optimization tab contract");

includesAll(promptOptimizationPanel, [
  "fetchPromptOptimizationProfiles",
  "savePromptOptimizationProfile",
  "resetPromptOptimizationProfile",
  "PromptMatrix",
  "embeddedInConfig"
], "Prompt optimization panel contract");

includesAll(promptMatrix, [
  "PROMPT_OPTIMIZATION_METADATA_STAGE",
  "promptOptimizationTaskStorageKey",
  "promptOptimizationProfiles"
], "Prompt optimization matrix independence contract");

assert(!promptMatrix.includes("SlashAssetPicker"), "PromptMatrix should not call team slash assets after moving to prompt optimization.");
assert(!promptMatrix.includes("createProductionAsset"), "PromptMatrix should not save directly into the film production asset chain.");

includesAll(chatPanel, [
  "PIPELINE_ASSISTANT_TEXT_MODEL_REQUIRED",
  "PIPELINE_ASSISTANT_EDIT_PERMISSION_REQUIRED",
  "PIPELINE_ASSISTANT_ATTACHMENT_MAGIC_MISMATCH",
  "PIPELINE_ASSISTANT_ATTACHMENT_UNSUPPORTED",
  "PIPELINE_ASSISTANT_ACTION_EXPIRED",
  "PIPELINE_ASSISTANT_WORKSPACE_CONFLICT",
  "PIPELINE_ASSISTANT_STAGE_MISMATCH"
], "ChatPanel error guidance contract");

const listenerChecks = [
  ["ScriptEditor", scriptEditor, "SCRIPT_01"],
  ["Canvas ART", canvas, "ART_03"],
  ["Canvas SHOT", canvas, "SHOT_04"],
  ["VideoEditor", videoEditor, "EDIT_05"]
];

for (const [label, source, stage] of listenerChecks) {
  includesAll(source, [
    "jiying:pipeline-assistant-action-confirmed",
    stage,
    "executionResult"
  ], `${label} assistant listener contract`);
}

includesAll(canvas, [
  "pipeline-canvas-node",
  "pipeline-canvas-node-prompt"
], "Canvas browser verification contract");

console.log(JSON.stringify({
  success: true,
  checked: {
    chatPanelSelectors: 13,
    stageHints: 4,
    errorHints: 7,
    workspaceListeners: listenerChecks.length,
    canvasSelectors: 2
  }
}, null, 2));
