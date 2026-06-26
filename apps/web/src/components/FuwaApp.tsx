import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Header from './Header';
import PipelineNav from './PipelineNav';
import Sidebar from './Sidebar';
import Canvas from './Canvas';
import ChatPanel from './ChatPanel';
import ScriptEditor from './ScriptEditor';
import VideoEditor from './VideoEditor';
import { fetchTeamProjects } from '../lib/db';
import { PageNotice } from './ui/State';

import { useAuth } from './AuthContext';
import { useGlobalApiConfigManager } from '../hooks/useGlobalApiConfigManager';
import { useWorkflowCanvasSync } from '../hooks/useWorkflowCanvasSync';

interface FuwaAppProps {
  currentProjectId?: string | null;
  onBack?: () => void;
  onNavigateHome?: () => void;
  onNavigateNews?: () => void;
  onNavigateDeveloper?: () => void;
  onNavigateTeam?: () => void;
  onNavigateHistory?: () => void;
  onNavigateAdmin?: () => void;
}

export default function FuwaApp({ currentProjectId, onBack, onNavigateHome, onNavigateNews, onNavigateDeveloper, onNavigateTeam, onNavigateHistory, onNavigateAdmin }: FuwaAppProps) {
  const { user, role: currentUserRole, saveCanvas, loadCanvasForProject, canvasState, globalApiConfigs, saveGlobalApiConfigs, loading: isAuthLoading } = useAuth();
  const [leftCollapsed, setLeftCollapsed] = useState(true);
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const {
    activeNode,
    setActiveNode,
    nodes,
    shotNodes,
    presenceUsers,
    syncStatus,
    updateNodesState,
    updateShotNodesState
  } = useWorkflowCanvasSync({
    currentProjectId,
    user,
    isAuthLoading,
    canvasState,
    loadCanvasForProject,
    saveCanvas
  });
  const { handleSaveApiConfig, handleDeleteApiConfig } = useGlobalApiConfigManager({
    currentUserRole,
    globalApiConfigs,
    saveGlobalApiConfigs
  });

  useEffect(() => {
    setLeftCollapsed(true);
    setRightCollapsed(true);
  }, [currentProjectId]);

  const personalProjectsQuery = useQuery({
    queryKey: ['team-projects', user?.uid || 'guest', 'PERSONAL'],
    queryFn: () => fetchTeamProjects({ projectKind: 'PERSONAL' }),
    enabled: Boolean(user && currentProjectId),
    staleTime: 30_000
  });

  const teamProjectsQuery = useQuery({
    queryKey: ['team-projects', user?.uid || 'guest', 'TEAM'],
    queryFn: () => fetchTeamProjects({ projectKind: 'TEAM' }),
    enabled: Boolean(user && currentProjectId),
    staleTime: 30_000
  });

  const currentProject = [
    ...(personalProjectsQuery.data || []),
    ...(teamProjectsQuery.data || [])
  ].find((project) => project.id === currentProjectId);
  const isProjectLookupLoading = Boolean(currentProjectId) && (personalProjectsQuery.isLoading || teamProjectsQuery.isLoading);
  const projectKindLabel = currentProject?.projectKind === 'PERSONAL' ? '个人项目' : currentProject?.projectKind === 'TEAM' ? '团队项目' : '项目';

  // 2. Lock screen (visitor / unlogged-in gatekeeper)
  if (!user) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#030303] text-[#ececec] font-sans">
        <div className="text-center p-6 bg-[#070707] border border-cyan-950/40 rounded-xl max-w-sm">
          <div className="w-10 h-10 rounded bg-cyan-950/40 border border-cyan-800/50 flex items-center justify-center text-cyan-400 font-black text-xl mb-3 mx-auto shadow-[0_0_20px_rgba(6,182,212,0.2)]">✦</div>
          <h2 className="text-sm font-bold text-white uppercase tracking-widest font-mono mb-1">未检测到有效认证</h2>
          <p className="text-xs text-gray-400 mb-4 font-mono">请先在工作台连接主控安全席位。</p>
          {onBack && (
            <button onClick={onBack} className="text-xs text-cyan-400 hover:text-cyan-300 underline font-mono cursor-pointer">← 返回工作台</button>
          )}
        </div>
      </div>
    );
  }

  if (!currentProjectId) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-[#030303] text-[#ececec] font-sans">
        <Header
          onNavigateHome={onNavigateHome}
          onNavigateNews={onNavigateNews}
          onNavigateDashboard={onBack}
          onNavigateDeveloper={onNavigateDeveloper}
          onNavigateTeam={onNavigateTeam}
          onNavigateHistory={onNavigateHistory}
          onNavigateAdmin={onNavigateAdmin}
          currentView="pipeline"
          activeNode={activeNode}
        />
        <div className="mt-16 flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-xl">
            <PageNotice
              tone="info"
              title="请选择一个影视项目后进入工作流"
              action={onBack && (
                <button onClick={onBack} className="rounded border border-cyan-400/30 bg-cyan-500/15 px-4 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-500/25">
                  返回工作台
                </button>
              )}
            >
              主工作流需要绑定个人项目或团队项目，才能保存画布、资产、审核状态和剪辑时间线。请从工作台创建或打开一个影视项目。
            </PageNotice>
          </div>
        </div>
      </div>
    );
  }

  // 4. Authenticated system layout
  return (
    <div className="h-screen flex flex-col overflow-hidden text-sm bg-[#030303] text-[#ececec] font-sans antialiased text-justify">
      
      {/* Brand Header */}
      <Header 
        onNavigateHome={onNavigateHome}
        onNavigateNews={onNavigateNews}
        onNavigateDashboard={onBack}
        onNavigateDeveloper={onNavigateDeveloper}
        onNavigateTeam={onNavigateTeam}
        onNavigateHistory={onNavigateHistory}
        onNavigateAdmin={onNavigateAdmin}
        currentView="pipeline"
        activeNode={activeNode}
      />

      {/* Industrial Progress Flow Bar */}
      <div className="flex bg-[#0a0a0a] mt-16 items-center border-b border-[rgba(255,255,255,0.08)] px-4 shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1 text-xs text-gray-400 hover:text-white border border-white/10 rounded bg-white/5 hover:bg-white/10 cursor-pointer transition-all mr-2 shrink-0 font-mono"
          >
            ← 返回工作台
          </button>
        )}
        <div className="flex-1 overflow-x-auto">
          <PipelineNav activeNode={activeNode} setActiveNode={setActiveNode} />
        </div>
        <div className="hidden lg:flex items-center gap-2 pl-3 text-[10px] font-mono text-gray-500 shrink-0">
          <span className="max-w-[220px] truncate rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-zinc-300" title={currentProject?.name || currentProjectId}>
            {isProjectLookupLoading ? '项目读取中' : currentProject ? `${projectKindLabel} · ${currentProject.name}` : '项目未找到'}
          </span>
          <span className={`w-2 h-2 rounded-full ${syncStatus === 'online' ? 'bg-emerald-400' : syncStatus === 'conflict' ? 'bg-amber-400' : 'bg-gray-600'}`} />
          <span>{syncStatus === 'online' ? '实时同步' : syncStatus === 'conflict' ? '版本冲突' : '同步离线'}</span>
          {presenceUsers.length > 0 && <span>在线 {presenceUsers.length}</span>}
        </div>
      </div>
      
      {/* Primary Panels Layout */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Left hierarchy explorer */}
        <Sidebar
          activeNode={activeNode}
          currentProjectId={currentProjectId}
          collapsed={leftCollapsed}
          setCollapsed={setLeftCollapsed}
        />

        {/* Floating expand dot for left drawer explorer */}
        {leftCollapsed && (
          <button
            onClick={() => setLeftCollapsed(false)}
            className="absolute top-6 left-6 z-30 bg-black/60 backdrop-blur-md p-2 rounded-lg text-white/50 hover:text-white transition-all duration-200 border border-white/10 shadow-xl cursor-pointer"
            title="查看项目资产库"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* Middle Interactive Canvas workspace / Editor suite */}
        <main id="main-wrapper" className="flex-1 flex flex-col relative bg-[#030303] overflow-hidden h-full">
          {activeNode === '02' && <ScriptEditor currentProjectId={currentProjectId} />}
          {activeNode === '04' && (
            <Canvas
              activeNode="04"
              nodes={nodes}
              onUpdateNodes={updateNodesState}
              currentUserRole={currentUserRole as any}
              currentProjectId={currentProjectId}
              apiConfigs={globalApiConfigs || []}
            />
          )}
          {activeNode === '05' && (
            <Canvas
              activeNode="05"
              nodes={shotNodes}
              onUpdateNodes={updateShotNodesState}
              currentUserRole={currentUserRole as any}
              currentProjectId={currentProjectId}
              apiConfigs={globalApiConfigs || []}
            />
          )}
          {activeNode === '06' && <VideoEditor currentProjectId={currentProjectId} />}
        </main>

        {/* Floating expand dot for right Assistant Chat Panel */}
        {rightCollapsed && (
          <button
            onClick={() => setRightCollapsed(false)}
            className="absolute top-6 right-6 z-30 bg-black/60 backdrop-blur-md p-2 rounded-lg text-white/50 hover:text-white transition-all duration-200 border border-white/10 shadow-xl cursor-pointer"
            title="开闭创意 AI"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Right contextual AI dialog companion */}
        <ChatPanel
          activeNode={activeNode}
          collapsed={rightCollapsed}
          setCollapsed={setRightCollapsed}
          userId={user?.uid}
          currentProjectId={currentProjectId}
        />
        
      </div>
    </div>
  );
}
