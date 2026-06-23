import type { CustomApiConfig } from '../../types';
import { ApiConfigCapabilityToolbar } from './ApiConfigCapabilityToolbar';
import { ApiConfigCapabilityOverview } from './ApiConfigCapabilityOverview';
import { ApiConfigRegistryEditorModal } from './ApiConfigRegistryEditorModal';
import { ApiConfigRuntimeAdapter } from './ApiConfigRuntimeAdapter';
import type { ProbeStatus } from './apiConfigParameterUtils';
import { useApiConfigParameterPanel } from './useApiConfigParameterPanel';

interface ApiConfigParameterPanelProps {
  config: CustomApiConfig;
  probeStatus: ProbeStatus;
  probeError: string | null;
  recognizedModel: string | null;
  onConfigApplied?: (config: CustomApiConfig, options?: { persist?: boolean }) => void;
}

export function ApiConfigParameterPanel({
  config,
  probeStatus,
  probeError,
  recognizedModel,
  onConfigApplied
}: ApiConfigParameterPanelProps) {
  const {
    isTextConfig,
    capabilityProfile,
    registryData,
    filteredRegistryData,
    officialUrl,
    setOfficialUrl,
    officialProbe,
    officialProbeError,
    showRegistryModal,
    setShowRegistryModal,
    showApplyMenu,
    setShowApplyMenu,
    applyStatus,
    applyError,
    editingRegistryJson,
    setEditingRegistryJson,
    registryEditError,
    registrySaveStatus,
    runtimeEditor,
    setRuntimeEditor,
    runtimeSaveStatus,
    runtimeSaveError,
    metadata,
    executable,
    statusText,
    hasTrustedTemplate,
    maxImages,
    effectiveProbeStatus,
    urlProbeMutation,
    handleOpenRegistry,
    handleSaveRegistryJson,
    handleApplyRegistry,
    handleSaveRuntime,
    handleValidateRegistryJson
  } = useApiConfigParameterPanel({
    config,
    probeStatus,
    onConfigApplied
  });

  return (
    <div className="border-t border-white/5 pt-4">
      {isTextConfig ? (
        <div className="rounded-lg border border-white/10 bg-black/20 p-4 font-mono text-[10px] text-zinc-400">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold uppercase text-zinc-300">文字生成 Direct Config</span>
            <span className="text-emerald-300">API Key / Base URL / Model ID</span>
          </div>
          <div className="mt-2 leading-relaxed text-zinc-500">
            文字生成不再绑定能力清单。保存后仅保留直连调用所需配置，不显示官方模板和运行时编辑区。
          </div>
        </div>
      ) : (
        <>
          <ApiConfigCapabilityToolbar
            canonicalModelId={config.canonicalModelId}
            recognizedModel={recognizedModel}
            executable={executable}
            effectiveProbeStatus={effectiveProbeStatus}
            showApplyMenu={showApplyMenu}
            filteredRegistryData={filteredRegistryData}
            applyStatus={applyStatus}
            applyError={applyError}
            onOpenRegistry={() => config.canonicalModelId ? handleOpenRegistry(config.canonicalModelId) : setShowRegistryModal(true)}
            onToggleApplyMenu={() => setShowApplyMenu((value) => !value)}
            onApplyRegistry={(canonicalModelId) => void handleApplyRegistry(canonicalModelId)}
          />

          <ApiConfigCapabilityOverview
            config={config}
            probeStatus={probeStatus}
            probeError={probeError}
            recognizedModel={recognizedModel}
            officialUrl={officialUrl}
            onOfficialUrlChange={setOfficialUrl}
            onRunOfficialProbe={() => urlProbeMutation.mutate()}
            officialProbePending={urlProbeMutation.isPending}
            officialProbeError={officialProbeError}
            officialProbe={officialProbe}
            metadata={metadata}
            executable={executable}
            statusText={statusText}
            hasTrustedTemplate={hasTrustedTemplate}
            maxImages={maxImages}
          />

          {capabilityProfile && (
            <ApiConfigRuntimeAdapter
              configType={config.type}
              runtimeEditor={runtimeEditor}
              runtimeSaveStatus={runtimeSaveStatus}
              runtimeSaveError={runtimeSaveError}
              onRuntimeEditorChange={(field, value) => setRuntimeEditor((prev) => ({ ...prev, [field]: value }))}
              onSave={() => void handleSaveRuntime()}
            />
          )}

          <ApiConfigRegistryEditorModal
            open={showRegistryModal}
            canonicalModelId={config.canonicalModelId}
            editingRegistryJson={editingRegistryJson}
            registryData={registryData}
            registryEditError={registryEditError}
            registrySaveStatus={registrySaveStatus}
            onChange={setEditingRegistryJson}
            onClose={() => setShowRegistryModal(false)}
            onSave={() => void handleSaveRegistryJson()}
            onValidate={handleValidateRegistryJson}
          />
        </>
      )}
    </div>
  );
}
