import type { DragEvent } from 'react';
import { GripVertical, Plus } from 'lucide-react';
import type { CustomApiConfig } from '../../types';

type ApiConfigListProps = {
  configs: CustomApiConfig[];
  selectedConfigId: string | null;
  isReorderMode: boolean;
  draggedIndex: number | null;
  onToggleReorderMode: () => void;
  onSelectConfig: (config: CustomApiConfig) => void;
  onCreateConfig: () => void;
  onDragStart: (event: DragEvent, index: number) => void;
  onDragOver: (event: DragEvent, index: number) => void;
  onDrop: (event: DragEvent, index: number) => void;
  onDragEnd: () => void;
};

function configTypeClass(type: CustomApiConfig['type']) {
  if (type === 'image') return 'bg-cyan-950/50 text-cyan-400 border border-cyan-500/10';
  if (type === 'video') return 'bg-violet-950/50 text-violet-400 border border-violet-500/10';
  return 'bg-amber-950/50 text-amber-400 border border-amber-500/10';
}

function configTypeLabel(type: CustomApiConfig['type']) {
  if (type === 'image') return 'IMAGE';
  if (type === 'video') return 'VIDEO';
  return 'TEXT';
}

export function ApiConfigList({
  configs,
  selectedConfigId,
  isReorderMode,
  draggedIndex,
  onToggleReorderMode,
  onSelectConfig,
  onCreateConfig,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: ApiConfigListProps) {
  return (
    <div className="w-1/3 border-r border-[#151a2a] p-4 bg-[#05060b] flex flex-col justify-between">
      <div className="space-y-2 overflow-y-auto max-h-[55vh]">
        <div className="flex flex-col gap-1.5 mb-3 border-b border-white/5 pb-2">
          <div className="flex items-center justify-between gap-2">
            <span className="block text-[10px] text-zinc-500 font-bold tracking-widest font-mono uppercase">
              已配置模型列表 ({configs.length})
            </span>
            <button
              type="button"
              onClick={onToggleReorderMode}
              className={`text-[9px] font-mono px-2 py-0.5 rounded border transition-all cursor-pointer ${isReorderMode
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                : 'bg-[#090b10] border-white/5 text-zinc-400 hover:text-white hover:border-white/10'}`}
            >
              {isReorderMode ? '锁定顺序' : '拖拽排序'}
            </button>
          </div>
          {isReorderMode && (
            <span className="text-[8px] font-mono text-amber-400 leading-normal animate-pulse block select-none">
              按住左侧图标拖拽即可调整顺序，完成后再点一次按钮退出排序。
            </span>
          )}
        </div>

        {configs.map((config, index) => {
          const isSelected = selectedConfigId === config.id;
          const isDragged = draggedIndex === index;
          return (
            <div
              key={config.id}
              draggable={isReorderMode}
              onDragStart={(event) => onDragStart(event, index)}
              onDragOver={(event) => onDragOver(event, index)}
              onDrop={(event) => onDrop(event, index)}
              onDragEnd={onDragEnd}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onToggleReorderMode();
              }}
              onClick={() => {
                if (isReorderMode) return;
                onSelectConfig(config);
              }}
              className={`p-3 rounded-lg border transition-all flex items-center justify-between select-none ${
                isReorderMode ? 'cursor-grab active:cursor-grabbing border-amber-500/25' : 'cursor-pointer'
              } ${
                isDragged ? 'opacity-30 border-dashed border-amber-500 bg-amber-500/5' : ''
              } ${
                isSelected && !isReorderMode
                  ? 'bg-[#0f1424] border-cyan-500/60 shadow-md shadow-cyan-500/5'
                  : isReorderMode
                    ? 'bg-amber-950/5 border-amber-950/30'
                    : 'bg-[#090b10] border-white/5 hover:border-white/10 hover:bg-[#0c0f16]'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {isReorderMode && (
                  <div className="text-amber-500/50 hover:text-amber-400 cursor-grab shrink-0">
                    <GripVertical className="w-3.5 h-3.5" />
                  </div>
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-slate-100 truncate font-sans">{config.alias}</span>
                    <span className="text-[9px] text-zinc-500 truncate">{config.provider || 'Custom'}</span>
                  </div>
                  <span className="text-[8px] font-mono text-zinc-600 truncate mt-0.5 uppercase tracking-wide">
                    {config.modelName}
                  </span>
                </div>
              </div>
              <span className={`text-[8px] px-1.5 py-0.5 rounded font-bold font-mono tracking-wide shrink-0 ${configTypeClass(config.type)}`}>
                {configTypeLabel(config.type)}
              </span>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onCreateConfig}
        className="w-full py-2 bg-gradient-to-r from-cyan-950/40 to-blue-950/40 hover:from-cyan-900/60 hover:to-blue-900/60 border border-cyan-800/40 hover:border-cyan-500/80 rounded-lg text-cyan-400 hover:text-white transition-all text-xs font-mono font-bold flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
      >
        <Plus className="w-3.5 h-3.5" />
        <span>新增自定义 API 模型</span>
      </button>
    </div>
  );
}
