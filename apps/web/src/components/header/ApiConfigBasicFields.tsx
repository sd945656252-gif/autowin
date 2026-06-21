import { Eye, EyeOff, Globe, Key, Server, Sparkles } from 'lucide-react';
import { CustomApiConfig } from '../../types';
import { PROVIDER_PRESETS } from './headerConfig';

interface ApiConfigBasicFieldsProps {
  config: CustomApiConfig;
  showApiKey: boolean;
  onChange: (config: CustomApiConfig) => void;
  onToggleShowApiKey: () => void;
  onProbeModelParams: (modelName: string, config: CustomApiConfig) => void;
}

export function ApiConfigBasicFields({
  config,
  showApiKey,
  onChange,
  onToggleShowApiKey,
  onProbeModelParams
}: ApiConfigBasicFieldsProps) {
  const currentProvider = config.provider || 'OpenAI';
  const isPresetProvider = PROVIDER_PRESETS.includes(currentProvider as any);

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] text-zinc-500 font-bold tracking-wider font-mono uppercase mb-1.5">配置别名 Display Alias</label>
          <input
            type="text"
            value={config.alias}
            onChange={(e) => onChange({ ...config, alias: e.target.value })}
            placeholder="例如：提示词优化 GPT"
            className="w-full bg-[#0a0d16] border border-white/5 rounded-md px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-500"
          />
        </div>

        <div>
          <label className="block text-[10px] text-zinc-500 font-bold tracking-wider font-mono uppercase mb-1.5">模型能力 Capability Type</label>
          <select
            value={config.type}
            onChange={(e) => onChange({ ...config, type: e.target.value as CustomApiConfig['type'] })}
            className="w-full bg-[#0a0d16] border border-white/5 rounded-md px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-500 font-mono cursor-pointer"
          >
            <option value="text">文字生成 (TEXT GENERATOR)</option>
            <option value="image">图片生成 (IMAGE GENERATOR)</option>
            <option value="video">视频生成 (VIDEO GENERATOR)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] text-zinc-500 font-bold tracking-wider font-mono uppercase mb-1.5 flex items-center gap-1">
            <Server className="w-3.5 h-3.5 text-cyan-600" />
            服务商 Provider
          </label>
          <select
            value={isPresetProvider ? currentProvider : '__custom__'}
            onChange={(e) => onChange({ ...config, provider: e.target.value === '__custom__' ? '' : e.target.value })}
            className="w-full bg-[#0a0d16] border border-white/5 rounded-md px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-500"
          >
            {PROVIDER_PRESETS.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
            <option value="__custom__">自定义</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-zinc-500 font-bold tracking-wider font-mono uppercase mb-1.5">自定义服务商名称</label>
          <input
            type="text"
            value={config.provider || ''}
            onChange={(e) => onChange({ ...config, provider: e.target.value })}
            placeholder="选择自定义后输入，例如：本地网关"
            className="w-full bg-[#0a0d16] border border-white/5 rounded-md px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-[10px] text-zinc-500 font-bold tracking-wider font-mono uppercase mb-1.5 flex items-center gap-1">
          <Globe className="w-3.5 h-3.5 text-cyan-600" />
          接口基础地址 Base URL
        </label>
        <input
          type="text"
          value={config.baseUrl}
          onChange={(e) => onChange({ ...config, baseUrl: e.target.value })}
          placeholder="https://api.openai.com/v1"
          className="w-full bg-[#0a0d16] border border-white/5 rounded-md px-3 py-1.5 text-xs text-zinc-300 outline-none focus:border-cyan-500 font-mono"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] text-zinc-500 font-bold tracking-wider font-mono uppercase mb-1.5 flex items-center gap-1">
            <Key className="w-3.5 h-3.5 text-cyan-600" />
            API Key / Secret Token
            {config.hasApiKey && (
              <span className="ml-2 text-[9px] text-emerald-400 font-mono normal-case">
                已保存{config.keyPreview ? ` (${config.keyPreview})` : ''}
              </span>
            )}
          </label>
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={config.apiKey || ''}
              onChange={(e) => onChange({ ...config, apiKey: e.target.value })}
              placeholder={config.hasApiKey ? '留空表示不修改已保存密钥' : '输入服务商 API Key'}
              className="w-full bg-[#0a0d16] border border-white/5 rounded-md pl-3 pr-9 py-1.5 text-xs text-zinc-200 outline-none focus:border-cyan-500 font-mono"
            />
            <button
              type="button"
              onClick={onToggleShowApiKey}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
              title={showApiKey ? '隐藏密钥' : '显示密钥'}
            >
              {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5 text-slate-400" />}
            </button>
          </div>
          <p className="text-[8px] text-zinc-600 mt-1 font-mono uppercase tracking-tighter">
            密钥只提交到后端加密保存，不会从 API 明文回传。编辑时留空不会覆盖已保存密钥。
          </p>
        </div>

        <div>
          <label className="block text-[10px] text-zinc-500 font-bold tracking-wider font-mono uppercase mb-1.5 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-cyan-600" />
            模型 ID Model ID
          </label>
          <input
            type="text"
            value={config.modelName}
            onChange={(e) => onChange({ ...config, modelName: e.target.value })}
            onBlur={(e) => onProbeModelParams(e.target.value, config)}
            placeholder="例如：gpt-4.1-mini / claude-3-5-sonnet / doubao-seedream"
            className="w-full bg-[#0a0d16] border border-white/5 rounded-md px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-500 font-mono"
          />
          <p className="text-[8px] text-zinc-600 mt-1 font-mono uppercase tracking-tighter">
            图片/视频模型会尝试探测参数；文字模型只保存调用所需元数据。
          </p>
        </div>
      </div>
    </>
  );
}
