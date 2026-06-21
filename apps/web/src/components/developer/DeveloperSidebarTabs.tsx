import type { DeveloperTabId } from './developerTabs';

type Props = {
  activeTab: DeveloperTabId;
  onSelectTab: (tabId: DeveloperTabId) => void;
  tabs: Array<{ id: DeveloperTabId; label: string; description: string }>;
};

export function DeveloperSidebarTabs({ activeTab, onSelectTab, tabs }: Props) {
  return (
    <aside className="h-fit rounded-lg border border-white/10 bg-white/[0.03] p-3">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelectTab(tab.id)}
          className={`w-full rounded-md border p-3 text-left transition-all ${
            activeTab === tab.id
              ? 'border-cyan-400/30 bg-cyan-500/15 text-cyan-100'
              : 'border-transparent text-zinc-400 hover:bg-white/5 hover:text-white'
          }`}
        >
          <span className="block text-sm font-bold">{tab.label}</span>
          <span className="mt-1 block text-[11px] leading-relaxed opacity-70">{tab.description}</span>
        </button>
      ))}
    </aside>
  );
}
