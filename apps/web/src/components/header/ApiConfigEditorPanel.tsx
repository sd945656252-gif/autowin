import { Database } from 'lucide-react';
import type { CustomApiConfig } from '../../types';
import { ApiConfigActions } from './ApiConfigActions';
import { ApiConfigBasicFields } from './ApiConfigBasicFields';
import { ApiConfigParameterPanel } from './ApiConfigParameterPanel';
import type { ProbeStatus } from './apiConfigParameterUtils';

type DiagnosticResult = {
  success: boolean;
  message: string;
};

type ApiConfigEditorPanelProps = {
  editingConfig: CustomApiConfig | null;
  panelTitle: string;
  isDraftConfig: boolean;
  showApiKeyInSettings: boolean;
  diagnosticChecking: boolean;
  diagnosticResult: DiagnosticResult | null;
  probeStatus: ProbeStatus;
  probeError: string | null;
  recognizedModel: string | null;
  saving: boolean;
  saveError: string | null;
  onChangeConfig: (config: CustomApiConfig | null) => void;
  onToggleShowApiKey: () => void;
  onProbeModelParams: (modelName: string, config: CustomApiConfig) => void;
  onConfigApplied: (config: CustomApiConfig) => void;
  onTest: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
};

export function ApiConfigEditorPanel({
  editingConfig,
  panelTitle,
  isDraftConfig,
  showApiKeyInSettings,
  diagnosticChecking,
  diagnosticResult,
  probeStatus,
  probeError,
  recognizedModel,
  saving,
  saveError,
  onChangeConfig,
  onToggleShowApiKey,
  onProbeModelParams,
  onConfigApplied,
  onTest,
  onDelete,
  onCancel,
  onSave
}: ApiConfigEditorPanelProps) {
  if (!editingConfig) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <Database className="w-12 h-12 text-zinc-700 mb-2.5" />
        <span className="text-zinc-500 text-xs font-mono">选择或创建一个模型配置。</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-4 py-3">
        <div>
          <div className="text-sm font-bold text-white">{panelTitle}</div>
          <div className="mt-0.5 text-[11px] text-zinc-500">
            {isDraftConfig ? '保存后会创建一条新的模型配置记录。' : '保存后只更新当前选中的模型配置。'}
          </div>
        </div>
        <span className="rounded border border-cyan-500/20 px-2 py-1 font-mono text-[10px] text-cyan-300">
          {isDraftConfig ? 'CREATE' : 'EDIT'}
        </span>
      </div>

      <ApiConfigBasicFields
        config={editingConfig}
        showApiKey={showApiKeyInSettings}
        onChange={(config) => onChangeConfig(config)}
        onToggleShowApiKey={onToggleShowApiKey}
        onProbeModelParams={onProbeModelParams}
      />

      <ApiConfigParameterPanel
        config={editingConfig}
        probeStatus={probeStatus}
        probeError={probeError}
        recognizedModel={recognizedModel}
        onConfigApplied={onConfigApplied}
      />

      {saveError && <div className="rounded border border-red-500/30 bg-red-950/20 px-3 py-2 text-xs text-red-200">{saveError}</div>}

      <ApiConfigActions
        canTest={!!editingConfig.baseUrl}
        diagnosticChecking={diagnosticChecking}
        diagnosticResult={diagnosticResult}
        onTest={onTest}
        onDelete={onDelete}
        canDelete={!isDraftConfig}
        saving={saving}
        mode={isDraftConfig ? 'create' : 'edit'}
        onCancel={onCancel}
        onSave={onSave}
      />
    </div>
  );
}
