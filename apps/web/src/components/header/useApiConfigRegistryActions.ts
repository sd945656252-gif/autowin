import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CustomApiConfig } from '../../types';
import { saveModelCapabilityRevision } from '../../lib/db';
import {
  capabilityProfileToEditableJson,
  capabilityToType,
  formatSaveError,
  metadataFromRegistryEntry,
  type RegistryEntry
} from './apiConfigParameterUtils';

type Props = {
  config: CustomApiConfig;
  capability: RegistryEntry['capability'];
  capabilityProfile: CustomApiConfig['capabilityProfile'];
  onConfigApplied?: (config: CustomApiConfig, options?: { persist?: boolean }) => void;
};

export function useApiConfigRegistryActions({
  config,
  capability,
  capabilityProfile,
  onConfigApplied
}: Props) {
  const queryClient = useQueryClient();
  const [showRegistryModal, setShowRegistryModal] = useState(false);
  const [showApplyMenu, setShowApplyMenu] = useState(false);
  const [applyStatus, setApplyStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [applyError, setApplyError] = useState<string | null>(null);
  const [editingRegistryJson, setEditingRegistryJson] = useState('');
  const [registryEditError, setRegistryEditError] = useState<string | null>(null);
  const [registrySaveStatus, setRegistrySaveStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const { data: registryData } = useQuery({
    queryKey: ['model-capabilities-registry'],
    queryFn: async () => {
      const response = await fetch('/api/model-capabilities/registry', { credentials: 'same-origin' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Failed to load registry');
      return data.registry as RegistryEntry[];
    },
    enabled: config.type !== 'text',
    staleTime: 300_000
  });

  const filteredRegistryData = useMemo(
    () => registryData?.filter((entry) => entry.capability === capability) || [],
    [capability, registryData]
  );

  const handleOpenRegistry = (canonicalId: string) => {
    const entry = registryData?.find((item) => item.canonicalModelId === canonicalId);
    const currentProfile = capabilityProfileToEditableJson(capabilityProfile || null, config);
    setEditingRegistryJson(JSON.stringify(currentProfile || entry || {}, null, 2));
    setRegistryEditError(null);
    setRegistrySaveStatus('idle');
    setShowRegistryModal(true);
  };

  const handleValidateRegistryJson = () => {
    try {
      JSON.parse(editingRegistryJson);
      setRegistryEditError(null);
      setRegistryEditError('JSON 格式正确。确认无误后可点击“确认保存”写入后端，并替换当前 active revision。');
    } catch {
      setRegistryEditError('JSON 格式错误，请检查。');
    }
  };

  const handleSaveRegistryJson = async () => {
    setRegistrySaveStatus('loading');
    setRegistryEditError(null);
    try {
      const parsed = JSON.parse(editingRegistryJson || '{}');
      const candidate = Array.isArray(parsed)
        ? parsed.find((item) => item?.canonicalModelId === config.canonicalModelId) || null
        : parsed;
      if (!candidate || typeof candidate !== 'object') {
        throw new Error('JSON 必须是当前模型的参数对象，或包含当前 canonicalModelId 的注册表记录。');
      }

      const entry = candidate as Partial<RegistryEntry> & {
        activeRevision?: { params?: Record<string, any> };
        verificationStatus?: 'VERIFIED' | 'UNVERIFIED' | 'MANUAL_VERIFIED' | 'DEPRECATED';
      };
      const canonicalModelId = String(entry.canonicalModelId || config.canonicalModelId || '').trim();
      if (!canonicalModelId) throw new Error('缺少 canonicalModelId，无法定位要替换的后端模型参数。');

      const nextCapability = (entry.capability || capability) as RegistryEntry['capability'];
      const params = entry.params || entry.activeRevision?.params || (
        (candidate as any).imageCapabilities || (candidate as any).videoCapabilities
          ? candidate as Record<string, any>
          : null
      );
      if (!params || typeof params !== 'object' || Array.isArray(params)) {
        throw new Error('缺少 params，或 params 不是对象。');
      }

      const normalized = {
        canonicalModelId,
        capability: nextCapability,
        params,
        sourceUrls: Array.isArray(entry.sourceUrls) ? entry.sourceUrls.map(String) : capabilityProfile?.sourceUrls || [],
        verificationStatus: entry.verificationStatus || (capabilityProfile?.verificationStatus === 'UNVERIFIED' ? 'MANUAL_VERIFIED' : capabilityProfile?.verificationStatus) || 'MANUAL_VERIFIED',
        registryEntry: entry
      };

      const updated = await saveModelCapabilityRevision({
        canonicalModelId: normalized.canonicalModelId,
        capability: normalized.capability,
        params: normalized.params,
        verificationStatus: normalized.verificationStatus,
        sourceUrls: normalized.sourceUrls,
        changedSummary: 'Updated from model center JSON table'
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['model-configs'] }),
        queryClient.invalidateQueries({ queryKey: ['model-capabilities'] }),
        queryClient.invalidateQueries({ queryKey: ['model-capabilities-registry'] })
      ]);

      const nextParams = updated.activeRevision?.params || normalized.params;
      const nextConfig: CustomApiConfig = {
        ...config,
        canonicalModelId: updated.canonicalModelId || normalized.canonicalModelId,
        activeCapabilityRevisionId: updated.activeRevisionId || config.activeCapabilityRevisionId,
        capability: updated.capability || normalized.capability,
        type: capabilityToType(updated.capability || normalized.capability),
        capabilityProfile: updated,
        metadata: metadataFromRegistryEntry({
          canonicalModelId: updated.canonicalModelId || normalized.canonicalModelId,
          officialModelId: updated.officialModelId || normalized.registryEntry.officialModelId || config.modelName,
          provider: updated.provider || normalized.registryEntry.provider || config.provider || 'Custom',
          capability: updated.capability || normalized.capability,
          aliases: updated.aliases || normalized.registryEntry.aliases || [],
          params: nextParams,
          sourceUrls: updated.sourceUrls || normalized.sourceUrls
        }) || config.metadata
      };

      onConfigApplied?.(nextConfig, { persist: true });
      setEditingRegistryJson(JSON.stringify(capabilityProfileToEditableJson(updated, nextConfig) || {
        ...normalized.registryEntry,
        canonicalModelId: normalized.canonicalModelId,
        capability: normalized.capability,
        params: nextParams,
        sourceUrls: normalized.sourceUrls,
        verificationStatus: normalized.verificationStatus
      }, null, 2));
      setRegistrySaveStatus('success');
      setRegistryEditError('已确认保存：JSON 参数已写入后端能力版本，并替换当前 active revision。');
      setTimeout(() => setRegistrySaveStatus('idle'), 3000);
    } catch (error: any) {
      setRegistrySaveStatus('error');
      setRegistryEditError(formatSaveError(error));
    }
  };

  const handleApplyRegistry = async (canonicalModelId: string) => {
    setShowApplyMenu(false);
    setApplyStatus('loading');
    setApplyError(null);
    try {
      const entry = registryData?.find((item) => item.canonicalModelId === canonicalModelId);
      const response = await fetch('/api/model-capabilities/registry/apply', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canonicalModelId,
          configId: config.id?.startsWith('draft_') ? undefined : config.id
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Apply failed');

      const nextConfig = data.config || (entry ? {
        ...config,
        provider: entry.provider,
        type: capabilityToType(entry.capability),
        capability: entry.capability,
        canonicalModelId: entry.canonicalModelId,
        activeCapabilityRevisionId: data.capability?.activeRevisionId || data.capability?.activeRevision?.id,
        capabilityProfile: data.capability,
        metadata: metadataFromRegistryEntry(entry)
      } : null);

      if (nextConfig) onConfigApplied?.(nextConfig as CustomApiConfig, { persist: !data.config });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['model-configs'] }),
        queryClient.invalidateQueries({ queryKey: ['model-capabilities'] }),
        queryClient.invalidateQueries({ queryKey: ['model-capabilities-registry'] })
      ]);
      setApplyStatus('success');
      setTimeout(() => setApplyStatus('idle'), 3000);
    } catch (error: any) {
      setApplyStatus('error');
      setApplyError(error.message || 'Apply failed');
    }
  };

  return {
    showRegistryModal,
    setShowRegistryModal,
    showApplyMenu,
    setShowApplyMenu,
    applyStatus,
    applyError,
    editingRegistryJson,
    setEditingRegistryJson,
    registryData,
    registryEditError,
    registrySaveStatus,
    filteredRegistryData,
    handleOpenRegistry,
    handleSaveRegistryJson,
    handleApplyRegistry,
    handleValidateRegistryJson
  };
}
