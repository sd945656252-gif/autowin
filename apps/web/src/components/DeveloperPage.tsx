import { useState } from 'react';
import { useAuth } from './AuthContext';
import { DeveloperAccessGate } from './developer/DeveloperAccessGate';
import { DeveloperSidebarTabs } from './developer/DeveloperSidebarTabs';
import { DeveloperTabContent } from './developer/DeveloperTabContent';
import { developerTabs, type DeveloperTabId } from './developer/developerTabs';

export default function DeveloperPage() {
  const { user, role } = useAuth();
  const isGlobalDeveloper = role === 'ADMIN' || role === 'DEVELOPER';
  const [activeTab, setActiveTab] = useState<DeveloperTabId>('models');

  if (!user || !isGlobalDeveloper) {
    return <DeveloperAccessGate />;
  }

  return (
    <main className="flex-grow pt-24 pb-12 px-6 max-w-7xl mx-auto w-full">
      <div className="flex items-end justify-between gap-6 mb-8">
        <div>
          <p className="text-xs font-mono text-cyan-400 uppercase">Manager Console V1</p>
          <h1 className="text-3xl font-bold text-white mt-2">配置与监控</h1>
          <p className="text-sm text-zinc-400 mt-2">集中管理模型配置、团队素材库、系统健康、队列、工作流与审计日志。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <DeveloperSidebarTabs activeTab={activeTab} onSelectTab={setActiveTab} tabs={developerTabs} />

        <section className="min-w-0">
          <DeveloperTabContent activeTab={activeTab} />
        </section>
      </div>
    </main>
  );
}
