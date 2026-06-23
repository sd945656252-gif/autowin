import { useEffect, useMemo, useState, type DragEvent } from 'react';
import type { CustomApiConfig } from '../../types';
import { createDefaultApiConfig } from './headerConfig';

type ProbeStatus = 'idle' | 'probing' | 'success' | 'failed';

type WorkspaceApi = {
  onSaveApiConfig?: (config: CustomApiConfig) => CustomApiConfig | null | void | Promise<CustomApiConfig | null | void>;
  onDeleteApiConfig?: (configId: string) => void | Promise<void>;
  onClose?: () => void;
};

export function useApiConfigWorkspace(apiConfigs: CustomApiConfig[], api: WorkspaceApi) {
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(apiConfigs[0]?.id || null);
  const [editingConfig, setEditingConfig] = useState<CustomApiConfig | null>(apiConfigs[0] ? { ...apiConfigs[0] } : null);
  const [diagnosticChecking, setDiagnosticChecking] = useState(false);
  const [diagnosticResult, setDiagnosticResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showApiKeyInSettings, setShowApiKeyInSettings] = useState(false);
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [probeStatus, setProbeStatus] = useState<ProbeStatus>('idle');
  const [probeError, setProbeError] = useState<string | null>(null);
  const [recognizedModel, setRecognizedModel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedConfigId?.startsWith('draft_') && editingConfig?.id === selectedConfigId) return;
    if (selectedConfigId && apiConfigs.some((config) => config.id === selectedConfigId)) return;
    setSelectedConfigId(apiConfigs[0]?.id || null);
    setEditingConfig(apiConfigs[0] ? { ...apiConfigs[0] } : null);
  }, [apiConfigs, editingConfig?.id, selectedConfigId]);

  const isDraftConfig = Boolean(editingConfig?.id?.startsWith('draft_'));
  const panelTitle = useMemo(() => (isDraftConfig ? '新建模型配置' : '编辑模型配置'), [isDraftConfig]);

  const resetProbeState = (nextStatus: ProbeStatus = 'idle', nextError: string | null = null, nextRecognizedModel: string | null = null) => {
    setProbeStatus(nextStatus);
    setProbeError(nextError);
    setRecognizedModel(nextRecognizedModel);
  };

  const selectConfig = (config: CustomApiConfig) => {
    setSelectedConfigId(config.id);
    setEditingConfig({ ...config });
    setDiagnosticResult(null);
    setSaveError(null);
  };

  const handleProbeModelParams = async (modelName: string, config: CustomApiConfig) => {
    if (config.type === 'text' || !modelName.trim()) {
      resetProbeState();
      return;
    }

    resetProbeState('probing');

    try {
      const res = await fetch('/api/model-params/probe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          type: config.type,
          modelName: modelName.trim()
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success && (data.capabilityProfile || data.metadata)) {
        resetProbeState('success', null, data.recognizedAs || null);
        setEditingConfig((prev) => prev ? {
          ...prev,
          modelName: modelName.trim(),
          provider: data.capabilityProfile?.provider || prev.provider,
          capability: data.capabilityProfile?.capability || prev.capability,
          type: data.capabilityProfile?.capability === 'IMAGE_GENERATOR' ? 'image' : data.capabilityProfile?.capability === 'VIDEO_GENERATOR' ? 'video' : prev.type,
          canonicalModelId: data.capabilityProfile?.canonicalModelId || prev.canonicalModelId,
          activeCapabilityRevisionId: data.capabilityProfile?.activeRevisionId || prev.activeCapabilityRevisionId,
          capabilityProfile: data.capabilityProfile || prev.capabilityProfile,
          metadata: data.metadata || prev.metadata,
          supportsAspectRatio: (data.metadata || prev.metadata)?.supportsAspectRatio !== undefined ? (data.metadata || prev.metadata).supportsAspectRatio : prev.supportsAspectRatio,
          supportsResolution: (data.metadata || prev.metadata)?.supportsResolution !== undefined ? (data.metadata || prev.metadata).supportsResolution : prev.supportsResolution,
          supportsQuality: (data.metadata || prev.metadata)?.supportsQuality !== undefined ? (data.metadata || prev.metadata).supportsQuality : prev.supportsQuality,
          supportsNegativePrompt: (data.metadata || prev.metadata)?.supportsNegativePrompt !== undefined ? (data.metadata || prev.metadata).supportsNegativePrompt : prev.supportsNegativePrompt
        } : null);
      } else {
        resetProbeState('failed', data.error || '未找到该模型的参数配置，请确认模型 ID 是否正确。');
      }
    } catch (error: any) {
      resetProbeState('failed', error.message || '参数探测失败。');
    }
  };

  useEffect(() => {
    if (editingConfig?.type === 'text') {
      resetProbeState();
    } else if (editingConfig?.canonicalModelId) {
      resetProbeState('success', null, editingConfig.canonicalModelId || null);
    } else if (editingConfig?.modelName && !editingConfig.metadata) {
      void handleProbeModelParams(editingConfig.modelName, editingConfig);
    } else if (editingConfig?.metadata) {
      resetProbeState('success');
    } else {
      resetProbeState();
    }
  }, [editingConfig?.type, editingConfig?.modelName, editingConfig?.canonicalModelId]);

  const handleTestApiSettings = async () => {
    if (!editingConfig?.baseUrl) return;
    setDiagnosticChecking(true);
    setDiagnosticResult(null);
    try {
      const res = await fetch('/api/api-configs/test', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configId: editingConfig.id?.startsWith('draft_') ? undefined : editingConfig.id,
          baseUrl: editingConfig.baseUrl,
          apiKey: editingConfig.apiKey || '',
          provider: editingConfig.provider || 'Custom',
          alias: editingConfig.alias,
          type: editingConfig.type,
          modelName: editingConfig.modelName
        })
      });
      const data = await res.json().catch(() => ({}));
      setDiagnosticResult(res.ok && data.success
        ? { success: true, message: data.message || '连接成功。' }
        : { success: false, message: data.error || `连接测试失败 (${res.status})` });
    } catch (error: any) {
      setDiagnosticResult({ success: false, message: `无法建立连接：${error.message || String(error)}` });
    } finally {
      setDiagnosticChecking(false);
    }
  };

  const handleDragStart = (event: DragEvent, index: number) => {
    if (!isReorderMode) return;
    setDraggedIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (event: DragEvent, index: number) => {
    if (!isReorderMode || draggedIndex === null || draggedIndex === index) return;
    event.preventDefault();
  };

  const handleDrop = async (event: DragEvent, hoverIndex: number) => {
    if (!isReorderMode || draggedIndex === null) return;
    event.preventDefault();
    const reorderedConfigs = [...apiConfigs];
    const [removed] = reorderedConfigs.splice(draggedIndex, 1);
    if (!removed) return;
    reorderedConfigs.splice(hoverIndex, 0, removed);
    setDraggedIndex(null);
    for (const config of reorderedConfigs) await api.onSaveApiConfig?.(config);
  };

  const handleDelete = async () => {
    if (!editingConfig || isDraftConfig) return;
    await api.onDeleteApiConfig?.(editingConfig.id);
    const remains = apiConfigs.filter((config) => config.id !== editingConfig.id);
    setSelectedConfigId(remains[0]?.id || null);
    setEditingConfig(remains[0] ? { ...remains[0] } : null);
  };

  const createDraftConfig = () => {
    const newConfig = createDefaultApiConfig();
    setSelectedConfigId(newConfig.id);
    setEditingConfig(newConfig);
    setDiagnosticResult(null);
    setSaveError(null);
  };

  const handleConfigApplied = (config: CustomApiConfig) => {
    selectConfig(config);
    if (config.type === 'text') {
      resetProbeState();
    } else {
      resetProbeState('success', null, config.canonicalModelId || null);
    }
    if (!config.id?.startsWith('draft_')) {
      void api.onSaveApiConfig?.(config);
    }
  };

  const handleCancel = () => {
    setEditingConfig(null);
    api.onClose?.();
  };

  const handleSave = async () => {
    if (!editingConfig) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await api.onSaveApiConfig?.(editingConfig);
      if (saved && typeof saved === 'object') {
        selectConfig(saved);
      }
      api.onClose?.();
    } catch (error: any) {
      setSaveError(error.message || '保存模型配置失败。');
    } finally {
      setSaving(false);
    }
  };

  return {
    selectedConfigId,
    editingConfig,
    setSelectedConfigId,
    setEditingConfig,
    selectConfig,
    diagnosticChecking,
    diagnosticResult,
    setDiagnosticResult,
    showApiKeyInSettings,
    setShowApiKeyInSettings,
    isReorderMode,
    setIsReorderMode,
    draggedIndex,
    setDraggedIndex,
    probeStatus,
    setProbeStatus,
    probeError,
    setProbeError,
    recognizedModel,
    setRecognizedModel,
    saving,
    setSaving,
    saveError,
    setSaveError,
    isDraftConfig,
    panelTitle,
    handleProbeModelParams,
    handleTestApiSettings,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDelete,
    createDraftConfig,
    handleConfigApplied,
    handleCancel,
    handleSave
  };
}
