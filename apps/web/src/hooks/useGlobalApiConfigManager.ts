import { useEffect } from 'react';
import type { CustomApiConfig } from '../types';

type ManageableRole = 'ADMIN' | 'DEVELOPER' | 'USER' | null | undefined;

type UseGlobalApiConfigManagerArgs = {
  currentUserRole: ManageableRole;
  globalApiConfigs: CustomApiConfig[] | null;
  saveGlobalApiConfigs: (configs: CustomApiConfig[]) => Promise<void>;
};

function canManageApiConfigs(role: ManageableRole): boolean {
  return role === 'ADMIN' || role === 'DEVELOPER';
}

async function syncApiConfigMetadata(config: CustomApiConfig): Promise<CustomApiConfig> {
  const response = await fetch('/api/model-params/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: config.id,
      type: config.type,
      modelName: config.modelName,
      alias: config.alias
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success || !data.metadata) {
    return config;
  }

  return {
    ...config,
    metadata: { ...config.metadata, ...data.metadata }
  };
}

export function useGlobalApiConfigManager({
  currentUserRole,
  globalApiConfigs,
  saveGlobalApiConfigs
}: UseGlobalApiConfigManagerArgs) {
  useEffect(() => {
    if (!canManageApiConfigs(currentUserRole) || !globalApiConfigs?.length) {
      return;
    }

    let cancelled = false;

    async function syncMissingMetadata() {
      let changed = false;
      const updatedConfigs = [...globalApiConfigs];

      for (let index = 0; index < updatedConfigs.length; index++) {
        const config = updatedConfigs[index];
        if (config.metadata && Object.keys(config.metadata).length > 0) {
          continue;
        }

        try {
          const syncedConfig = await syncApiConfigMetadata(config);
          if (syncedConfig !== config) {
            updatedConfigs[index] = syncedConfig;
            changed = true;
          }
        } catch (error) {
          console.error(`Failed to background sync metadata for ${config.id}:`, error);
        }
      }

      if (!cancelled && changed) {
        await saveGlobalApiConfigs(updatedConfigs);
      }
    }

    void syncMissingMetadata();

    return () => {
      cancelled = true;
    };
  }, [currentUserRole, globalApiConfigs, saveGlobalApiConfigs]);

  const handleSaveApiConfig = async (config: CustomApiConfig) => {
    const updatedConfigs = [...(globalApiConfigs || [])];
    const existingIndex = updatedConfigs.findIndex((item) => item.id === config.id);

    if (existingIndex >= 0) {
      updatedConfigs[existingIndex] = config;
    } else {
      updatedConfigs.push(config);
    }

    await saveGlobalApiConfigs(updatedConfigs);

    try {
      const syncedConfig = await syncApiConfigMetadata(config);
      if (syncedConfig === config) {
        return;
      }

      const enrichedConfigs = [...updatedConfigs];
      const syncedIndex = enrichedConfigs.findIndex((item) => item.id === config.id);
      if (syncedIndex >= 0) {
        enrichedConfigs[syncedIndex] = syncedConfig;
        await saveGlobalApiConfigs(enrichedConfigs);
      }
    } catch (error) {
      console.error('Failed to sync model parameters:', error);
    }
  };

  const handleDeleteApiConfig = async (configId: string) => {
    const updatedConfigs = (globalApiConfigs || []).filter((config) => config.id !== configId);
    await saveGlobalApiConfigs(updatedConfigs);
  };

  return {
    handleSaveApiConfig,
    handleDeleteApiConfig
  };
}
