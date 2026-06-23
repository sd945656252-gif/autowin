import type { CustomApiConfig } from '../../types';
import { ApiConfigEditorPanel } from './ApiConfigEditorPanel';
import { ApiConfigList } from './ApiConfigList';
import { useApiConfigWorkspace } from './useApiConfigWorkspace';

type ApiConfigWorkspaceProps = {
  apiConfigs: CustomApiConfig[];
  onSaveApiConfig?: (config: CustomApiConfig) => CustomApiConfig | null | void | Promise<CustomApiConfig | null | void>;
  onDeleteApiConfig?: (configId: string) => void | Promise<void>;
  onClose?: () => void;
  compact?: boolean;
};

export function ApiConfigWorkspace({ apiConfigs, onSaveApiConfig, onDeleteApiConfig, onClose, compact = false }: ApiConfigWorkspaceProps) {
  const {
    selectedConfigId,
    editingConfig,
    diagnosticChecking,
    diagnosticResult,
    showApiKeyInSettings,
    setShowApiKeyInSettings,
    isReorderMode,
    setIsReorderMode,
    draggedIndex,
    setDraggedIndex,
    probeStatus,
    probeError,
    recognizedModel,
    saving,
    saveError,
    isDraftConfig,
    panelTitle,
    selectConfig,
    handleProbeModelParams,
    handleTestApiSettings,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDelete,
    createDraftConfig,
    handleConfigApplied,
    handleCancel,
    handleSave,
    setEditingConfig
  } = useApiConfigWorkspace(apiConfigs, { onSaveApiConfig, onDeleteApiConfig, onClose });

  return (
    <div className={`flex min-h-0 overflow-hidden border border-white/10 bg-[#05060b] ${compact ? 'rounded-lg h-[660px]' : 'h-full'}`}>
      <ApiConfigList
        configs={apiConfigs}
        selectedConfigId={selectedConfigId}
        isReorderMode={isReorderMode}
        draggedIndex={draggedIndex}
        onToggleReorderMode={() => setIsReorderMode(!isReorderMode)}
        onSelectConfig={selectConfig}
        onCreateConfig={createDraftConfig}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={() => setDraggedIndex(null)}
      />

      <div className="flex-1 p-6 overflow-y-auto space-y-5 bg-[#07090f]">
        <ApiConfigEditorPanel
          editingConfig={editingConfig}
          panelTitle={panelTitle}
          isDraftConfig={isDraftConfig}
          showApiKeyInSettings={showApiKeyInSettings}
          diagnosticChecking={diagnosticChecking}
          diagnosticResult={diagnosticResult}
          probeStatus={probeStatus}
          probeError={probeError}
          recognizedModel={recognizedModel}
          saving={saving}
          saveError={saveError}
          onChangeConfig={setEditingConfig}
          onToggleShowApiKey={() => setShowApiKeyInSettings(!showApiKeyInSettings)}
          onProbeModelParams={handleProbeModelParams}
          onConfigApplied={handleConfigApplied}
          onTest={handleTestApiSettings}
          onDelete={handleDelete}
          onCancel={handleCancel}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
