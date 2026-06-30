import { useMemo, useState, type MouseEvent } from 'react';
import Scene3DNode, { createScene3DPreviewNode } from './flow/Scene3DNode';
import type { CanvasNode } from '../types';

type Scene3DPreviewOutput = {
  id: string;
  kind: 'image' | 'canvas' | 'video' | 'action-video';
  createdAt: string;
  mediaUrl?: string;
  mediaAssetId?: string;
};

function createPreviewNode(): CanvasNode {
  return createScene3DPreviewNode();
}

function readPreviewProjectId() {
  const value = new URLSearchParams(window.location.search).get('projectId')?.trim();
  return value || 'scene3d-preview';
}

function summarizeOutput(kind: Scene3DPreviewOutput['kind'], result: any): Scene3DPreviewOutput {
  const capture = result?.capture || {};
  return {
    id: `${kind}-${Date.now()}`,
    kind,
    createdAt: new Date().toLocaleTimeString(),
    mediaUrl: capture.mediaUrl || result?.mediaUrl,
    mediaAssetId: capture.mediaAssetId || result?.mediaAssetId
  };
}

export default function Scene3DNodePreviewPage() {
  const [node, setNode] = useState<CanvasNode>(() => createPreviewNode());
  const [isSelected, setIsSelected] = useState(true);
  const [outputs, setOutputs] = useState<Scene3DPreviewOutput[]>([]);
  const projectId = useMemo(readPreviewProjectId, []);

  const updateNode = (updatedFields: Partial<CanvasNode> | ((node: CanvasNode) => Partial<CanvasNode>)) => {
    setNode((current) => {
      const patch = typeof updatedFields === 'function' ? updatedFields(current) : updatedFields;
      return { ...current, ...patch };
    });
  };

  const recordOutput = (kind: Scene3DPreviewOutput['kind']) => (result: any) => {
    setOutputs((current) => [summarizeOutput(kind, result), ...current].slice(0, 6));
  };

  const resetPreview = () => {
    setNode(createPreviewNode());
    setOutputs([]);
    setIsSelected(true);
  };

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-[#030303] text-zinc-100">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 bg-black/60 px-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-300">Scene3D Node Preview</div>
            <div className="mt-0.5 truncate text-[10px] font-mono text-zinc-500">projectId={projectId}</div>
          </div>
          <button
            type="button"
            onClick={resetPreview}
            className="h-8 rounded-md border border-white/10 bg-white/[0.04] px-3 text-[11px] font-semibold text-zinc-200 hover:bg-white/[0.08]"
          >
            Reset
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(520px,1fr)_280px] bg-zinc-950">
          <div className="flex min-h-0 items-center justify-center overflow-auto p-8">
            <div className="shrink-0">
              <Scene3DNode
                node={node}
                isSelected={isSelected}
                onUpdate={updateNode}
                onSelect={(event: MouseEvent) => {
                  event.stopPropagation();
                  setIsSelected(true);
                }}
                onDelete={(event: MouseEvent) => {
                  event.stopPropagation();
                  resetPreview();
                }}
                onCreateImageNode={recordOutput('image')}
                onSendCaptureToCanvas={recordOutput('canvas')}
                onCreateVideoNode={recordOutput('video')}
                onCreateActionVideoNode={recordOutput('action-video')}
                currentProjectId={projectId}
              />
            </div>
          </div>

          <aside className="flex min-h-0 flex-col border-l border-white/10 bg-black/45">
            <div className="border-b border-white/10 px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-300">Host Adapter</div>
              <div className="mt-1 text-[10px] leading-4 text-zinc-500">Same node component, minimal CanvasNode state.</div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="space-y-3">
                <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Node</div>
                  <div className="mt-2 space-y-1 font-mono text-[11px] text-zinc-300">
                    <div>id: {node.id}</div>
                    <div>type: {node.type}</div>
                    <div>captures: {node.scene3dCaptures?.length || 0}</div>
                  </div>
                </div>

                <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Recent Outputs</div>
                  {outputs.length === 0 ? (
                    <div className="mt-2 text-[11px] text-zinc-500">No output yet.</div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {outputs.map((output) => (
                        <div key={output.id} className="rounded border border-white/10 bg-black/25 p-2 font-mono text-[10px] text-zinc-400">
                          <div className="flex items-center justify-between gap-2 text-zinc-300">
                            <span>{output.kind}</span>
                            <span>{output.createdAt}</span>
                          </div>
                          <div className="mt-1 truncate">asset: {output.mediaAssetId || '-'}</div>
                          <div className="truncate">url: {output.mediaUrl || '-'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
