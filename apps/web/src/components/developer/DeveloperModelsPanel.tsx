import { useQueryClient } from '@tanstack/react-query';
import { ApiConfigWorkspace } from '../header/ApiConfigWorkspace';
import { useAuth } from '../AuthContext';
import type { CustomApiConfig } from '../../types';

export function DeveloperModelsPanel() {
  const { globalApiConfigs, saveGlobalApiConfig, deleteGlobalApiConfig } = useAuth();
  const queryClient = useQueryClient();

  const saveApiConfig = async (config: CustomApiConfig) => {
    const saved = await saveGlobalApiConfig(config);
    await queryClient.invalidateQueries({ queryKey: ['model-configs'] });
    return saved;
  };

  const deleteApiConfig = async (configId: string) => {
    await deleteGlobalApiConfig(configId);
    await queryClient.invalidateQueries({ queryKey: ['model-configs'] });
  };

  return (
    <div className="space-y-4">
      <div className="border border-white/10 bg-white/[0.03] rounded-lg p-4">
        <h2 className="text-lg font-bold text-white">模型中心</h2>
        <p className="text-sm text-zinc-400 mt-1">新增会创建新记录，编辑只更新当前记录。provider 会与密钥分开保存。</p>
      </div>
      <ApiConfigWorkspace apiConfigs={globalApiConfigs || []} onSaveApiConfig={saveApiConfig} onDeleteApiConfig={deleteApiConfig} compact />
    </div>
  );
}
