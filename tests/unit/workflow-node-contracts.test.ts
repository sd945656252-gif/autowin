import test from "node:test";
import assert from "node:assert/strict";
import {
  getWorkflowNodeDefinition,
  getWorkflowNodeRequiredCapability,
  isExecutableWorkflowNodeType,
  listExecutableWorkflowNodeTypes,
  listWorkflowNodeDefinitions
} from "../../apps/shared/src/workflow/node-contracts";

test("workflow node contract registry has unique node types", () => {
  const definitions = listWorkflowNodeDefinitions();
  const uniqueTypes = new Set(definitions.map((definition) => definition.type));

  assert.equal(uniqueTypes.size, definitions.length);
  assert.ok(definitions.length >= 8);
});

test("only current image and video nodes are executable", () => {
  assert.deepEqual(listExecutableWorkflowNodeTypes().sort(), ["image_generator", "video_generator"]);
  assert.equal(isExecutableWorkflowNodeType("image_generator"), true);
  assert.equal(isExecutableWorkflowNodeType("video_generator"), true);
  assert.equal(isExecutableWorkflowNodeType("panorama"), false);
  assert.equal(isExecutableWorkflowNodeType("scene3d"), false);
  assert.equal(isExecutableWorkflowNodeType("voice"), false);
  assert.equal(isExecutableWorkflowNodeType("music"), false);
});

test("executable nodes declare model center capabilities and backend execution guarantees", () => {
  assert.equal(getWorkflowNodeRequiredCapability("image_generator"), "IMAGE_GENERATOR");
  assert.equal(getWorkflowNodeRequiredCapability("video_generator"), "VIDEO_GENERATOR");
  assert.equal(getWorkflowNodeRequiredCapability("panorama"), null);

  for (const type of listExecutableWorkflowNodeTypes()) {
    const definition = getWorkflowNodeDefinition(type);
    assert.ok(definition);
    assert.equal(definition.execution.endpoint, "/api/workflow/execute");
    assert.equal(definition.execution.requiresBackend, true);
    assert.equal(definition.execution.createsWorkflowRun, true);
    assert.equal(definition.execution.queueRequired, true);
    assert.equal(definition.execution.forbidsInlineSecrets, true);
    assert.ok(definition.requiredModelCapability);
  }
});

