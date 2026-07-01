import type { CustomApiConfig } from '../../types';

export const PRESET_AVATARS = [
  { name: '银河代码', url: 'https://images.unsplash.com/photo-1614064641938-3bbee52942c7?w=150&auto=format&fit=crop&q=80' },
  { name: '赛博流光', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80' },
  { name: '神经网络', url: 'https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=150&auto=format&fit=crop&q=80' },
  { name: '极光星云', url: 'https://images.unsplash.com/photo-1640006807976-a6127e9d6fa0?w=150&auto=format&fit=crop&q=80' },
  { name: '未来机械', url: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=150&auto=format&fit=crop&q=80' }
];

export const PROVIDER_PRESETS = ['OpenAI', 'OpenAI Compatible', 'Google', 'Anthropic', '火山引擎', 'Kling', 'OpenRouter'] as const;

export function createDefaultApiConfig(): CustomApiConfig {
  return {
    id: `draft_${Date.now()}`,
    alias: '新自定义 API 模型',
    provider: 'OpenAI Compatible',
    type: 'text',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    modelName: '',
    supportsAspectRatio: true,
    supportsResolution: true,
    supportsQuality: false,
    supportsNegativePrompt: true,
    supportsNumOutputs: false,
    autoDetectParams: true
  };
}
