import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, Paperclip, RefreshCw, X } from 'lucide-react';
import { CustomApiConfig, PipelineAssistantAction, PipelineAssistantMessage, ProductionStage } from '../types';
import { confirmPipelineAssistantAction, fetchPipelineAssistantContext, fetchPipelineAssistantMessages, fetchTextGeneratorModels, rejectPipelineAssistantAction, sendPipelineAssistantMessage, uploadPipelineAssistantAttachment } from '../lib/db';
import { useAuth } from './AuthContext';

interface ChatPanelProps {
  activeNode: string;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  userId?: string;
  currentProjectId?: string | null;
}

const stageByNode: Record<string, ProductionStage> = {
  '02': 'SCRIPT_01',
  '04': 'ART_03',
  '05': 'SHOT_04',
  '06': 'EDIT_05'
};

const welcomeByStage: Record<ProductionStage, string> = {
  SCRIPT_01: '我是 01 剧本 AI 编剧顾问。可以和你讨论故事、人物、场次、台词和结构问题；只有你明确要求写入或创建剧本草案时，我才会给出待确认操作。',
  DIRECTOR_02: '我是历史导演讲戏 AI 导演顾问。这个阶段仅用于旧数据兼容，新提示词能力请到配置与监控的提示词优化中使用。',
  ART_03: '我是 02 美术设计 AI 美术顾问。专注角色演绎、表情动作、服装穿着、道具形制、场景氛围和风格统一；建节点或启动生成必须经过你确认。',
  SHOT_04: '我是 03 镜头设计 AI 镜头顾问。可以讨论临时镜头、机位、景别、焦段、构图、运镜和镜头组接；创建镜头节点或启动生成前会先给确认卡。',
  EDIT_05: '我是 04 剪辑 AI 剪辑顾问。可以围绕粗剪结构、节奏、转场、声画关系、卡点和时间线修改给方案；落到时间线前会先确认。'
};

const actionTitle: Record<string, string> = {
  SCRIPT_CREATE_OR_UPDATE: '创建/更新剧本',
  SCRIPT_IMPORT_PARSE: '解析并导入剧本',
  DIRECTOR_PROMPT_FILL: '填入导演提示词',
  DIRECTOR_PROMPT_GENERATE: '生成导演提示词',
  ART_NODE_CREATE: '创建美术节点',
  ART_NODE_UPDATE: '更新美术节点',
  ART_GENERATE_START: '启动美术生成',
  SHOT_NODE_CREATE: '创建镜头节点',
  SHOT_NODE_UPDATE: '更新镜头节点',
  SHOT_GENERATE_START: '启动镜头生成',
  EDIT_TIMELINE_UPDATE: '更新时间线',
  EDIT_ROUGH_CUT_CREATE: '创建粗剪方案',
  EDIT_EFFECT_OR_AUDIO_MARKER_ADD: '添加特效/音频卡点'
};

const emptyHintByStage: Partial<Record<ProductionStage, string>> = {
  SCRIPT_01: '当前剧本工作区还比较空，我可以先帮你搭一个剧本框架、角色关系或分场大纲。',
  DIRECTOR_02: '当前历史导演讲戏面板仅用于兼容旧数据。',
  ART_03: '当前美术画布还没有节点，可以先从角色、场景、道具或氛围任一项开始，我会先给专业判断。',
  SHOT_04: '当前镜头画布还没有节点，可以先给我场景描述，我会先拆成镜头节点建议。',
  EDIT_05: '当前剪辑工作区还没有足够时间线内容，可以先讨论粗剪方案或节奏草案，我会先给判断。'
};

const assistantUiByStage: Record<ProductionStage, { title: string; colClass: string; userBubbleClass: string }> = {
  SCRIPT_01: {
    title: '01 剧本 AI 编剧顾问',
    colClass: 'text-purple-400 bg-purple-500/20',
    userBubbleClass: 'bg-purple-600/80 border border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]'
  },
  DIRECTOR_02: {
    title: '历史导演讲戏 AI 导演顾问',
    colClass: 'text-amber-400 bg-amber-500/20',
    userBubbleClass: 'bg-amber-600/80 border border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
  },
  ART_03: {
    title: '02 美术设计 AI 美术顾问',
    colClass: 'text-blue-400 bg-blue-500/20',
    userBubbleClass: 'bg-blue-600/80 border border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]'
  },
  SHOT_04: {
    title: '03 镜头设计 AI 镜头顾问',
    colClass: 'text-green-400 bg-green-500/20',
    userBubbleClass: 'bg-green-600/80 border border-green-500/50 shadow-[0_0_15px_rgba(34,197,94,0.3)]'
  },
  EDIT_05: {
    title: '04 剪辑 AI 剪辑顾问',
    colClass: 'text-teal-400 bg-teal-500/20',
    userBubbleClass: 'bg-teal-600/80 border border-teal-500/50 shadow-[0_0_15px_rgba(20,184,166,0.3)]'
  }
};

const inputPlaceholderByStage: Record<ProductionStage, string> = {
  SCRIPT_01: '和 01 剧本 AI 编剧顾问讨论故事、人物、台词或改写方向；如需写入剧本请明确说明',
  DIRECTOR_02: '历史导演讲戏兼容阶段；新提示词能力请到配置与监控的提示词优化中使用',
  ART_03: '和 02 美术设计 AI 美术顾问讨论角色、道具、场景或氛围；如需建节点或生成请明确说明',
  SHOT_04: '和 03 镜头设计 AI 镜头顾问讨论机位、景别、构图或运镜；如需建节点或生成请明确说明',
  EDIT_05: '和 04 剪辑 AI 剪辑顾问讨论节奏、转场、声画或时间线；如需更新剪辑请明确说明'
};

function getTextModelDisplayName(model?: Pick<CustomApiConfig, 'displayName' | 'alias' | 'modelName'> | null) {
  const rawLabel = String(model?.displayName || model?.alias || '').trim();
  if (rawLabel) return rawLabel.replace(/\s*\([^)]*\)\s*$/, '').trim() || rawLabel;
  return '未命名文字模型';
}

function getAssistantErrorHint(message: string, stage?: ProductionStage) {
  const text = message || '';
  if (text.includes('PIPELINE_ASSISTANT_TEXT_MODEL_REQUIRED') || text.includes('文字生成模型配置不完整')) {
    return '请先在开发页选择一个可用的文字生成模型，再回到助手继续。';
  }
  if (text.includes('Provider request failed') || text.includes('Provider returned empty text') || text.includes('文字生成模型调用失败')) {
    return '当前文字生成模型调用失败，请先在模型中心测试自定义模型连接，确认接口、密钥、模型名和能力类型可用。';
  }
  if (text.includes('PIPELINE_ASSISTANT_EDIT_PERMISSION_REQUIRED') || text.includes('没有确认写入')) {
    return '当前账号只有查看权限，无法确认写入。请切换到有编辑权限的账号。';
  }
  if (text.includes('PIPELINE_ASSISTANT_ATTACHMENT_MAGIC_MISMATCH')) {
    return '附件类型和内容不一致。请重新选择正确格式的文件后再上传。';
  }
  if (text.includes('PIPELINE_ASSISTANT_ATTACHMENT_UNSUPPORTED')) {
    return `当前 ${stage || '该'} 阶段暂不支持这种附件类型。`;
  }
  if (text.includes('PIPELINE_ASSISTANT_ACTION_EXPIRED')) {
    return '这条建议已过期，请让助手重新生成一条新的确认项。';
  }
  if (text.includes('PIPELINE_ASSISTANT_WORKSPACE_CONFLICT')) {
    return '工作区已更新，当前建议失效。请重新生成一次再确认。';
  }
  if (text.includes('PIPELINE_ASSISTANT_STAGE_MISMATCH')) {
    return '这条操作不属于当前阶段，已经被拦截。';
  }
  if (text.includes('Request failed: 401') || text.includes('Authentication is required')) {
    return '当前会话已失效，请重新登录后再继续。';
  }
  if (text.includes('Request failed: 403') || text.includes('无权限')) {
    return '你没有执行这项操作的权限。';
  }
  return message;
}

function getStageWorkSummary(stage?: ProductionStage, context?: any) {
  const tools = Array.isArray(context?.tools) ? context.tools.join('、') : '';
  const skills = Array.isArray(context?.skills) ? context.skills.map((skill: any) => skill.name || skill.id).filter(Boolean).join('、') : '';
  const memoryCount = Number(context?.skillMemory?.itemCount || 0);
  const assetCount = Array.isArray(context?.assets) ? context.assets.length : 0;
  const workspaceHasContent = Boolean(context?.workspace?.hasContent);
  const summaryParts = [
    `文字模型：${context?.selectedModelLabel || '未选择'}`,
    skills ? `阶段技能：${skills}` : '',
    memoryCount > 0 ? `专业记忆：${memoryCount} 条` : '专业记忆：仅记录相关偏好',
    tools ? `当前阶段工具：${tools}` : '当前阶段暂无可用工具',
    workspaceHasContent ? `当前资产：${assetCount}` : (stage ? emptyHintByStage[stage] || '当前工作区暂无内容。' : '当前工作区暂无内容。')
  ];
  return summaryParts.filter(Boolean).join('｜');
}

export default function ChatPanel({ activeNode, collapsed, setCollapsed, userId, currentProjectId }: ChatPanelProps) {
  const { activeCustomApiId, selectedModel } = useAuth();
  const stage = stageByNode[activeNode];
  const { data: textGeneratorModels = [] } = useQuery({
    queryKey: ['pipeline-assistant-text-models', userId || 'guest'],
    queryFn: fetchTextGeneratorModels,
    staleTime: 30_000,
    enabled: Boolean(userId)
  });
  const [messages, setMessages] = useState<PipelineAssistantMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState('');
  const [contextText, setContextText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textModelOptions = useMemo(() => textGeneratorModels.filter(api => api.type === 'text' && api.capability === 'TEXT_GENERATOR' && api.isEnabled !== false), [textGeneratorModels]);
  const selectedTextModel = useMemo(() => textModelOptions.find(api => api.id === activeCustomApiId) || null, [activeCustomApiId, textModelOptions]);
  const selectedTextModelLabel = useMemo(() => {
    if (selectedTextModel) return getTextModelDisplayName(selectedTextModel);
    if (activeCustomApiId && activeCustomApiId !== 'default') return `已选模型 ${activeCustomApiId}`;
    if (selectedModel && selectedModel !== 'custom') return `当前模式：${selectedModel}`;
    return '尚未选择文字模型';
  }, [activeCustomApiId, selectedModel, selectedTextModel]);
  const welcomeMessage = useMemo<PipelineAssistantMessage | null>(() => stage ? ({
    id: `welcome_${stage}`,
    sender: 'ai',
    text: welcomeByStage[stage],
    timestamp: new Date().toISOString(),
    actions: []
  }) : null, [stage]);

  // Initialize stage messages
  useEffect(() => {
    const initChat = async () => {
      if (!stage) return;
      setLoading(true);
      setErrorText('');
      try {
        const [history, context] = await Promise.all([
          fetchPipelineAssistantMessages({ projectId: currentProjectId, stage }),
          fetchPipelineAssistantContext({ projectId: currentProjectId, stage })
        ]);
        setMessages(history);
        setContextText(getStageWorkSummary(stage, { ...context, selectedModelLabel: selectedTextModelLabel }));
      } catch (error: any) {
        setMessages([]);
        setErrorText(getAssistantErrorHint(error?.message || '助手消息读取失败。', stage));
      } finally {
        setLoading(false);
      }
    };
    initChat();
  }, [stage, currentProjectId, userId, selectedTextModelLabel]);

  // Auto scroll
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!stage || !inputText.trim() || loading) return;

    const userMessage: PipelineAssistantMessage = {
      id: `msg_user_${Date.now()}`,
      sender: 'user',
      text: inputText,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setLoading(true);
    setErrorText('');

    try {
      const data = await sendPipelineAssistantMessage({
        projectId: currentProjectId,
        stage,
        text: userMessage.text,
        customModelId: activeCustomApiId
      });
      setMessages(prev => [...prev, data.message]);
    } catch (e: any) {
      setErrorText(getAssistantErrorHint(e?.message || '助手响应生成失败。', stage));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAction = async (action: PipelineAssistantAction) => {
    if (!stage || action.status !== 'PENDING') return;
    setActionBusyId(action.id);
    setErrorText('');
    try {
      const updated = await confirmPipelineAssistantAction({ projectId: currentProjectId, stage, actionId: action.id });
      setMessages(prev => prev.map(message => ({
        ...message,
        actions: (message.actions || []).map(item => item.id === updated.id ? updated : item)
      })));
      window.dispatchEvent(new CustomEvent('jiying:pipeline-assistant-action-confirmed', { detail: { stage, action: updated } }));
      window.dispatchEvent(new Event('jiying:production-assets-changed'));
    } catch (error: any) {
      setErrorText(getAssistantErrorHint(error?.message || '操作执行失败。', stage));
    } finally {
      setActionBusyId(null);
    }
  };

  const handleRejectAction = async (action: PipelineAssistantAction) => {
    if (!stage || action.status !== 'PENDING') return;
    setActionBusyId(action.id);
    setErrorText('');
    try {
      const updated = await rejectPipelineAssistantAction({ projectId: currentProjectId, stage, actionId: action.id });
      setMessages(prev => prev.map(message => ({
        ...message,
        actions: (message.actions || []).map(item => item.id === updated.id ? updated : item)
      })));
    } catch (error: any) {
      setErrorText(error?.message || '操作取消失败。');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleUploadAttachment = async (file?: File) => {
    if (!stage || !file || uploading) return;
    setUploading(true);
    setErrorText('');
    try {
      const userMessage: PipelineAssistantMessage = {
        id: `msg_upload_${Date.now()}`,
        sender: 'user',
        text: `上传附件：${file.name}`,
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, userMessage]);
      const data = await uploadPipelineAssistantAttachment({ projectId: currentProjectId, stage, file });
      setMessages(prev => [...prev, data.message]);
    } catch (error: any) {
      setErrorText(getAssistantErrorHint(error?.message || '附件上传或解析失败。', stage));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (collapsed) return null;

  const headerDef = stage ? assistantUiByStage[stage] : { title: 'AI 助手', colClass: 'text-white bg-white/20', userBubbleClass: 'bg-white/10 border border-white/10' };
  const openModelCenter = () => {
    window.history.pushState({}, '', '/developer#developer-models');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div
      className="w-96 shrink-0 bg-[#0a0a0a] border-l border-[rgba(255,255,255,0.08)] flex flex-col z-20 relative h-full select-none"
      data-testid="pipeline-assistant-panel"
      data-stage={stage || ''}
    >
      <div className="flex flex-col w-96 h-full font-sans">
        
        {/* Header toolbar */}
        <div className="h-14 border-b border-[rgba(255,255,255,0.08)] flex items-center justify-between px-5 shrink-0 bg-white/5">
          <div className="flex items-center space-x-2">
            <div className={`w-5 h-5 rounded flex items-center justify-center ${headerDef.colClass}`}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="font-bold text-white tracking-widest text-xs" data-testid="pipeline-assistant-title">{headerDef.title}</span>
          </div>
          <button onClick={() => setCollapsed(true)} className="text-gray-500 hover:text-white transition-colors cursor-pointer" title="收起助手">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
        
        {/* Messages center scroll panel */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar bg-black/20 text-justify" data-testid="pipeline-assistant-messages">
          {messages.length === 0 && welcomeMessage && (
            <div className="flex flex-col space-y-1 items-start">
              <div className="bg-white/10 border border-white/5 rounded-2xl rounded-tl-sm p-4 text-xs text-white/90 leading-relaxed w-[85%] shadow-md whitespace-pre-line">
                {welcomeMessage.text}
              </div>
              {contextText && <div className="text-[10px] text-zinc-500 whitespace-pre-line">{contextText}</div>}
            </div>
          )}
          {[...messages].map((msg) => {
            const isUser = msg.sender === 'user';
            
            // Generate tailored style bubble blocks
            const aiBubble = 'bg-white/10 border border-white/5 rounded-2xl rounded-tl-sm p-4 text-xs text-white/90 leading-relaxed w-[85%] shadow-md whitespace-pre-line';
            
            const userBubble = `text-white rounded-2xl rounded-tr-sm p-4 text-xs leading-relaxed max-w-[85%] whitespace-pre-line ${headerDef.userBubbleClass}`;

            return (
              <div key={msg.id} className={`flex flex-col space-y-1 ${isUser ? 'items-end' : 'items-start'}`}>
                <div className={isUser ? userBubble : aiBubble}>
                  {msg.text}
                </div>
                {!isUser && (msg.actions || []).map((action) => (
                  <div
                    key={action.id}
                    className="w-[85%] rounded-md border border-cyan-400/20 bg-cyan-400/10 p-3 text-xs text-cyan-50 shadow-md"
                    data-testid="pipeline-assistant-action-card"
                    data-action-id={action.id}
                    data-action-type={action.type}
                    data-action-status={action.status}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold">{actionTitle[action.type] || action.type}</div>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${
                        action.status === 'PENDING' ? 'border-amber-300/30 text-amber-100' :
                        action.status === 'CONFIRMED' ? 'border-emerald-300/30 text-emerald-100' :
                        action.status === 'FAILED' ? 'border-red-300/30 text-red-100' :
                        'border-white/20 text-zinc-300'
                      }`}>
                        {action.status}
                      </span>
                    </div>
                    {action.targetId && <div className="mt-1 text-[10px] text-cyan-200/70">目标：{action.targetId}</div>}
                    <div className="mt-2 max-h-36 overflow-y-auto whitespace-pre-line rounded border border-white/10 bg-black/25 p-2 text-[11px] leading-5 text-zinc-100">
                      {action.previewText}
                    </div>
                    {action.executionResult?.message && (
                      <div className="mt-2 rounded border border-white/10 bg-white/5 p-2 text-[11px] text-zinc-300">{action.executionResult.message}</div>
                    )}
                    {action.errorMessage && (
                      <div className="mt-2 rounded border border-red-400/20 bg-red-400/10 p-2 text-[11px] text-red-100">{action.errorMessage}</div>
                    )}
                    {action.status === 'PENDING' && (
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleConfirmAction(action)}
                          disabled={actionBusyId === action.id}
                          className="inline-flex h-7 items-center gap-1.5 rounded border border-emerald-300/30 bg-emerald-400/15 px-2 text-[11px] font-semibold text-emerald-100 hover:bg-emerald-400/25 disabled:opacity-50"
                          data-testid="pipeline-assistant-confirm-action"
                          data-action-id={action.id}
                        >
                          {actionBusyId === action.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          确认执行
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRejectAction(action)}
                          disabled={actionBusyId === action.id}
                          className="inline-flex h-7 items-center gap-1.5 rounded border border-white/10 bg-white/5 px-2 text-[11px] text-zinc-300 hover:bg-white/10 disabled:opacity-50"
                          data-testid="pipeline-assistant-reject-action"
                          data-action-id={action.id}
                        >
                          <X className="h-3.5 w-3.5" />
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => setInputText(`请基于这条建议继续修改：\n${action.previewText}`)}
                          className="inline-flex h-7 items-center gap-1.5 rounded border border-cyan-300/20 bg-cyan-400/10 px-2 text-[11px] text-cyan-100 hover:bg-cyan-400/15"
                          data-testid="pipeline-assistant-revise-action"
                          data-action-id={action.id}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          继续修改
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
          {errorText && (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-100" data-testid="pipeline-assistant-error">{errorText}</div>
          )}
          {loading && (
            <div className="flex items-center space-x-2 text-[10px] text-gray-500 animate-pulse font-mono tracking-widest pl-1">
              <span>●</span><span>AI 正在思考中...</span>
            </div>
          )}
          {uploading && (
            <div className="flex items-center space-x-2 text-[10px] text-gray-500 animate-pulse font-mono tracking-widest pl-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /><span>正在解析附件...</span>
            </div>
          )}
          <div ref={scrollRef} />
        </div>

        {/* Input layout footer */}
        <div className="p-4 border-t border-[rgba(255,255,255,0.08)] bg-[#0a0a0a] shrink-0">
          <div className="bg-[#101010]/60 backdrop-blur-md rounded-2xl p-2 border border-white/5 flex flex-col shadow-[0_0_20px_rgba(0,0,0,0.8)] focus-within:border-white/20 transition-colors">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              className="w-full bg-transparent border-none text-white text-xs focus:outline-none resize-none h-16 p-2 placeholder-white/20 font-sans leading-relaxed"
              placeholder={stage ? inputPlaceholderByStage[stage] : `和 ${headerDef.title} 聊问题、要建议，或明确说“创建/写入/生成”...`}
              data-testid="pipeline-assistant-input"
            />
            <div className="flex justify-between items-center px-2 pb-1 mt-1">
              <div className="flex space-x-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept=".txt,.md,.csv,.json,.docx,.pdf,.xlsx,image/*,video/*,audio/*"
                  onChange={(event) => void handleUploadAttachment(event.target.files?.[0])}
                  data-testid="pipeline-assistant-file-input"
                />
                <button
                  type="button"
                  disabled={uploading || loading}
                  onClick={() => fileInputRef.current?.click()}
                  className="text-white/40 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/5 cursor-pointer disabled:opacity-40"
                  title="上传附件并解析为待确认操作"
                  data-testid="pipeline-assistant-upload"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                </button>
              </div>
              <button
                onClick={handleSend}
                disabled={!inputText.trim() || loading}
                className="w-8 h-8 bg-white text-black rounded-full flex items-center justify-center font-bold hover:scale-105 transition-transform shadow-lg cursor-pointer disabled:opacity-40 disabled:hover:scale-100"
                data-testid="pipeline-assistant-send"
              >
                ↑
              </button>
            </div>
          </div>
          <div className="text-[9px] text-center mt-3 text-gray-600 font-mono tracking-widest">
            {selectedTextModelLabel} · {stage ? `${stage} 专属技能已加载，写入前需确认` : '阶段专属智能体已联动当前工作区'}
          </div>
          <button
            type="button"
            onClick={openModelCenter}
            className="mx-auto mt-2 block text-[10px] text-cyan-300/70 hover:text-cyan-200"
            data-testid="pipeline-assistant-model-center-link"
          >
            前往模型中心
          </button>
        </div>

      </div>
    </div>
  );
}
