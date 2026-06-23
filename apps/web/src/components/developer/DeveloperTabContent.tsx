import { AnnouncementComposer } from './AnnouncementComposer';
import { DeveloperAssetLibraryPanel } from './DeveloperAssetLibraryPanel';
import { DeveloperModelsPanel } from './DeveloperModelsPanel';
import { DeveloperSystemPanel } from './DeveloperSystemPanel';
import { PromptOptimizationPanel } from './PromptOptimizationPanel';
import type { DeveloperTabId } from './developerTabs';

type Props = {
  activeTab: DeveloperTabId;
};

export function DeveloperTabContent({ activeTab }: Props) {
  if (activeTab === 'models') return <DeveloperModelsPanel />;
  if (activeTab === 'prompt-optimization') return <PromptOptimizationPanel />;
  if (activeTab === 'library') return <DeveloperAssetLibraryPanel />;
  if (activeTab === 'announcements') return <AnnouncementComposer />;
  return <DeveloperSystemPanel />;
}
