import React from 'react';

const stages = [
  { id: '02', displayId: '01', name: '剧本', stage: '定调' },
  { id: '04', displayId: '02', name: '美术设计', stage: '立规矩' },
  { id: '05', displayId: '03', name: '镜头设计', stage: '量产' },
  { id: '06', displayId: '04', name: '剪辑', stage: '枢纽' }
];

interface PipelineNavProps {
  activeNode: string;
  setActiveNode: (id: string) => void;
}

export default function PipelineNav({ activeNode, setActiveNode }: PipelineNavProps) {
  return (
    <nav className="bg-[#0a0a0a] border-b border-[rgba(255,255,255,0.08)] py-4 px-8 z-10 overflow-x-auto select-none">
      <div className="flex items-center min-w-max">
        {stages.map((stage, index) => {
          const isActive = stage.id === activeNode;
          return (
            <React.Fragment key={stage.id}>
              <div
                className={`flex items-center space-x-2 cursor-pointer transition-all duration-200 group ${
                  isActive ? 'text-white font-bold' : 'text-[#666] hover:text-white'
                }`}
                onClick={() => setActiveNode(stage.id)}
                id={`stage-item-${stage.id}`}
              >
                <div
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    isActive
                      ? 'bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]'
                      : 'bg-white/20 group-hover:bg-white/55'
                  }`}
                />
                <span className="text-xs tracking-wider whitespace-nowrap">
                  {stage.displayId} {stage.name}
                </span>
              </div>

              {index < stages.length - 1 && (
                <div className="h-px bg-white/10 flex-grow w-4 mx-3 my-auto shrink-0" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </nav>
  );
}
