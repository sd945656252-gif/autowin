import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CustomApiConfig } from '../../types';
import { saveModelCapabilityRevision } from '../../lib/db';
import { cloneWithRuntime, runtimeEditorFromParams, type RegistryEntry, type RuntimeEditorState } from './apiConfigParameterUtils';

type Props = {
  config: CustomApiConfig;
  capability: RegistryEntry['capability'];
  capabilityProfile: CustomApiConfig['capabilityProfile'];
  activeParams: Record<string, any>;
  onConfigApplied?: (config: CustomApiConfig, options?: { persist?: boolean }) => void;
};

export function useApiConfigRuntimeAdapter({
  config,
  capability,
  capabilityProfile,
  activeParams,
  onConfigApplied
}: Props) {
  const queryClient = useQueryClient();
  const [runtimeEditor, setRuntimeEditor] = useState<RuntimeEditorState>(() => runtimeEditorFromParams({}, config.type));
  const [runtimeSaveStatus, setRuntimeSaveStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [runtimeSaveError, setRuntimeSaveError] = useState<string | null>(null);
  const activeRevisionId = capabilityProfile?.activeRevisionId || capabilityProfile?.activeRevision?.id || '';

  useEffect(() => {
    setRuntimeEditor(runtimeEditorFromParams(activeParams, config.type));
    setRuntimeSaveStatus('idle');
    setRuntimeSaveError(null);
  }, [activeRevisionId, config.type, config.canonicalModelId]);

  const handleSaveRuntime = async () => {
    if (!config.canonicalModelId || !capabilityProfile) return;
    setRuntimeSaveStatus('loading');
    setRuntimeSaveError(null);
    try {
      const updated = await saveModelCapabilityRevision({
        canonicalModelId: config.canonicalModelId,
        capability,
        params: cloneWithRuntime(activeParams, config.type, runtimeEditor),
        verificationStatus: capabilityProfile.verificationStatus === 'UNVERIFIED' ? 'MANUAL_VERIFIED' : capabilityProfile.verificationStatus,
        sourceUrls: capabilityProfile.sourceUrls || [],
        changedSummary: 'Updated runtime adapter from model center'
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['model-configs'] }),
        queryClient.invalidateQueries({ queryKey: ['model-capabilities'] })
      ]);
      onConfigApplied?.({
        ...config,
        activeCapabilityRevisionId: updated.activeRevisionId || config.activeCapabilityRevisionId,
        capabilityProfile: updated
      }, { persist: true });
      setRuntimeSaveStatus('success');
      setTimeout(() => setRuntimeSaveStatus('idle'), 3000);
    } catch (error: any) {
      setRuntimeSaveStatus('error');
      setRuntimeSaveError(error.message || '保存运行配置失败。');
    }
  };

  return {
    runtimeEditor,
    setRuntimeEditor,
    runtimeSaveStatus,
    runtimeSaveError,
    handleSaveRuntime
  };
}
