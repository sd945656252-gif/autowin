import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './AuthContext';
import { get, set } from 'idb-keyval';
import { fetchTextGeneratorModels, savePromptHistoryItem, saveSavedPrompt, deleteSavedPrompt } from '../lib/db';
import { startCustomAiTask, buildPromptMatrixTaskPrompt, buildImagePromptTaskPrompt, buildReversePromptTaskPrompt, buildMusicPromptTaskPrompt, buildImageEditTaskPrompt, fetchWorkflowTaskStatus, transcribeAndPolishAudio, Attachment, GenerationError } from '../services/geminiService';
import { CustomApiConfig } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Copy, RefreshCw, Wand2, ArrowRight, Activity, ChevronDown, Paperclip, X, Image as ImageIcon, FileText, Search, Palette, Fingerprint, Layers, Check, Settings, Save, Music, Maximize2, Minimize2, Bookmark, Plus, Trash2, Undo, Redo, Mic, Loader2, Shield } from 'lucide-react';
import getCaretCoordinates from 'textarea-caret';
import { FEATURE_MODE_LABELS, PROMPT_OPTIMIZATION_TASK_POLL_MS, UNAVAILABLE_GEMINI_MODELS, getTextModelDisplayName, promptOptimizationTaskStorageKey, userMessageForGenerationError } from './prompt-matrix/promptMatrixHelpers';
import type { FeatureMode, HistoryItem, ImagePromptGear, Mode, ModelType, PromptMatrixProps, PromptOptimizationTaskSession, StyleOption, UndoState } from './prompt-matrix/promptMatrixTypes';

// Use imported types from ../types.ts

const TECHNICAL_TECHNIQUES: StyleOption[] = [
  { id: '3d', label: '3D', preview: 'https://images.unsplash.com/photo-1634017839464-5c339ebe3cb4?q=80&w=400&h=400&auto=format&fit=crop' },
  { id: '2d', label: '2D', preview: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab?q=80&w=400&h=400&auto=format&fit=crop' },
  { id: 'toon_shading', label: '三渲二', preview: 'https://images.unsplash.com/photo-1560972550-aba3456b5564?q=80&w=400&h=400&auto=format&fit=crop' },
  { id: 'stop_motion', label: '定格', preview: 'https://images.unsplash.com/photo-1614724723154-43d9359f9a7b?q=80&w=400&h=400&auto=format&fit=crop' },
  { id: 'live_action', label: '真人', preview: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=400&h=400&auto=format&fit=crop' },
  { id: 'hand_drawn', label: '手绘', preview: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?q=80&w=400&h=400&auto=format&fit=crop' },
  { id: 'pixel', label: '像素', preview: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=400&h=400&auto=format&fit=crop' },
];

const ART_STYLES: StyleOption[] = [
  { id: 'realistic', label: '写实', preview: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'abstract', label: '抽象', preview: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'cartoon', label: '卡通', preview: 'https://images.unsplash.com/photo-1533518463841-d62e1fc91373?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'chinese', label: '国风', preview: 'https://images.unsplash.com/photo-1528691565942-ad039b56f8f1?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'cyberpunk', label: '赛博朋克', preview: 'https://images.unsplash.com/photo-1605810230434-7631ac76ec81?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'fantasy', label: '奇幻', preview: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'retro', label: '复古', preview: 'https://images.unsplash.com/photo-1526289037004-2124d6738980?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'lineart', label: '线稿', preview: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'shinkai', label: '新海诚', preview: 'https://images.unsplash.com/photo-1578632292335-df3abbb0d586?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'game_illus', label: '游戏插画', preview: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'game_cg', label: '游戏CG', preview: 'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'minimalist', label: '极简', preview: 'https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'celluloid', label: '赛璐璐', preview: 'https://images.unsplash.com/photo-1580477667995-2b94f01c9516?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'thick_paint', label: '厚涂', preview: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'anime', label: '二次元', preview: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'dark', label: '暗黑', preview: 'https://images.unsplash.com/photo-1510133769062-7de7943695d7?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'clay', label: '粘土', preview: 'https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'fresh', label: '清新', preview: 'https://images.unsplash.com/photo-1464375117522-1311d6a5b81f?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'graffiti', label: '涂鸦', preview: 'https://images.unsplash.com/photo-1543852786-1cf6624b9987?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'guochao', label: '国潮', preview: 'https://images.unsplash.com/photo-1618336753974-aae8e04506aa?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'ink_wash', label: '水墨', preview: 'https://images.unsplash.com/photo-1579762715118-a6f1d4b934f1?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'oil', label: '油画', preview: 'https://images.unsplash.com/photo-1578301978693-85fa9c0320b9?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'marker', label: '马克笔', preview: 'https://images.unsplash.com/photo-1606132226766-48ec1514356a?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'children', label: '儿童插画', preview: 'https://images.unsplash.com/photo-1515516089376-88db1e26e9c0?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'cyber_xianxia', label: '赛博仙侠', preview: 'https://images.unsplash.com/photo-1635322966219-b75ed372eb51?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'dark_gothic', label: '暗黑哥特', preview: 'https://images.unsplash.com/photo-1509248961158-e54f6934749c?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'retro_futurism', label: '复古未来主义', preview: 'https://images.unsplash.com/photo-1614850523296-d8c1af93d400?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
  { id: 'steampunk', label: '蒸汽朋克', preview: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?q=80&w=400&h=400&auto=format&fit=crop', category: '风格' },
];

const PROMPT_OPTIMIZATION_METADATA_STAGE = 'PROMPT_OPTIMIZATION';

export default function App({ currentUserRole, currentProjectId, promptOptimizationProfiles, embeddedInConfig = false }: PromptMatrixProps = {}) {
  const {
    user,
    globalApiConfigs: customApis,
    saveGlobalApiConfigs: persistApiConfigs,
    setHistory,
    savedPrompts,
    setSavedPrompts,
    isSavedPromptsLoaded,
    activeCustomApiId,
    setActiveCustomApiId,
    selectedModel,
    setSelectedModel,
    saveSettings: persistSettingsGlobally
  } = useAuth();
  const {
    data: textGeneratorModels = [],
    isLoading: isTextModelsLoading,
    error: textModelsError
  } = useQuery({
    queryKey: ['model-configs', 'TEXT_GENERATOR', user?.uid || 'guest'],
    queryFn: fetchTextGeneratorModels,
    enabled: Boolean(user),
    staleTime: 30_000
  });
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mode, setMode] = useState<Mode>('auto');
  const [featureMode, setFeatureMode] = useState<FeatureMode>('prompt');
  const [imagePromptGear, setImagePromptGear] = useState<ImagePromptGear>('regular');
  const [selectedTechniques, setSelectedTechniques] = useState<string[]>([]);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [promptCount, setPromptCount] = useState<number>(1);
  const [isSavedPromptsOpen, setIsSavedPromptsOpen] = useState(false);
  const [newPromptTitle, setNewPromptTitle] = useState('');
  const [isAddingPrompt, setIsAddingPrompt] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [isPasting, setIsPasting] = useState(false);

  const textModelOptions = textGeneratorModels.filter(api => api.type === 'text' && api.capability === 'TEXT_GENERATOR' && api.isEnabled !== false);
  const storedSelectedTextModel = textModelOptions.find(api => api.id === activeCustomApiId) || null;
  const selectedTextModel = storedSelectedTextModel || textModelOptions[0] || null;
  const isUnavailableHistoricalModel = !selectedTextModel && (UNAVAILABLE_GEMINI_MODELS.has(selectedModel) || (activeCustomApiId !== 'default' && textModelOptions.length > 0));
  const selectedTextModelLabel = selectedTextModel ? getTextModelDisplayName(selectedTextModel) : '';
  const customApi = selectedTextModel || { baseUrl: '', modelName: '', alias: 'Default', displayName: 'Default', id: 'default', type: 'text' as any, capability: 'TEXT_GENERATOR' as any };
  const profileSystemPrompt = (key: keyof NonNullable<PromptMatrixProps['promptOptimizationProfiles']>) => {
    const value = promptOptimizationProfiles?.[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
  };

  useEffect(() => {
    if (!user || isTextModelsLoading || textModelOptions.length === 0) return;
    const hasLegacyModelSelection = UNAVAILABLE_GEMINI_MODELS.has(selectedModel);
    const hasMissingActiveModel = activeCustomApiId === 'default' || !storedSelectedTextModel;
    if (!hasLegacyModelSelection && !hasMissingActiveModel) return;

    const firstAvailableModel = textModelOptions[0];
    if (!firstAvailableModel?.id) return;
    setActiveCustomApiId(firstAvailableModel.id);
    setSelectedModel('custom');
    persistSettingsGlobally(firstAvailableModel.id, 'custom').catch((error) => {
      console.warn('[PromptMatrix] Failed to migrate text model selection:', error);
    });
  }, [activeCustomApiId, isTextModelsLoading, persistSettingsGlobally, selectedModel, setActiveCustomApiId, setSelectedModel, storedSelectedTextModel, textModelOptions, user]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [duration, setDuration] = useState('');
  const [wordCount, setWordCount] = useState<'300' | '500' | '800'>(() => {
    const saved = localStorage.getItem('prompt_word_count');
    return (saved as '300' | '500' | '800') || '500';
  });
  const [output, setOutput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [pendingAssistantGenerate, setPendingAssistantGenerate] = useState<{ actionId: string; requestedAt: number } | null>(null);
  const [promptOptimizationTaskSession, setPromptOptimizationTaskSession] = useState<PromptOptimizationTaskSession | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const watchdogTimerRef = useRef<NodeJS.Timeout | null>(null);
  const activePromptOptimizationTaskRef = useRef<string | null>(null);

  // Audio Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);

  // Undo/Redo logic
  const [undoStack, setUndoStack] = useState<UndoState[]>([]);
  const [redoStack, setRedoStack] = useState<UndoState[]>([]);
  const isUndoRedoAction = useRef(false);

  // Proactively request microphone permission on page/component load
  useEffect(() => {
    if (navigator?.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          // Immediately stop tracks to free the microphone, we just wanted the permission check/prompt
          stream.getTracks().forEach(track => track.stop());
          console.log("[PromptMatrix] Microphone permission pre-authorized on mount.");
        })
        .catch(err => {
          console.warn("[PromptMatrix] Proactive microphone permission request response:", err);
        });
    }
  }, []);

  const currentUndoState: UndoState = {
    input, attachments, mode, featureMode, imagePromptGear,
    selectedModel, selectedTechniques, selectedStyles, promptCount, duration, wordCount
  };

  const lastStateRef = useRef<UndoState>(currentUndoState);
  const currentStateRef = useRef<UndoState>(currentUndoState);
  currentStateRef.current = currentUndoState;
  const undoTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const commitUndoStep = () => {
     if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = null;
     }

     const prev = lastStateRef.current;
     const now = currentStateRef.current;

     if (JSON.stringify(prev) !== JSON.stringify(now)) {
        setUndoStack(s => s.length >= 15 ? [...s.slice(s.length - 14), prev] : [...s, prev]);
        setRedoStack([]);
        lastStateRef.current = now;
     }
  };

  const handleInputCursorMove = () => {
    if (undoTimeoutRef.current) {
      commitUndoStep();
    }
  };

  useEffect(() => {
    if (isUndoRedoAction.current) {
      lastStateRef.current = currentUndoState;
      isUndoRedoAction.current = false;
      return;
    }

    const prev = lastStateRef.current;
    const now = currentUndoState;

    const getDiff = (a: any, b: any) => JSON.stringify(a) !== JSON.stringify(b);

    const inputChanged = prev.input !== now.input;
    const otherChanged = getDiff(prev.attachments, now.attachments) ||
                         getDiff(prev.selectedTechniques, now.selectedTechniques) ||
                         getDiff(prev.selectedStyles, now.selectedStyles) ||
                         prev.mode !== now.mode ||
                         prev.featureMode !== now.featureMode ||
                         prev.imagePromptGear !== now.imagePromptGear ||
                         prev.selectedModel !== now.selectedModel ||
                         prev.promptCount !== now.promptCount ||
                         prev.duration !== now.duration ||
                         prev.wordCount !== now.wordCount;

    if (!inputChanged && !otherChanged) return;

    if (otherChanged) {
      commitUndoStep();
    } else if (inputChanged) {
      if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
      }
      undoTimeoutRef.current = setTimeout(() => {
         commitUndoStep();
      }, 1000);
    }
  }, [input, attachments, mode, featureMode, imagePromptGear, selectedModel, selectedTechniques, selectedStyles, promptCount, duration, wordCount]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      recordingStartTimeRef.current = Date.now();

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      const insertTranscribedText = (text: string) => {
        const textarea = textareaRef.current || document.getElementById('prompt-input') as HTMLTextAreaElement;
        if (textarea) {
           const startPos = textarea.selectionStart || 0;
           const endPos = textarea.selectionEnd || 0;
           setInput(prevInput => {
             const newText = prevInput.substring(0, startPos) + text + prevInput.substring(endPos);
             return newText;
           });

           setTimeout(() => {
              textarea.focus();
              textarea.setSelectionRange(startPos + text.length, startPos + text.length);
              handleInputCursorMove();
           }, 0);
        } else {
           setInput(prev => prev ? prev + ' ' + text : text);
           handleInputCursorMove();
        }
      };

      mediaRecorder.onstop = async () => {
        setIsTranscribing(true);
        const recordingDuration = Date.now() - recordingStartTimeRef.current;

        try {
          const mimeType = mediaRecorder.mimeType || 'audio/webm';
          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

          // Check if audio file size or duration is extremely small/short
          if (audioBlob.size < 200 || recordingDuration < 500) {
             insertTranscribedText("无语音输入，请重新输入语音。");
             setIsTranscribing(false);
             stream.getTracks().forEach(track => track.stop());
             return;
          }

          const reader = new FileReader();
          reader.readAsDataURL(audioBlob);
          reader.onloadend = async () => {
            try {
              const base64data = reader.result?.toString().split(',')[1];
              if (!base64data) {
                insertTranscribedText("无语音输入，请重新输入语音。");
                setIsTranscribing(false);
                return;
              }

              const text = await transcribeAndPolishAudio(base64data, selectedModel, customApi, mimeType);
              const trimmedText = text ? text.trim() : "";

              if (!trimmedText || trimmedText === "" || trimmedText.includes("无语音输入")) {
                insertTranscribedText("无语音输入，请重新输入语音。");
              } else {
                insertTranscribedText(trimmedText);
              }
            } catch (innerErr: any) {
              console.error("[onstop loader error]", innerErr);
              insertTranscribedText("无语音输入，请重新输入语音。");
            } finally {
              setIsTranscribing(false);
            }
          };

          reader.onerror = () => {
            insertTranscribedText("无语音输入，请重新输入语音。");
            setIsTranscribing(false);
          };
        } catch (err: any) {
          console.error(err);
          insertTranscribedText("无语音输入，请重新输入语音。");
          setIsTranscribing(false);
        }

        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Microphone access denied:', err);
      setError('无法访问麦克风，请检查权限。');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const toggleRecording = () => {
    if (isTranscribing) return;
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const handleUndo = () => {
    const currentS = currentStateRef.current;

    if (undoTimeoutRef.current) {
        clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = null;

        const prevS = lastStateRef.current;
        isUndoRedoAction.current = true;
        setRedoStack(s => [currentS, ...s]);

        setInput(prevS.input);
        setAttachments(prevS.attachments);
        setMode(prevS.mode);
        setFeatureMode(prevS.featureMode);
        setImagePromptGear(prevS.imagePromptGear);
        setSelectedModel(prevS.selectedModel);
        setSelectedTechniques(prevS.selectedTechniques);
        setSelectedStyles(prevS.selectedStyles);
        setPromptCount(prevS.promptCount);
        setDuration(prevS.duration);
        setWordCount(prevS.wordCount as '300'|'500'|'800');
        lastStateRef.current = prevS;
        return;
    }

    if (undoStack.length === 0) return;
    const previousState = undoStack[undoStack.length - 1];

    isUndoRedoAction.current = true;
    setUndoStack(s => s.slice(0, -1));
    setRedoStack(s => [currentS, ...s]);

    setInput(previousState.input);
    setAttachments(previousState.attachments);
    setMode(previousState.mode);
    setFeatureMode(previousState.featureMode);
    setImagePromptGear(previousState.imagePromptGear);
    setSelectedModel(previousState.selectedModel);
    setSelectedTechniques(previousState.selectedTechniques);
    setSelectedStyles(previousState.selectedStyles);
    setPromptCount(previousState.promptCount);
    setDuration(previousState.duration);
    setWordCount(previousState.wordCount as '300'|'500'|'800');
    lastStateRef.current = previousState;
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const nextState = redoStack[0];
    const currentS = currentStateRef.current;

    if (undoTimeoutRef.current) {
       clearTimeout(undoTimeoutRef.current);
       undoTimeoutRef.current = null;
    }

    isUndoRedoAction.current = true;
    setRedoStack(s => s.slice(1));
    setUndoStack(s => s.length >= 15 ? [...s.slice(s.length - 14), currentS] : [...s, currentS]);

    setInput(nextState.input);
    setAttachments(nextState.attachments);
    setMode(nextState.mode);
    setFeatureMode(nextState.featureMode);
    setImagePromptGear(nextState.imagePromptGear);
    setSelectedModel(nextState.selectedModel);
    setSelectedTechniques(nextState.selectedTechniques);
    setSelectedStyles(nextState.selectedStyles);
    setPromptCount(nextState.promptCount);
    setDuration(nextState.duration);
    setWordCount(nextState.wordCount as '300'|'500'|'800');
    lastStateRef.current = nextState;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else {
          e.preventDefault();
          handleRedo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleRecording();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    setIsGenerating(false);
    setStatusText('');
    setPromptOptimizationTaskSession(null);
    activePromptOptimizationTaskRef.current = null;
    if (user) {
      window.localStorage.removeItem(promptOptimizationTaskStorageKey(user.uid, currentProjectId));
    }
  };

  const saveGeneratedHistory = async (params: {
    finalResult: string;
    modelToUse: ModelType;
    apiToUse: CustomApiConfig;
    source?: string;
    inputValue?: string;
    attachmentsValue?: Attachment[];
    featureModeValue?: FeatureMode;
    modeValue?: Mode;
    wordCountValue?: string;
    durationValue?: string;
    imagePromptGearValue?: ImagePromptGear | null;
    selectedTechniquesValue?: string[] | null;
    selectedStylesValue?: string[] | null;
    promptCountValue?: number | null;
  }) => {
    const newHistoryItem: any = {
      id: '',
      timestamp: new Date(),
      featureMode: params.featureModeValue || featureMode,
      input: params.inputValue ?? input,
      output: params.finalResult,
      attachments: (params.attachmentsValue ?? attachments).map(a => ({ name: a.name, mimeType: a.mimeType, data: a.data || '' })),
      model: params.modelToUse,
      customModelId: params.apiToUse.id,
      customModelAlias: params.apiToUse.alias,
      mode: (params.featureModeValue || featureMode) === 'prompt' ? (params.modeValue ?? mode) : null,
      wordCount: (params.featureModeValue || featureMode) === 'prompt' ? (params.wordCountValue ?? wordCount) : null,
      duration: (params.durationValue ?? duration) || null,
      imagePromptGear: (params.featureModeValue || featureMode) === 'image_prompt' ? (params.imagePromptGearValue ?? imagePromptGear) : null,
      techniques: (params.featureModeValue || featureMode) === 'image_prompt' ? (params.selectedTechniquesValue ?? selectedTechniques) : null,
      styles: (params.featureModeValue || featureMode) === 'image_prompt' ? (params.selectedStylesValue ?? selectedStyles) : null,
      promptCount: (params.featureModeValue || featureMode) === 'image_prompt' ? (params.promptCountValue ?? promptCount) : null,
      projectId: currentProjectId || undefined,
      source: params.source || 'prompt_optimization'
    };

    if (user) {
      try {
        const savedItem = await savePromptHistoryItem(newHistoryItem, user.uid);
        if (newHistoryItem.attachments.length > 0 && newHistoryItem.attachments.some((item: any) => item.data)) {
          await set(`history_attachments_${savedItem.id}`, newHistoryItem.attachments);
        }
        setHistory(prev => [savedItem as HistoryItem, ...prev]);
      } catch (err) {
        console.error('Background history sync failed:', err);
      }
      return;
    }

    newHistoryItem.id = Date.now().toString();
    const guestItem = { ...newHistoryItem, timestamp: new Date(), id: newHistoryItem.id };
    setHistory(prev => [guestItem as HistoryItem, ...prev]);
    get('app_history_v2').then((current) => {
      const updated = [guestItem, ...(Array.isArray(current) ? current : [])];
      set('app_history_v2', updated);
    }).catch(err => console.error('Failed to persist guest history', err));
  };

  const startModeTask = async (modeValue: FeatureMode, inputValue: string, attachmentsValue: Attachment[], promptCountValue: number) => {
    const apiToUse = selectedTextModel;
    if (!apiToUse?.id) throw new Error('当前没有可用的文字生成模型。');
    if (modeValue === 'prompt') {
      const wordCountConstraint = wordCount === '300' ? '250~400' : wordCount === '500' ? '500~600' : '800~950';
      const promptBundle = buildPromptMatrixTaskPrompt({
        userInput: inputValue,
        mode,
        duration,
        attachments: attachmentsValue,
        wordCountConstraint,
        isRealtimeSpeed: true,
        systemPrompt: profileSystemPrompt('video_prompt')
      });
      return startCustomAiTask({
        customConfig: apiToUse,
        systemPrompt: promptBundle.systemPrompt,
        userPrompt: promptBundle.userPrompt,
        attachments: attachmentsValue,
        isRealtimeSpeed: true,
        metadata: { projectId: currentProjectId || null, stage: PROMPT_OPTIMIZATION_METADATA_STAGE, featureMode: 'prompt', wordCount, duration: duration || null }
      });
    }
    if (modeValue === 'image_prompt') {
      const techLabels = TECHNICAL_TECHNIQUES.filter(t => selectedTechniques.includes(t.id)).map(t => t.label);
      const styleLabels = ART_STYLES.filter(s => selectedStyles.includes(s.id)).map(s => s.label);
      const combinedStyle = [...techLabels, ...styleLabels].join(', ') || 'auto';
      const engineModePrefix = imagePromptGear === 'extreme' ? '[MANDATORY DYNAMIC ENGINE] ' : '';
      const promptBundle = buildImagePromptTaskPrompt({ userInput: inputValue, attachments: attachmentsValue, style: engineModePrefix + combinedStyle, systemPrompt: profileSystemPrompt('image_prompt') });
      return startCustomAiTask({
        customConfig: apiToUse,
        systemPrompt: promptBundle.systemPrompt,
        userPrompt: promptBundle.userPrompt,
        attachments: attachmentsValue,
        metadata: { projectId: currentProjectId || null, stage: PROMPT_OPTIMIZATION_METADATA_STAGE, featureMode: 'image_prompt', promptCount: promptCountValue }
      });
    }
    if (modeValue === 'reverse') {
      const promptBundle = buildReversePromptTaskPrompt({ userInput: inputValue, attachments: attachmentsValue, systemPrompt: profileSystemPrompt('reverse_prompt') });
      return startCustomAiTask({
        customConfig: apiToUse,
        systemPrompt: promptBundle.systemPrompt,
        userPrompt: promptBundle.userPrompt,
        attachments: attachmentsValue,
        metadata: { projectId: currentProjectId || null, stage: PROMPT_OPTIMIZATION_METADATA_STAGE, featureMode: 'reverse' }
      });
    }
    if (modeValue === 'music_prompt') {
      const promptBundle = buildMusicPromptTaskPrompt({ userInput: inputValue, attachments: attachmentsValue, systemPrompt: profileSystemPrompt('music_prompt') });
      return startCustomAiTask({
        customConfig: apiToUse,
        systemPrompt: promptBundle.systemPrompt,
        userPrompt: promptBundle.userPrompt,
        attachments: attachmentsValue,
        metadata: { projectId: currentProjectId || null, stage: PROMPT_OPTIMIZATION_METADATA_STAGE, featureMode: 'music_prompt' }
      });
    }
    const promptBundle = buildImageEditTaskPrompt({ userInput: inputValue, attachments: attachmentsValue, systemPrompt: profileSystemPrompt('image_edit_prompt') });
    return startCustomAiTask({
      customConfig: apiToUse,
      systemPrompt: promptBundle.systemPrompt,
      userPrompt: promptBundle.userPrompt,
      attachments: attachmentsValue,
      metadata: { projectId: currentProjectId || null, stage: PROMPT_OPTIMIZATION_METADATA_STAGE, featureMode: 'edit' }
    });
  };

  const pollPromptOptimizationTask = async (taskId: string, signal: AbortSignal) => {
    activePromptOptimizationTaskRef.current = taskId;
    while (!signal.aborted) {
      const task = await fetchWorkflowTaskStatus(taskId);
      const nextProgress = Math.max(0, Math.min(100, Number(task.progress || 0)));
      const nextStatus = task.status || `后台生成中 ${nextProgress}%`;
      setStatusText(nextStatus);
      setPromptOptimizationTaskSession((current) => (
        current?.taskId === taskId
          ? { ...current, status: nextStatus, progress: nextProgress }
          : current
      ));
      if (task.output_text) setOutput(task.output_text);
      if (task.completed) {
        activePromptOptimizationTaskRef.current = null;
        if (task.error) throw new GenerationError('UPSTREAM_HTTP_ERROR', task.error);
        const finalText = (task.output_text || '').trim();
        if (!finalText) throw new GenerationError('UPSTREAM_EMPTY_RESPONSE', '后台任务完成，但没有返回可用文本。');
        return finalText;
      }
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, PROMPT_OPTIMIZATION_TASK_POLL_MS);
        signal.addEventListener('abort', () => {
          window.clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
    throw new DOMException('Polling aborted', 'AbortError');
  };

  useEffect(() => {
    if (!user || !selectedTextModel || activePromptOptimizationTaskRef.current) return;
    const storageKey = promptOptimizationTaskStorageKey(user.uid, currentProjectId);
    const rawTask = window.localStorage.getItem(storageKey);
    if (!rawTask) return;

    let savedTask: any = null;
    try {
      savedTask = JSON.parse(rawTask);
    } catch {
      window.localStorage.removeItem(storageKey);
      return;
    }
    if (!savedTask?.taskId) {
      window.localStorage.removeItem(storageKey);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const apiForHistory = textModelOptions.find((item) => item.id === savedTask.customModelId) || selectedTextModel;
    setIsGenerating(true);
    setError(null);
    const restoredFeatureMode = (savedTask.featureMode || 'prompt') as FeatureMode;
    setStatusText('正在接续上次未完成的提示词优化后台任务...');
    setPromptOptimizationTaskSession({
      taskId: savedTask.taskId,
      featureMode: restoredFeatureMode,
      status: '正在接续上次未完成的提示词优化后台任务...',
      progress: 0,
      isResumed: true
    });
    if (savedTask.input) setInput(savedTask.input);
    if (savedTask.mode) setMode(savedTask.mode);
    if (savedTask.duration !== undefined) setDuration(savedTask.duration || '');
    if (savedTask.wordCount) setWordCount(savedTask.wordCount);
    if (savedTask.imagePromptGear) setImagePromptGear(savedTask.imagePromptGear);
    if (Array.isArray(savedTask.selectedTechniques)) setSelectedTechniques(savedTask.selectedTechniques);
    if (Array.isArray(savedTask.selectedStyles)) setSelectedStyles(savedTask.selectedStyles);
    if (savedTask.promptCount) setPromptCount(savedTask.promptCount);
    setFeatureMode(restoredFeatureMode);

    pollPromptOptimizationTask(savedTask.taskId, controller.signal)
      .then(async (finalResult) => {
        window.localStorage.removeItem(storageKey);
        setOutput(finalResult);
        setStatusText('');
        setPromptOptimizationTaskSession(null);
        setIsGenerating(false);
        await saveGeneratedHistory({
          finalResult,
          modelToUse: savedTask.modelToUse || 'custom',
          apiToUse: apiForHistory,
          source: 'prompt_optimization_background_task_resume',
          inputValue: savedTask.input || '',
          attachmentsValue: [],
          featureModeValue: restoredFeatureMode,
          modeValue: savedTask.mode || 'auto',
          wordCountValue: savedTask.wordCount || '500',
          durationValue: savedTask.duration || '',
          imagePromptGearValue: savedTask.imagePromptGear || null,
          selectedTechniquesValue: Array.isArray(savedTask.selectedTechniques) ? savedTask.selectedTechniques : null,
          selectedStylesValue: Array.isArray(savedTask.selectedStyles) ? savedTask.selectedStyles : null,
          promptCountValue: savedTask.promptCount || null
        });
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        window.localStorage.removeItem(storageKey);
        const userFriendlyMsg = userMessageForGenerationError(err);
        setOutput(`[系统状态] ${userFriendlyMsg}\n\n详细诊断:\n${err?.message || String(err)}`);
        setError(userFriendlyMsg);
        setIsGenerating(false);
        setStatusText('');
        setPromptOptimizationTaskSession(null);
      });

    return () => {
      controller.abort();
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
    };
  }, [user?.uid, currentProjectId, selectedTextModel?.id]);

  // Save settings through the local persistence layer.
  const persistSettings = async (apis: CustomApiConfig[], activeId: string, model: any) => {
    persistApiConfigs(apis);
    persistSettingsGlobally(activeId, model);
  };

  const handleActiveApiChange = (id: string) => {
    setActiveCustomApiId(id);
    persistSettings(customApis || [], id, selectedModel);
  };

  const handleModelChange = (model: ModelType) => {
    setSelectedModel(model);
    persistSettings(customApis || [], activeCustomApiId, model);
  };

  const handleWordCountChange = (count: '300' | '500' | '800') => {
    setWordCount(count);
    localStorage.setItem('prompt_word_count', count);
  };
  // Persist history is now done item-by-item on creation

  // --- Draft Persistence Logic ---
  const [isDraftLoaded, setIsDraftLoaded] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const draftStorageKey = useMemo(() => {
    const owner = user?.uid || 'guest';
    const project = currentProjectId || 'no-project';
    return `app_draft_v3_${owner}_${project}`;
  }, [currentProjectId, user?.uid]);

  // Recovery on Mount
  useEffect(() => {
    setIsDraftLoaded(false);
    get(draftStorageKey).then((draft) => {
      if (draft) {
        if (draft.input !== undefined) setInput(draft.input);
        if (draft.attachments !== undefined) setAttachments(draft.attachments);
        if (draft.featureMode !== undefined) setFeatureMode(draft.featureMode);
        if (draft.mode !== undefined) setMode(draft.mode);
        if (draft.selectedModel !== undefined) setSelectedModel(draft.selectedModel);
        if (draft.selectedTechniques !== undefined) setSelectedTechniques(draft.selectedTechniques);
        if (draft.selectedStyles !== undefined) setSelectedStyles(draft.selectedStyles);
        if (draft.promptCount !== undefined) setPromptCount(draft.promptCount);
        if (draft.duration !== undefined) setDuration(draft.duration);
        if (draft.output !== undefined) setOutput(draft.output);
        if (draft.lastSaved) setLastSaved(new Date(draft.lastSaved));
      }
      setIsDraftLoaded(true);
    }).catch(err => {
      console.error('Failed to load draft', err);
      setIsDraftLoaded(true);
    });
  }, [draftStorageKey]);

  const draftStateRef = useRef({
    input, attachments, featureMode, mode, selectedModel, selectedTechniques,
    selectedStyles, promptCount, duration, output
  });

  const persistDraftNow = async (overrides: Partial<typeof draftStateRef.current> = {}) => {
    const savedAt = new Date();
    const draft = {
      ...draftStateRef.current,
      ...overrides,
      lastSaved: savedAt
    };
    try {
      await set(draftStorageKey, draft);
      setLastSaved(savedAt);
    } catch (err) {
      console.error('Prompt draft save failed', err);
    }
  };

  useEffect(() => {
    draftStateRef.current = {
      input, attachments, featureMode, mode, selectedModel, selectedTechniques,
      selectedStyles, promptCount, duration, output
    };
  }, [input, attachments, featureMode, mode, selectedModel, selectedTechniques, selectedStyles, promptCount, duration, output]);

  // Auto-Save Interval (Every 10s)
  useEffect(() => {
    if (!isDraftLoaded) return;

    const interval = setInterval(() => {
      void persistDraftNow();
    }, 10000);

    return () => clearInterval(interval);
  }, [isDraftLoaded]);

  useEffect(() => {
    const onAssistantConfirmed = (event: Event) => {
      if (embeddedInConfig) return;
      const detail = (event as CustomEvent).detail || {};
      if (detail.stage !== 'DIRECTOR_02') return;
      const patch = detail.action?.executionResult?.patch || {};
      const nextFeatureMode = typeof patch.featureMode === 'string' && ['prompt', 'reverse', 'edit', 'image_prompt', 'music_prompt'].includes(patch.featureMode)
        ? patch.featureMode as FeatureMode
        : draftStateRef.current.featureMode;
      const nextDraft = {
        ...draftStateRef.current,
        input: typeof patch.input === 'string' ? patch.input : draftStateRef.current.input,
        output: typeof patch.output === 'string' ? patch.output : draftStateRef.current.output,
        featureMode: nextFeatureMode
      };

      if (typeof patch.input === 'string') setInput(patch.input);
      if (typeof patch.output === 'string') setOutput(patch.output);
      if (nextFeatureMode !== draftStateRef.current.featureMode) {
        setFeatureMode(nextFeatureMode);
      }
      void persistDraftNow(nextDraft);

      if (typeof patch.output === 'string' && patch.output.trim()) {
        const promptAttachments = nextDraft.attachments.map(a => ({ name: a.name, mimeType: a.mimeType, data: a.data }));
        const historyItem: any = {
          id: '',
          timestamp: new Date(),
          featureMode: nextFeatureMode,
          input: nextDraft.input,
          output: patch.output,
          attachments: promptAttachments,
          model: selectedModel,
          customModelId: customApi.id,
          customModelAlias: customApi.alias,
          mode: nextFeatureMode === 'prompt' ? nextDraft.mode : null,
          wordCount: nextFeatureMode === 'prompt' ? wordCount : null,
          duration: nextDraft.duration || null,
          imagePromptGear: nextFeatureMode === 'image_prompt' ? imagePromptGear : null,
          techniques: nextFeatureMode === 'image_prompt' ? nextDraft.selectedTechniques : null,
          styles: nextFeatureMode === 'image_prompt' ? nextDraft.selectedStyles : null,
          promptCount: nextFeatureMode === 'image_prompt' ? nextDraft.promptCount : null,
          source: 'pipeline_assistant',
          sourceActionId: detail.action?.id || null
        };

        if (user) {
          (async () => {
            try {
              const savedItem = await savePromptHistoryItem(historyItem, user.uid);
              if (promptAttachments.length > 0) {
                await set(`history_attachments_${savedItem.id}`, promptAttachments);
              }
              setHistory(prev => [savedItem as HistoryItem, ...prev]);
            } catch (err) {
              console.error('Assistant prompt history sync failed:', err);
            }
          })();
        } else {
          const guestItem = { ...historyItem, id: Date.now().toString(), timestamp: new Date() };
          setHistory(prev => [guestItem as HistoryItem, ...prev]);
          get('app_history_v2').then((current) => {
            const updated = [guestItem, ...(Array.isArray(current) ? current : [])];
            return set('app_history_v2', updated);
          }).catch(err => console.error('Failed to persist assistant guest history', err));
        }
      }

      if (detail.action?.type === 'DIRECTOR_PROMPT_GENERATE' && !patch.output) {
        setPendingAssistantGenerate({
          actionId: detail.action.id,
          requestedAt: Date.now()
        });
      }
      if (typeof detail.action?.executionResult?.message === 'string') {
        setStatusText(detail.action.executionResult.message);
        window.setTimeout(() => setStatusText(''), 2600);
      }
    };
    window.addEventListener('jiying:pipeline-assistant-action-confirmed', onAssistantConfirmed);
    return () => window.removeEventListener('jiying:pipeline-assistant-action-confirmed', onAssistantConfirmed);
  }, [customApi.alias, customApi.id, embeddedInConfig, imagePromptGear, selectedModel, setHistory, user, wordCount]);
  // -------------------------------

  const [isDragging, setIsDragging] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const canViewGeneratedPrompt = currentUserRole === 'ADMIN' || currentUserRole === 'DEVELOPER' || currentUserRole === '管理者' || currentUserRole === '助理';
  const isMemberRole = !canViewGeneratedPrompt;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const expandedInputRef = useRef<HTMLDivElement>(null);
  const mentionPopupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (isInputExpanded && expandedInputRef.current && !expandedInputRef.current.contains(target)) {
        if (mentionPopupRef.current && mentionPopupRef.current.contains(target)) {
          return;
        }
        setIsInputExpanded(false);
      }
    };
    if (isInputExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isInputExpanded]);

  // Mention system state
  const [mentionSearch, setMentionSearch] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionListIndex, setMentionListIndex] = useState(0);
  const [mentionStartIdx, setMentionStartIdx] = useState(-1);
  const [mentionCursorPos, setMentionCursorPos] = useState({ top: 0, left: 0 });

  const filteredMentions = attachments.map((att, idx) => {
    // Generate type-specific index label for the mention list
    const sameTypeAttachments = attachments.slice(0, idx + 1).filter(a => {
      if (att.mimeType.startsWith('image/')) return a.mimeType.startsWith('image/');
      if (att.mimeType.startsWith('video/')) return a.mimeType.startsWith('video/');
      if (att.mimeType.startsWith('audio/')) return a.mimeType.startsWith('audio/');
      return false;
    });

    let typePrefix = 'file';
    if (att.mimeType.startsWith('image/')) typePrefix = 'image';
    else if (att.mimeType.startsWith('video/')) typePrefix = 'video';
    else if (att.mimeType.startsWith('audio/')) typePrefix = 'audio';

    const indexLabel = `@${typePrefix}${sameTypeAttachments.length}`;
    return { ...att, indexLabel };
  }).filter(att =>
    att.indexLabel.toLowerCase().includes(mentionSearch.toLowerCase()) ||
    att.name.toLowerCase().includes(mentionSearch.toLowerCase())
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPosition = e.target.selectionStart;
    setInput(value);

    // Look back for '@' to trigger mention list
    const lastAt = value.lastIndexOf('@', cursorPosition - 1);
    const textBetween = value.substring(lastAt + 1, cursorPosition);

    // Trigger if '@' followed by non-spaces and we are close to it
    if (lastAt !== -1 && !textBetween.includes(' ') && !textBetween.includes('\n')) {
      setShowMentions(true);
      setMentionSearch(textBetween);
      setMentionStartIdx(lastAt);
      setMentionListIndex(0);
      try {
        const target = e.target as HTMLTextAreaElement;
        const caret = getCaretCoordinates(target, lastAt);
        const rect = target.getBoundingClientRect();
        setMentionCursorPos({
          top: rect.top + caret.top - target.scrollTop + 24,
          left: rect.left + caret.left - target.scrollLeft
        });
      } catch (err) {}
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (filename: string) => {
    if (mentionStartIdx === -1) {
      setShowMentions(false);
      return;
    }

    let currentArea = textareaRef.current;
    if (!currentArea) {
      currentArea = document.getElementById('prompt-input') as HTMLTextAreaElement;
    }

    const cursorPosition = currentArea ? currentArea.selectionStart : input.length;
    const beforeAt = input.substring(0, mentionStartIdx);
    const afterCursor = input.substring(cursorPosition);

    const scrollPos = currentArea ? currentArea.scrollTop : 0;

    const newValue = `${beforeAt}@${filename} ${afterCursor}`;
    setInput(newValue);
    setShowMentions(false);

    // Refocus and place cursor after the mention
    setTimeout(() => {
      const activeArea = textareaRef.current || document.getElementById('prompt-input') as HTMLTextAreaElement;
      if (activeArea) {
        activeArea.focus({ preventScroll: true });
        const newPos = beforeAt.length + filename.length + 2;
        activeArea.setSelectionRange(newPos, newPos);
        activeArea.scrollTop = scrollPos;
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showMentions && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionListIndex(prev => (prev + 1) % filteredMentions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionListIndex(prev => (prev - 1 + filteredMentions.length) % filteredMentions.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredMentions[mentionListIndex].name);
      } else if (e.key === 'Escape') {
        setShowMentions(false);
      }
    } else if (e.key === 'Escape' && isInputExpanded) {
      setIsInputExpanded(false);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const processImage = async (file: File, aggressiveCompress: boolean = false): Promise<{ data: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const MAX_DIM = aggressiveCompress ? 1600 : 2048; // Reduced from 5120 for better performance and stability
          let width = img.width;
          let height = img.height;

          if (width > MAX_DIM || height > MAX_DIM) {
            if (width > height) {
              height = Math.round((height * MAX_DIM) / width);
              width = MAX_DIM;
            } else {
              width = Math.round((width * MAX_DIM) / height);
              height = MAX_DIM;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { alpha: true });

          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          // Use high quality smoothing for Lanczos-like results
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          if (aggressiveCompress) {
            const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
            resolve({
              data: dataUrl.split(',')[1],
              mimeType: 'image/jpeg'
            });
          } else {
            // Use WebP with high quality (0.92) for perception-based compression
            const dataUrl = canvas.toDataURL('image/webp', 0.92);
            resolve({
              data: dataUrl.split(',')[1],
              mimeType: 'image/webp'
            });
          }
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const processFiles = async (files: File[]) => {
    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB limit
    const TOTAL_MAX_SIZE = 50 * 1024 * 1024; // 50MB total limit
    const MAX_FILES = 10;
    const newAttachments: Attachment[] = [];

    // Calculate current total size based on actual base64 payloads
    let currentTotalSize = attachments.reduce((sum, att) => sum + (att.data.length * 3) / 4, 0);

    if (attachments.length + files.length > MAX_FILES) {
      setError(`最多允许上传 ${MAX_FILES} 个附件。`);
      return;
    }

    for (const file of files) {
      const isImage = file.type.startsWith('image/');

      if (!isImage && file.size > MAX_FILE_SIZE) {
        setError(`文件 "${file.name}" 大小超过 20MB 限制。目前系统仅支持自动压缩超大图片。`);
        continue;
      }

      try {
        let base64Data: string;
        let mimeType = file.type;

        // --- TXT Parsing ---
        if (file.type === 'text/plain') {
          const textContent = await file.text();
          // Directly inject text content into input for the model to use + add as attachment
          setInput(prev => prev + `\n\n[读取文件: ${file.name}]\n${textContent}`);
          const data = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              resolve(result.split(',')[1]);
            };
            reader.readAsDataURL(file);
          });
          base64Data = data;
        } else if (isImage) {
          const needsAggressive = file.size > MAX_FILE_SIZE;
          const processed = await processImage(file, needsAggressive);
          base64Data = processed.data;
          mimeType = processed.mimeType;
        } else {
          const data = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              resolve(result.split(',')[1]);
            };
            reader.readAsDataURL(file);
          });
          base64Data = data;
        }

        let resultingSize = (base64Data.length * 3) / 4;

        if (resultingSize > MAX_FILE_SIZE) {
           setError(`图片 "${file.name}" 即使经过底层画质无损压缩处理后依然过大 (超过20MB)，这十分罕见，请您进一步手动缩小尺寸后重试。`);
           continue;
        }

        if (currentTotalSize + resultingSize > TOTAL_MAX_SIZE) {
           setError(`处理附件后总计大小将超过 50MB 通信配额限制，已安全跳过后续未处理文件的装载。`);
           break;
        }

        currentTotalSize += resultingSize;

        newAttachments.push({
          name: file.name,
          mimeType: mimeType,
          data: base64Data
        });
      } catch (err: any) {
        console.error('Error processing file:', file.name, err);
        setError(`处理文件 "${file.name}" 时因受支持或内容损毁出现错误: ${err.message || '未知异常'}`);
      }
    }

    setAttachments(prev => [...prev, ...newAttachments]);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    await processFiles(Array.from(e.target.files));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (const item of Array.from(items)) {
      const dataItem = item as DataTransferItem;
      if (dataItem.type.startsWith('image/')) {
        const file = dataItem.getAsFile();
        if (file) {
          const nowStr = new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-');
          const ext = file.type.split('/')[1] || 'png';
          const namedFile = new File([file], `screenshot_${nowStr}.${ext}`, { type: file.type });
          files.push(namedFile);
        }
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      setIsPasting(true);
      try {
        await processFiles(files);
      } catch (err) {
        console.error('Failed to paste image:', err);
      } finally {
        // Simple loading indicator timeout to make it visually perceptible and extremely satisfying
        setTimeout(() => {
          setIsPasting(false);
        }, 500);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const removeAttachment = (indexToRemove: number) => {
    setAttachments(prev => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const clearInput = () => {
    if (!clearConfirm) {
      setClearConfirm(true);
      setTimeout(() => setClearConfirm(false), 3000);
      return;
    }
    setInput('');
    setAttachments([]);
    setClearConfirm(false);
  };

  const [draggedAttachmentIdx, setDraggedAttachmentIdx] = useState<number | null>(null);

  const handleAttachmentDragStart = (e: React.DragEvent, idx: number) => {
    setDraggedAttachmentIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleAttachmentDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleAttachmentDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (draggedAttachmentIdx === null || draggedAttachmentIdx === dropIdx) {
      setDraggedAttachmentIdx(null);
      return;
    }

    setAttachments(prev => {
      const copy = [...prev];
      const draggedItem = copy[draggedAttachmentIdx];
      copy.splice(draggedAttachmentIdx, 1);
      copy.splice(dropIdx, 0, draggedItem);
      return copy;
    });
    setDraggedAttachmentIdx(null);
  };

  const handleAddSavedPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPromptTitle.trim() || !input.trim()) return;

    setIsAddingPrompt(true);

    const newItem: any = {
      title: newPromptTitle.trim(),
      content: input,
      timestamp: new Date()
    };

    try {
      if (user) {
        const saved = await saveSavedPrompt(newItem, user.uid);
        setSavedPrompts(prev => [saved, ...prev]);
      } else {
        newItem.id = Date.now().toString();
        const guestItem = { ...newItem, timestamp: new Date() };
        get('app_saved_prompts_v1').then(async (current) => {
          const updated = [guestItem, ...(Array.isArray(current) ? current : [])];
          await set('app_saved_prompts_v1', updated);
          setSavedPrompts(updated);
        });
      }
      setNewPromptTitle('');
      setIsSavedPromptsOpen(false);
    } catch (err) {
      console.error('Failed to save prompt:', err);
    } finally {
      setIsAddingPrompt(false);
    }
  };

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleDeleteSavedPrompt = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (deleteConfirmId !== id) {
      setDeleteConfirmId(id);
      setTimeout(() => setDeleteConfirmId(null), 3000);
      return;
    }

    try {
      if (user) {
        await deleteSavedPrompt(id);
        setSavedPrompts(prev => prev.filter(p => p.id !== id));
      } else {
        get('app_saved_prompts_v1').then(async (current) => {
          if (Array.isArray(current)) {
            const updated = current.filter(p => p.id !== id);
            await set('app_saved_prompts_v1', updated);
            setSavedPrompts(updated);
          }
        });
      }
    } catch (err) {
      console.error('Failed to delete saved prompt:', err);
    }
  };

  const handleApplySavedPrompt = (content: string) => {
    setInput(content);
    setIsSavedPromptsOpen(false);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };



  const [isStylesModalOpen, setIsStylesModalOpen] = useState(false);

  const toggleTechnique = (id: string) => {
    setSelectedTechniques(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const toggleStyle = (id: string) => {
    setSelectedStyles(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const handleGenerate = async () => {
    if (featureMode !== 'image_prompt' && !input.trim() && attachments.length === 0) return;

    stopGeneration(); // Clean up previous

    setIsGenerating(true);
    setStatusText('正在连接模型，等待首段文字...');
    setError(null);
    setOutput('');
    setPromptOptimizationTaskSession(null);

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    if (!user) {
      const message = '请先登录后再使用提示词优化的文字生成模型。';
      setError(message);
      setOutput(`[系统状态] ${message}`);
      setIsGenerating(false);
      setStatusText('');
      return;
    }

    if (!selectedTextModel && UNAVAILABLE_GEMINI_MODELS.has(selectedModel)) {
      const message = '该模型已不可用，请重新选择。';
      setError(message);
      setOutput(`[系统状态] ${message}`);
      setIsGenerating(false);
      setStatusText('');
      return;
    }

    if (!selectedTextModel) {
      const message = textModelOptions.length === 0
        ? '当前没有可用的文字生成模型。请由管理员或经理先在 API 设置中新增 TEXT_GENERATOR 模型。'
        : '该模型已不可用，请重新选择。';
      setError(message);
      setOutput(`[系统状态] ${message}`);
      setIsGenerating(false);
      setStatusText('');
      return;
    }

    const executeGeneration = async (modelToUse: ModelType): Promise<void> => {
      const apiToUse = selectedTextModel;

      try {
        let finalResult = '';
        setStatusText(`已提交 ${getTextModelDisplayName(apiToUse)} 后台生成任务...`);
        const task = await startModeTask(featureMode, input, attachments, featureMode === 'image_prompt' ? promptCount : 1);
        setPromptOptimizationTaskSession({
          taskId: task.taskId,
          featureMode,
          status: `已提交 ${getTextModelDisplayName(apiToUse)} 后台生成任务...`,
          progress: 0,
          isResumed: false
        });
        window.localStorage.setItem(promptOptimizationTaskStorageKey(user?.uid, currentProjectId), JSON.stringify({
          taskId: task.taskId,
          runId: task.runId || null,
          featureMode,
          input,
          mode,
          duration: duration || '',
          wordCount,
          imagePromptGear,
          selectedTechniques,
          selectedStyles,
          promptCount,
          modelToUse,
          customModelId: apiToUse.id,
          customModelAlias: apiToUse.alias,
          startedAt: new Date().toISOString()
        }));
        finalResult = await pollPromptOptimizationTask(task.taskId, signal);
        window.localStorage.removeItem(promptOptimizationTaskStorageKey(user?.uid, currentProjectId));
        setOutput(finalResult);
        setStatusText('');
        setPromptOptimizationTaskSession(null);
        setIsGenerating(false);
        await saveGeneratedHistory({
          finalResult,
          modelToUse,
          apiToUse,
          source: 'prompt_optimization_background_task',
          featureModeValue: featureMode,
          modeValue: mode,
          wordCountValue: wordCount,
          durationValue: duration || '',
          imagePromptGearValue: imagePromptGear,
          selectedTechniquesValue: selectedTechniques,
          selectedStylesValue: selectedStyles,
          promptCountValue: promptCount
        });
      } catch (err: any) {
        if (err.name === 'AbortError' && signal.aborted) {
          console.log('Cancel signal received');
          return;
        }
        window.localStorage.removeItem(promptOptimizationTaskStorageKey(user?.uid, currentProjectId));
        throw err;
      } finally {
        if (watchdogTimerRef.current) clearTimeout(watchdogTimerRef.current);
      }
    };

    try {
      // Start with the selected model
      const initialModel = selectedModel;
      await executeGeneration(initialModel);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        process.env.NODE_ENV === 'development' && console.error('Generation failed:', err);

        let userFriendlyMsg = userMessageForGenerationError(err);

        const isQuotaError = err.message?.includes('429') || err.message?.toLowerCase().includes('quota') || err.message?.includes('RESOURCE_EXHAUSTED');
        const isPermissionError = err.message?.includes('permission') || err.message?.includes('Missing or insufficient permissions');

        if (isQuotaError) {
          userFriendlyMsg = '系统负载较高或 API 配额已耗尽。建议在“设置”中切换模型，或配置您的“自定义引擎”以获得更稳定的生成体验。';
        } else if (isPermissionError) {
          userFriendlyMsg = '数据同步异常：云端保存受限。请检查您的网络连接或尝试重新登录。';
        }

        const diagnosis = [
          err?.code ? `错误码: ${err.code}` : null,
          err?.message ? `原因: ${err.message}` : null,
          err?.details ? `阶段耗时: ${JSON.stringify(err.details)}` : null
        ].filter(Boolean).join('\n');
        setOutput(`[系统状态] ${userFriendlyMsg}\n\n详细诊断:\n${diagnosis || String(err)}`);
        setError(userFriendlyMsg);
      }
    } finally {
      setIsGenerating(false);
      setStatusText('');
      if (!activePromptOptimizationTaskRef.current) {
        setPromptOptimizationTaskSession(null);
      }
    }
  };

  useEffect(() => {
    if (!pendingAssistantGenerate || isGenerating) return;
    const timer = window.setTimeout(() => {
      setPendingAssistantGenerate(null);
      void handleGenerate();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [pendingAssistantGenerate, isGenerating, handleGenerate]);

  const handleCopy = () => {
    if (!output) return;
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full w-full bg-[#050505] text-cyan-50 font-sans flex flex-col overflow-hidden relative selection:bg-cyan-900 selection:text-cyan-50">
      {/* Background Grid */}
      <div className="absolute inset-0 z-0 opacity-20 pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(to right, #082f49 1px, transparent 1px), linear-gradient(to bottom, #082f49 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }}>
      </div>
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-900/10 via-[#050505]/80 to-[#050505] pointer-events-none"></div>

      {/* Header */}
      <header className="h-14 border-b border-cyan-900/50 flex items-center px-6 bg-[#050505]/80 backdrop-blur-md shrink-0 justify-between z-10 w-full overflow-hidden">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 bg-cyan-950/20 p-1 rounded-lg border border-cyan-900/50 shrink-0">
            <button
              onClick={() => { setFeatureMode('prompt'); setOutput(''); }}
              className={`px-3 sm:px-4 py-1.5 rounded flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase transition-all ${featureMode === 'prompt' ? 'bg-cyan-900/50 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.2)]' : 'text-cyan-600 hover:text-cyan-400 hover:bg-cyan-950/30'}`}
              title="Video Prompt"
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">视频提示词</span>
            </button>
            <button
              onClick={() => { setFeatureMode('image_prompt'); setOutput(''); }}
              className={`px-3 sm:px-4 py-1.5 rounded flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase transition-all ${featureMode === 'image_prompt' ? 'bg-purple-900/50 text-purple-300 shadow-[0_0_10px_rgba(168,85,247,0.2)]' : 'text-cyan-600 hover:text-cyan-400 hover:bg-cyan-950/30'}`}
              title="Image Prompt"
            >
              <ImageIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden xl:inline">生图提示词</span>
            </button>
            <button
              onClick={() => {
                setFeatureMode('reverse');
                setOutput('');
              }}
              className={`px-3 sm:px-4 py-1.5 rounded flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase transition-all ${featureMode === 'reverse' ? 'bg-cyan-900/50 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.2)]' : 'text-cyan-600 hover:text-cyan-400 hover:bg-cyan-950/30'}`}
              title="Reverse Engine"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">反推提示词</span>
            </button>
            <button
              onClick={() => { setFeatureMode('edit'); setOutput(''); }}
              className={`px-3 sm:px-4 py-1.5 rounded flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase transition-all ${featureMode === 'edit' ? 'bg-cyan-900/50 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.2)]' : 'text-cyan-600 hover:text-cyan-400 hover:bg-cyan-950/30'}`}
              title="Edit Engine"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">改图提示词</span>
            </button>
            <button
              onClick={() => { setFeatureMode('music_prompt'); setOutput(''); }}
              className={`px-3 sm:px-4 py-1.5 rounded flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase transition-all ${featureMode === 'music_prompt' ? 'bg-blue-900/50 text-blue-300 shadow-[0_0_10px_rgba(59,130,246,0.2)]' : 'text-cyan-600 hover:text-cyan-400 hover:bg-cyan-950/30'}`}
              title="Audio Engine"
            >
              <Music className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden xl:inline">音乐提示词</span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 bg-cyan-950/20 p-1 rounded-lg border border-cyan-900/50 shrink-0">
            <button
              onClick={() => setIsSettingsOpen(true)}
              className={`px-3 py-1.5 rounded flex items-center gap-2 text-[10px] font-mono tracking-widest uppercase transition-all ${selectedTextModel ? 'bg-amber-900/50 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]' : 'text-cyan-600 hover:text-cyan-400 hover:bg-cyan-950/30'}`}
              title="Text model settings"
            >
              <Settings className={`w-4 h-4 ${selectedTextModel ? 'animate-pulse' : ''}`} />
              <span className="hidden lg:inline">{selectedTextModel ? 'Text Engine' : '设置'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden z-10 w-full max-w-[1600px] mx-auto p-4 gap-4">
        <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden gap-4 rounded-xl min-w-0">

          {/* Input Section */}
          <section className="col-span-1 lg:col-span-5 flex flex-col bg-[#0a0a0a]/80 border border-cyan-900/30 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.5)] backdrop-blur-sm z-10 relative">

            <AnimatePresence>
              {isInputExpanded && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  ref={expandedInputRef}
                  className="absolute inset-0 z-50 bg-[#020304] flex flex-col pt-3"
                >
                  <div className="px-3 pb-3 border-b border-cyan-900/30 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-2">
                      <Activity className="w-3.5 h-3.5 text-cyan-500" />
                      <span className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest">Expanded Input</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] bg-cyan-950/50 border border-cyan-800/50 px-2 py-0.5 rounded text-cyan-400 font-mono tracking-widest shadow-[inset_0_0_8px_rgba(6,182,212,0.2)]">{input.length} CHARS</span>
                      <button onClick={() => setIsInputExpanded(false)} className="text-cyan-600 hover:text-cyan-300 transition-colors">
                        <Minimize2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 p-5 relative">
                    <textarea
                      ref={isInputExpanded ? textareaRef : null}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      onPaste={handlePaste}
                      onKeyUp={(e) => {
                        if (e.key.startsWith('Arrow')) handleInputCursorMove();
                      }}
                      onClick={handleInputCursorMove}
                      onBlur={handleInputCursorMove}
                      onScroll={() => setShowMentions(false)}
                      placeholder=">> EXPANDED INPUT MODE... (Press Esc or click outside to collapse)"
                      className="w-full h-full bg-transparent border-none outline-none resize-none text-cyan-100 placeholder:text-cyan-800 font-mono custom-scrollbar focus:ring-0 cursor-text"
                      autoFocus
                    />


                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="p-3 border-b border-cyan-900/30 flex justify-between items-center bg-cyan-950/20 shrink-0 relative">
              <div className="flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-cyan-500" />
                <span className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest">输入框</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] bg-cyan-950/50 border border-cyan-800/50 px-2 py-0.5 rounded text-cyan-400 font-mono tracking-widest shadow-[inset_0_0_8px_rgba(6,182,212,0.2)]">输入的字符串数: {input.length}</span>
                <button
                  onClick={() => setIsSavedPromptsOpen(!isSavedPromptsOpen)}
                  className={`flex items-center gap-1.5 text-[10px] font-mono tracking-widest px-2 py-1 rounded transition-colors ${isSavedPromptsOpen ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'bg-cyan-950/50 text-cyan-500 hover:text-cyan-300 border border-transparent hover:border-cyan-800/50 hover:bg-cyan-900/30'}`}
                  title="保存和预设提示词"
                >
                  <Bookmark className="w-3 h-3" />
                  <span>保存和预设提示词</span>
                </button>
              </div>

              {/* Presets Panel */}
              <AnimatePresence>
                {isSavedPromptsOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute top-full right-0 mt-1 w-80 max-h-96 bg-[#0a0a0a] border border-cyan-500/40 rounded shadow-[0_0_30px_rgba(6,182,212,0.3)] z-50 flex flex-col overflow-hidden"
                  >
                    <div className="p-3 border-b border-cyan-900/50 bg-cyan-950/40 flex flex-col gap-2 shrink-0">
                      <form onSubmit={handleAddSavedPrompt} className="flex gap-2 w-full">
                        <input
                          type="text"
                          value={newPromptTitle}
                          onChange={(e) => setNewPromptTitle(e.target.value)}
                          placeholder="Preset Title..."
                          className="flex-1 bg-[#050505] border border-cyan-900/50 rounded px-2 py-1.5 text-xs text-cyan-100 placeholder:text-cyan-800 font-mono focus:border-cyan-500 outline-none"
                          maxLength={30}
                        />
                        <button
                          type="submit"
                          disabled={!newPromptTitle.trim() || !input.trim() || isAddingPrompt}
                          className="bg-cyan-950 text-cyan-400 px-2 py-1.5 rounded flex text-[10px] uppercase tracking-wider items-center justify-center border border-cyan-800 hover:bg-cyan-900 hover:text-cyan-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </form>
                      {(!input.trim() && !isAddingPrompt) && (
                         <div className="text-[9px] text-amber-500/80 italic text-center w-full">Enter text in input stream to save it as preset</div>
                      )}
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 flex flex-col gap-2 relative">
                       {!isSavedPromptsLoaded ? (
                         <div className="py-8 flex flex-col items-center justify-center gap-2 text-cyan-700">
                           <RefreshCw className="w-4 h-4 animate-spin" />
                           <span className="text-[10px] font-mono tracking-widest">LOADING PRESETS...</span>
                         </div>
                       ) : savedPrompts.length === 0 ? (
                         <div className="py-8 text-center text-[10px] text-cyan-700 font-mono tracking-widest border border-dashed border-cyan-900/50 rounded bg-cyan-950/10">
                           <Bookmark className="w-8 h-8 mx-auto mb-2 opacity-50" />
                           NO PRESETS SAVED
                         </div>
                       ) : (
                         savedPrompts.map(prompt => (
                           <div
                             key={prompt.id}
                             className="group bg-[#050505] hover:bg-cyan-950/30 border border-cyan-900/40 rounded p-2 flex flex-col gap-1 cursor-pointer transition-colors"
                             onClick={() => handleApplySavedPrompt(prompt.content)}
                           >
                             <div className="flex justify-between items-start">
                               <span className="text-xs font-bold text-cyan-400 truncate max-w-[200px]">{prompt.title}</span>
                               <button
                                 onClick={(e) => handleDeleteSavedPrompt(prompt.id, e)}
                                 className={`transition-opacity ${deleteConfirmId === prompt.id ? 'text-red-500 opacity-100' : 'text-cyan-800 hover:text-red-400 opacity-0 group-hover:opacity-100'}`}
                                 title={deleteConfirmId === prompt.id ? "Click again to confirm" : "Delete Preset"}
                               >
                                 <Trash2 className="w-3.5 h-3.5" />
                               </button>
                             </div>
                             <p className="text-[10px] text-cyan-600 font-mono line-clamp-2 leading-tight">
                               {prompt.content}
                             </p>
                           </div>
                         ))
                       )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div
              className={`flex-1 p-5 font-mono text-sm leading-relaxed flex flex-col relative transition-colors ${isDragging ? 'bg-cyan-900/20' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {isDragging && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#050505]/90 backdrop-blur-sm border-2 border-dashed border-cyan-500 m-3 rounded-lg shadow-[0_0_20px_rgba(6,182,212,0.2)] pointer-events-none">
                   <div className="flex flex-col items-center gap-3 text-cyan-400">
                     <div className="w-12 h-12 rounded-full bg-cyan-950 flex items-center justify-center border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.4)] animate-pulse">
                        <Paperclip className="w-6 h-6" />
                     </div>
                     <span className="font-mono text-xs uppercase tracking-[0.2em]">Establish Data Link</span>
                   </div>
                </div>
              )}

              {isPasting && (
                <div className="absolute inset-0 z-15 flex items-center justify-center bg-[#050505]/95 backdrop-blur-sm border border-cyan-500/30 rounded-lg shadow-[0_0_20px_rgba(6,182,212,0.2)] pointer-events-none">
                    <div className="flex flex-col items-center gap-3 text-cyan-400">
                      <div className="w-12 h-12 rounded-full bg-cyan-950 flex items-center justify-center border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.4)]">
                         <Loader2 className="w-5 h-5 animate-spin" />
                      </div>
                      <span className="font-mono text-xs uppercase tracking-[0.2em] animate-pulse">正在导入粘贴的图片...</span>
                    </div>
                </div>
              )}

              <div className="relative flex-1 flex flex-col">
                <textarea
                  id="prompt-input"
                  ref={!isInputExpanded ? textareaRef : null}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  onKeyUp={(e) => {
                    if (e.key.startsWith('Arrow')) handleInputCursorMove();
                  }}
                  onClick={handleInputCursorMove}
                  onBlur={handleInputCursorMove}
                  onScroll={() => setShowMentions(false)}
                  placeholder={
                    featureMode === 'prompt'
                      ? ">> INITIALIZING PROMPT... 描述您的画面、动作或提供参考材料 (输入@调用附件)..."
                      : featureMode === 'image_prompt'
                        ? ">> INITIALIZING IMAGE PROMPT... 输入创意或直接生成影视级提示词 (输入@调用附件)..."
                        : featureMode === 'music_prompt'
                          ? ">> INITIALIZING MUSIC PROMPT... 描述分镜动作、情绪基调，生成Suno/ElevenLabs全维度听觉资产 (输入@调用附件)..."
                        : featureMode === 'reverse'
                          ? ">> INITIALIZING REVERSE INFERENCE... 提供希望反推的图片或视频 (输入@调用附件)..."
                          : ">> INITIALIZING MODIFICATION... 请描述您想如何修改图片 (输入@调用附件)..."
                  }
                  className="w-full h-full bg-transparent border-none outline-none resize-none text-cyan-100 placeholder:text-cyan-800 font-mono custom-scrollbar focus:ring-0 cursor-text"
                />


              </div>

              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-cyan-900/30">
                  {attachments.map((att, idx) => (
                    <div
                      key={idx}
                      onClick={() => setPreviewAttachment(att)}
                      draggable
                      onDragStart={(e) => handleAttachmentDragStart(e, idx)}
                      onDragOver={handleAttachmentDragOver}
                      onDrop={(e) => handleAttachmentDrop(e, idx)}
                      onDragEnd={() => setDraggedAttachmentIdx(null)}
                      className={`flex items-center gap-1.5 bg-cyan-950/30 border border-cyan-800/50 rounded-sm px-2 py-1 text-[10px] text-cyan-300 cursor-pointer hover:bg-cyan-900/50 hover:border-cyan-500/50 hover:shadow-[0_0_8px_rgba(6,182,212,0.3)] transition-all group ${draggedAttachmentIdx === idx ? 'opacity-30 border-dashed border-cyan-500' : ''}`}
                    >
                      <Paperclip className="w-3 h-3 text-cyan-600 group-hover:text-cyan-400 transition-colors" />
                      <div className="flex flex-col leading-tight">
                        <span className="font-mono text-cyan-400 font-bold">
                          {(() => {
                            const sameType = attachments.slice(0, idx + 1).filter(a => {
                              if (att.mimeType.startsWith('image/')) return a.mimeType.startsWith('image/');
                              if (att.mimeType.startsWith('video/')) return a.mimeType.startsWith('video/');
                              if (att.mimeType.startsWith('audio/')) return a.mimeType.startsWith('audio/');
                              return false;
                            });
                            let prefix = 'file';
                            if (att.mimeType.startsWith('image/')) prefix = 'image';
                            else if (att.mimeType.startsWith('video/')) prefix = 'video';
                            else if (att.mimeType.startsWith('audio/')) prefix = 'audio';
                            return `@${prefix}${sameType.length}`;
                          })()}
                        </span>
                        <span className="truncate max-w-[120px] opacity-60 text-[8px]">{att.name}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAttachment(idx);
                        }}
                        className="hover:text-red-400 ml-1 ml-auto shrink-0 p-0.5 rounded-sm transition-colors opacity-60 hover:opacity-100 hover:bg-red-500/20"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

                <div className="flex items-center mt-4 pt-3 border-t border-cyan-900/30 justify-between">
                  <div className="flex flex-col gap-1">
                    <div className="flex gap-2">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 text-[10px] font-mono tracking-widest text-cyan-500 hover:text-cyan-300 transition-colors px-2.5 py-1.5 bg-cyan-950/20 rounded-sm border border-cyan-900/50 hover:border-cyan-500/50 hover:shadow-[0_0_10px_rgba(6,182,212,0.2)] uppercase"
                      >
                        <Paperclip className="w-3 h-3" />
                        <span>上传附件</span>
                      </button>
                      <button
                        onClick={toggleRecording}
                        disabled={isTranscribing}
                        className={`flex items-center gap-1.5 text-[10px] font-mono tracking-widest px-2.5 py-1.5 rounded-sm border transition-colors uppercase ${isRecording ? 'text-red-400 bg-red-950/40 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.3)] animate-pulse' : isTranscribing ? 'text-cyan-600 bg-cyan-950/20 border-cyan-900/50 cursor-wait' : 'text-cyan-500 hover:text-cyan-300 bg-cyan-950/20 border-cyan-900/50 hover:border-cyan-500/50 hover:shadow-[0_0_10px_rgba(6,182,212,0.2)]'}`}
                        title="Voice Input (Ctrl+B)"
                      >
                        {isTranscribing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mic className="w-3 h-3" />}
                        <span>{isRecording ? "正在录音..." : isTranscribing ? "识别中..." : "语音输入"}</span>
                      </button>
                      <button
                         onClick={clearInput}
                         className={`flex items-center gap-1.5 text-[10px] font-mono tracking-widest text-red-500 hover:text-red-300 transition-colors px-2.5 py-1.5 bg-red-950/20 rounded-sm border ${clearConfirm ? 'border-red-500/50 bg-red-950/50' : 'border-red-900/50'} hover:border-red-500/50 hover:shadow-[0_0_10px_rgba(239,68,68,0.2)] uppercase`}
                         title={clearConfirm ? "Click to confirm clear" : "Clear Input & Attachments"}
                       >
                         <Trash2 className="w-3 h-3" />
                         {clearConfirm && <span>Confirm?</span>}
                       </button>
                       <button
                         onClick={handleUndo}
                         disabled={undoStack.length === 0}
                         className={`flex items-center gap-1.5 text-[10px] font-mono tracking-widest px-2.5 py-1.5 rounded-sm border transition-colors uppercase ${undoStack.length === 0 ? 'text-gray-600 bg-gray-900/20 border-gray-800 cursor-not-allowed' : 'text-cyan-500 bg-cyan-950/20 border-cyan-900/50 hover:text-cyan-300 hover:border-cyan-500/50 hover:shadow-[0_0_10px_rgba(6,182,212,0.2)]'}`}
                         title="Undo (Ctrl+Z)"
                       >
                         <Undo className="w-3 h-3" />
                       </button>
                       <button
                         onClick={handleRedo}
                         disabled={redoStack.length === 0}
                         className={`flex items-center gap-1.5 text-[10px] font-mono tracking-widest px-2.5 py-1.5 rounded-sm border transition-colors uppercase ${redoStack.length === 0 ? 'text-gray-600 bg-gray-900/20 border-gray-800 cursor-not-allowed' : 'text-cyan-500 bg-cyan-950/20 border-cyan-900/50 hover:text-cyan-300 hover:border-cyan-500/50 hover:shadow-[0_0_10px_rgba(6,182,212,0.2)]'}`}
                         title="Redo (Ctrl+Y)"
                       >
                         <Redo className="w-3 h-3" />
                       </button>
                       <button
                        onClick={() => setIsInputExpanded(true)}
                        className="flex items-center gap-1.5 text-[10px] font-mono tracking-widest text-cyan-500 hover:text-cyan-300 transition-colors px-2.5 py-1.5 bg-cyan-950/20 rounded-sm border border-cyan-900/50 hover:border-cyan-500/50 hover:shadow-[0_0_10px_rgba(6,182,212,0.2)] uppercase text-cyan-400"
                        title="Expand Input"
                      >
                        <Maximize2 className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="text-[8px] text-cyan-800 font-mono uppercase tracking-tighter">MAX 20MB/FILE | 10 FILES TOTAL</span>
                  </div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/*,video/*,audio/*"
                  multiple
                  className="hidden"
                />
              </div>
            </div>

            <div className="p-5 border-t border-cyan-900/30 bg-[#080a0c]/80 shrink-0">
              <h3 className="text-[10px] font-bold text-cyan-600 uppercase mb-3 text-left tracking-widest flex items-center gap-1.5">
                <ChevronDown className="w-3 h-3" /> {
                  featureMode === 'prompt'
                    ? 'Engine Parameters'
                    : featureMode === 'image_prompt'
                      ? 'Cinematic Architect Parameters'
                      : featureMode === 'reverse'
                        ? 'Inference Parameters'
                        : 'Image Modification Parameters'
                }
              </h3>

              <div className="grid grid-cols-1 gap-4">
                {featureMode === 'prompt' && (
                  <div className="bg-[#050505]/50 border border-cyan-900/40 rounded-lg p-3">
                    <label className="block text-[9px] text-cyan-600 uppercase mb-2 tracking-widest">Smart Gear (智能档位)</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: 'auto', label: 'Auto模式', color: 'border-cyan-900/50 hover:bg-cyan-900/30 text-cyan-600', active: 'border-cyan-500 bg-cyan-500/10 text-cyan-300 shadow-[inset_0_0_10px_rgba(6,182,212,0.2)] shadow-[0_0_10px_rgba(6,182,212,0.3)]' },
                        { id: 'light', label: '常规档', color: 'border-cyan-900/50 hover:bg-emerald-900/30 text-emerald-600/70', active: 'border-emerald-500 bg-emerald-500/10 text-emerald-300 shadow-[inset_0_0_10px_rgba(16,185,129,0.2)] shadow-[0_0_10px_rgba(16,185,129,0.3)]' },
                        { id: 'standard', label: '张力设计档', color: 'border-cyan-900/50 hover:bg-yellow-900/30 text-yellow-600/70', active: 'border-yellow-500 bg-yellow-500/10 text-yellow-300 shadow-[inset_0_0_10px_rgba(234,179,8,0.2)] shadow-[0_0_10px_rgba(234,179,8,0.3)]' },
                        { id: 'cinematic', label: '造物奇观档', color: 'border-cyan-900/50 hover:bg-rose-900/30 text-rose-600/70', active: 'border-rose-500 bg-rose-500/10 text-rose-300 shadow-[inset_0_0_10px_rgba(244,63,94,0.2)] shadow-[0_0_10px_rgba(244,63,94,0.3)]' }
                      ].map((gear) => (
                        <button
                          key={gear.id}
                          onClick={() => setMode(gear.id as Mode)}
                          className={
                            "px-2 py-1.5 rounded-md flex items-center justify-center text-[10px] font-mono tracking-wider border transition-all duration-300 " +
                            (mode === gear.id ? gear.active : gear.color)
                          }
                        >
                          {gear.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {featureMode === 'prompt' && (
                  <div className="bg-[#050505]/50 border border-cyan-900/40 rounded-lg p-3">
                    <label className="block text-[9px] text-cyan-600 uppercase mb-2 tracking-widest">Word Count Constraint (核心提示词字数控制)</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: '300', label: '300字段', range: '250~400' },
                        { id: '500', label: '500字段', range: '500~600' },
                        { id: '800', label: '800字段', range: '800~950' }
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => handleWordCountChange(opt.id as '300' | '500' | '800')}
                          className={
                            "px-2 py-1.5 rounded-md flex flex-col items-center justify-center border transition-all duration-300 " +
                            (wordCount === opt.id
                              ? "border-cyan-500 bg-cyan-500/10 text-cyan-300 shadow-[inset_0_0_10px_rgba(6,182,212,0.2)]"
                              : "border-cyan-900/50 hover:bg-cyan-900/30 text-cyan-600"
                            )
                          }
                        >
                          <span className="text-[10px] font-mono font-bold tracking-wider">{opt.label}</span>
                          <span className="text-[8px] opacity-60 font-mono">({opt.range})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {featureMode === 'image_prompt' && (
                  <div className="bg-[#050505]/50 border border-purple-900/40 rounded-lg p-2 mb-2">
                    <label className="block text-[9px] text-purple-600 uppercase tracking-widest mb-1.5">Engine Gear (强力档位选择)</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'regular', label: 'REGULAR (常规模式)', desc: '影视叙事基底' },
                        { id: 'extreme', label: 'EXTREME (张力狂暴)', desc: '透视暴政与极限张力' }
                      ].map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => setImagePromptGear(opt.id as 'regular' | 'extreme')}
                          className={
                            "px-2 py-1.5 rounded-md flex flex-col items-start justify-center border transition-all duration-300 " +
                            (imagePromptGear === opt.id
                              ? "border-purple-500 bg-purple-500/10 text-purple-300 shadow-[inset_0_0_10px_rgba(168,85,247,0.2)]"
                              : "border-purple-900/50 hover:bg-purple-900/30 text-purple-600"
                            )
                          }
                        >
                          <span className="text-[10px] font-mono font-bold tracking-wider">{opt.label}</span>
                          <span className="text-[8px] opacity-60 font-sans mt-0.5">{opt.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {featureMode === 'image_prompt' && (
                  <div className="bg-[#050505]/50 border border-purple-900/40 rounded-lg p-2">
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-[9px] text-purple-600 uppercase tracking-widest">Visual DNA (视觉风格实验室)</label>
                      <button
                        onClick={() => setIsStylesModalOpen(true)}
                        className="text-[9px] text-purple-400 hover:text-purple-300 font-mono flex items-center gap-1 group transition-colors px-2 py-0.5 rounded border border-purple-900/50 hover:bg-purple-900/20"
                      >
                        CHANGE DNA <ArrowRight className="w-2.5 h-2.5 group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    </div>

                    <button
                      onClick={() => setIsStylesModalOpen(true)}
                      className="w-full min-h-[40px] rounded-lg border border-purple-500/30 bg-purple-950/10 hover:bg-purple-950/20 transition-all flex items-center justify-center p-1.5 group relative overflow-hidden"
                    >
                      {selectedTechniques.length === 0 && selectedStyles.length === 0 ? (
                        <div className="flex flex-col items-center gap-1">
                          <Palette className="w-4 h-4 text-purple-500 group-hover:scale-110 transition-transform" />
                          <span className="text-[10px] text-purple-400 font-mono uppercase tracking-[0.2em]">画风选择</span>
                        </div>
                      ) : (
                        <div className="w-full flex flex-wrap gap-1.5 justify-center">
                          {selectedTechniques.map(id => {
                            const tech = TECHNICAL_TECHNIQUES.find(t => t.id === id);
                            return tech ? (
                              <div key={id} className="bg-purple-900/40 border border-purple-400/30 rounded-full px-2.5 py-1 flex items-center gap-2">
                                <span className="text-[8px] text-purple-200 font-mono uppercase font-bold tracking-wider">{tech.label}</span>
                              </div>
                            ) : null;
                          })}
                          {selectedStyles.map(id => {
                            const style = ART_STYLES.find(s => s.id === id);
                            return style ? (
                              <div key={id} className="bg-cyan-900/40 border border-cyan-400/30 rounded-full px-2.5 py-1 flex items-center gap-2">
                                <span className="text-[8px] text-cyan-200 font-mono uppercase font-bold tracking-wider">{style.label}</span>
                              </div>
                            ) : null;
                          })}
                        </div>
                      )}
                    </button>
                  </div>
                )}

                <div className={`grid ${featureMode === 'prompt' ? 'grid-cols-4' : 'grid-cols-1'} gap-3`}>
                  {featureMode === 'prompt' && (
                    <div className="col-span-1 bg-[#050505]/50 border border-cyan-900/40 rounded-lg p-3 relative overflow-hidden group">
                      <div className="absolute inset-0 bg-cyan-500/5 translate-y-full group-hover:translate-y-0 transition-transform"></div>
                      <label className="block text-[9px] text-cyan-600 uppercase mb-1 tracking-widest">Duration</label>
                      <div className="flex items-center">
                        <input
                          type="number"
                          value={duration}
                          onChange={(e) => setDuration(e.target.value)}
                          placeholder="AUTO"
                          className="w-full bg-transparent text-sm text-cyan-300 outline-none border-none p-0 focus:ring-0 placeholder-cyan-800 font-mono"
                        />
                        <span className="text-[9px] text-cyan-700 font-mono">SEC</span>
                      </div>
                    </div>
                  )}
                  <div className={featureMode === 'prompt' ? "col-span-3 flex flex-col gap-3" : "col-span-1 flex flex-col gap-3"}>
                    {featureMode === 'image_prompt' && (
                      <div className="flex items-center gap-2 p-1.5 rounded-lg border transition-all bg-purple-950/10 border-purple-500/20">
                        <span className="text-[9px] font-mono tracking-widest px-2 uppercase whitespace-nowrap text-purple-700">输出提示词数量</span>
                        <div className="flex-1 grid grid-cols-3 gap-1">
                          {[1, 5, 10].map(c => (
                            <button
                              key={c}
                              onClick={() => setPromptCount(c)}
                              className={`py-1.5 rounded text-[10px] font-mono tracking-tighter uppercase transition-all border ${
                                promptCount === c
                                  ? 'bg-purple-500/20 border-purple-500 text-purple-200'
                                  : 'bg-transparent border-purple-900/30 text-purple-700 hover:text-purple-400 hover:border-purple-700'
                              }`}
                            >
                              ×{c}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex gap-2 h-full">
                      <button
                        onClick={isGenerating ? stopGeneration : handleGenerate}
                        disabled={!isGenerating && (featureMode !== 'image_prompt' && !input.trim() && attachments.length === 0)}
                        className={`w-full relative overflow-hidden ${isGenerating ? 'bg-red-950/20 border-red-500/50 text-red-100 hover:bg-red-900/40' : 'bg-cyan-950/80 hover:bg-cyan-900 border-cyan-500/50 text-cyan-100'} disabled:bg-[#050505] disabled:text-cyan-900/50 border disabled:border-cyan-900/30 text-xs font-mono tracking-widest uppercase transition-all flex items-center justify-center gap-3 shadow-[0_0_20px_rgba(6,182,212,0.15)] hover:shadow-[0_0_30px_rgba(6,182,212,0.3)] group h-full px-3 py-2 rounded-lg`}
                      >
                        {/* Button scanning effect */}
                        {!isGenerating && <div className="absolute inset-0 w-[200%] bg-gradient-to-r from-transparent via-cyan-400/10 to-transparent -translate-x-full group-hover:animate-[scan_1.5s_ease-in-out_infinite] disabled:hidden"></div>}

                        {isGenerating ? (
                          <>
                            <div className="relative">
                              <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin" />
                              <X className="w-2 h-2 text-red-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-bold" />
                            </div>
                            <div className="flex flex-col items-start">
                              <span className="text-red-400 group-hover:text-red-300">Stop Engine</span>
                              <span className="text-[8px] font-mono text-cyan-700 animate-pulse lowercase tracking-tighter">{statusText}</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-4 h-4 text-cyan-400 group-hover:scale-110 transition-transform" />
                            {
                              featureMode === 'prompt'
                                ? 'Execute Optimisation'
                                : featureMode === 'image_prompt'
                                  ? `Generate ${promptCount > 1 ? promptCount + ' ' : ''}Cinematic Prompt${promptCount > 1 ? 's' : ''}`
                                  : featureMode === 'reverse'
                                    ? 'Execute Inference'
                                    : 'Execute Modification'
                            }
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Optimized Result Area */}
          <section className="col-span-1 lg:col-span-7 flex flex-col bg-[#0a0a0a]/80 border border-cyan-900/30 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.5)] backdrop-blur-sm relative z-10">
            <div className="p-3 border-b border-cyan-900/30 flex justify-between items-center bg-cyan-950/20 shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-sm bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></span>
                <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">输出框</span>
              </div>
              {isMemberRole ? (
                <div className="text-[10px] text-amber-500/75 flex items-center gap-1.5 font-mono uppercase tracking-widest bg-amber-950/20 border border-amber-900/35 px-2.5 py-1 rounded">
                  <Shield className="w-3.5 h-3.5 text-amber-500" />
                  <span>核心代码已锁定</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={handleCopy}
                    disabled={!output}
                    className="text-[10px] text-cyan-600 hover:text-cyan-300 hover:shadow-[0_0_10px_rgba(6,182,212,0.3)] flex items-center gap-1.5 disabled:opacity-30 disabled:hover:shadow-none transition-all px-2 py-1 rounded bg-cyan-950/30 border border-cyan-900/50 uppercase font-mono tracking-widest outline-none shrink-0"
                  >
                    {copied ? <span className="text-emerald-400">已复制!</span> : (
                      <>
                        <Copy className="w-3 h-3" />
                        复制提示词
                        {output && <span className="ml-1 opacity-60">({output.length} chars)</span>}
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 p-4 lg:p-5 overflow-hidden flex flex-col relative">
              {promptOptimizationTaskSession && !isMemberRole && (
                <div className="mb-3 rounded-lg border border-cyan-500/25 bg-cyan-950/15 px-3 py-2.5 shadow-[0_0_18px_rgba(6,182,212,0.08)]">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-cyan-500/30 bg-[#050505]/70">
                        <Activity className="h-4 w-4 text-cyan-300" />
                        {isGenerating && <span className="absolute inset-0 rounded-md border border-cyan-400/30 animate-ping" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-cyan-300">
                            {FEATURE_MODE_LABELS[promptOptimizationTaskSession.featureMode]}
                          </span>
                          <span className={`rounded border px-1.5 py-0.5 text-[8px] font-mono uppercase tracking-widest ${promptOptimizationTaskSession.isResumed ? 'border-amber-500/30 bg-amber-950/30 text-amber-300' : 'border-emerald-500/25 bg-emerald-950/20 text-emerald-300'}`}>
                            {promptOptimizationTaskSession.isResumed ? '续接任务' : '后台任务'}
                          </span>
                          <span className="text-[8px] font-mono uppercase tracking-widest text-cyan-700">
                            ID: {promptOptimizationTaskSession.taskId.slice(0, 8)}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-[10px] font-mono text-cyan-500">
                          {promptOptimizationTaskSession.status || statusText || '后台任务运行中...'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:w-44">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-cyan-950/80">
                        <div
                          className="h-full rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.6)] transition-all duration-500"
                          style={{ width: `${Math.max(3, Math.min(100, promptOptimizationTaskSession.progress || 0))}%` }}
                        />
                      </div>
                      <span className="w-9 text-right text-[9px] font-mono text-cyan-400">
                        {Math.round(promptOptimizationTaskSession.progress || 0)}%
                      </span>
                    </div>
                  </div>
                </div>
              )}
              <div className="bg-[#050505]/70 border border-cyan-900/30 rounded-lg p-5 font-mono text-sm leading-relaxed text-cyan-100/90 shadow-inner flex-1 relative overflow-hidden flex flex-col">
                {isMemberRole ? (
                  <div className="flex flex-col items-center justify-center h-full text-center p-6 space-y-4">
                    <div className="w-14 h-14 rounded-full bg-amber-950/20 border border-amber-500/30 flex items-center justify-center text-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.15)] animate-pulse">
                      <Shield className="w-7 h-7" />
                    </div>
                    <div className="space-y-1.5 max-w-sm">
                      <h3 className="text-amber-500 font-mono text-xs font-bold uppercase tracking-[0.2em]">CORE CODE RESTRICTED</h3>
                      <p className="text-cyan-500 text-[11px] font-mono leading-relaxed">
                        【核心创意代码提示受安全策略保护】
                      </p>
                      <p className="text-[#8aa3b0] text-[10px] leading-relaxed">
                        您的账号安全席位目前为 <strong className="text-amber-400 font-mono font-normal">成员 (Member)</strong>，无法查看或复制系统底层编译、生成的专业提示词代码。
                      </p>
                      <p className="text-[#59788a] text-[9.5px]">
                        ✦ 仅限 <strong className="text-cyan-400 font-normal">管理者</strong> 与 <strong className="text-cyan-400 font-normal">协助助理</strong> 核心授权解锁 ✦
                      </p>
                    </div>
                  </div>
                ) : (
                  <AnimatePresence mode="wait">
                    {error ? (
                      <motion.div
                        key="error"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-col items-center justify-center h-full text-center"
                      >
                        <div className="w-10 h-10 rounded-sm bg-red-950/50 flex items-center justify-center mb-3 border border-red-500/30 text-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]">
                          <span className="font-mono text-lg font-bold">ERR</span>
                        </div>
                        <p className="text-red-400/80 text-[11px] font-mono uppercase tracking-widest max-w-sm leading-relaxed">{error}</p>
                      </motion.div>
                    ) : !output && !isGenerating ? (
                      <motion.div
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="flex flex-col items-center justify-center h-full gap-4 text-cyan-900/50"
                      >
                        <div className="relative">
                           <div className="absolute inset-0 bg-cyan-500/10 blur-xl rounded-full"></div>
                           <ArrowRight className="w-8 h-8 opacity-50 relative z-10" />
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <p className="text-[10px] font-mono uppercase tracking-[0.3em] opacity-70">Awaiting Signal</p>
                          <div className="flex gap-1">
                             <span className="w-1 h-1 bg-cyan-900 animate-pulse"></span>
                             <span className="w-1 h-1 bg-cyan-900 animate-pulse" style={{ animationDelay: '0.2s' }}></span>
                             <span className="w-1 h-1 bg-cyan-900 animate-pulse" style={{ animationDelay: '0.4s' }}></span>
                          </div>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="content"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                        className="w-full h-full relative z-10"
                      >
                        <div className="w-full h-full relative z-10 flex flex-col gap-4 overflow-y-auto minimal-scrollbar">
                          {promptCount > 1 ? (
                            output.split(/### \[PROMPT_ENTRY_\d+\]/).filter(p => p.trim() !== '').map((entry, idx) => (
                              <div key={idx} className={`border rounded-lg p-4 flex flex-col gap-2 group/entry transition-colors ${featureMode === 'image_prompt' ? 'bg-purple-950/10 border-purple-900/30 hover:border-purple-500/30' : 'bg-cyan-950/10 border-cyan-900/30 hover:border-cyan-500/30'}`}>
                                <div className="flex justify-between items-center mb-1">
                                  <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded ${featureMode === 'image_prompt' ? 'bg-purple-950/30 text-purple-700' : 'bg-cyan-950/30 text-cyan-700'}`}>Entry {idx + 1}</span>
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(entry.trim());
                                      // Trigger a local toast or just use a visual cue
                                    }}
                                    className="text-[9px] text-cyan-600 hover:text-cyan-400 font-mono uppercase tracking-widest flex items-center gap-1.5 opacity-0 group-hover/entry:opacity-100 transition-opacity"
                                  >
                                    <Copy className="w-3 h-3" />
                                    Copy
                                    <span className="ml-1 opacity-60">({entry.trim().length} chars)</span>
                                  </button>
                                </div>
                                <textarea
                                  readOnly
                                  value={entry.trim()}
                                  className="w-full bg-transparent border-none outline-none resize-none text-cyan-100 font-mono text-sm leading-relaxed custom-scrollbar h-32 focus:ring-0"
                                />
                              </div>
                            ))
                          ) : (
                            <textarea
                              readOnly
                              value={output}
                              className="w-full h-full bg-transparent border-none outline-none resize-none text-cyan-100 font-mono custom-scrollbar focus:ring-0"
                              placeholder=""
                            />
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                )}

                {isGenerating && !output && (
                  <div className="absolute inset-0 bg-[#050505]/80 backdrop-blur-sm flex items-center justify-center z-20">
                    <div className="flex flex-col items-center gap-6 bg-cyan-950/20 px-8 py-6 rounded-xl border border-cyan-500/20 shadow-[0_0_30px_rgba(6,182,212,0.1)] relative overflow-hidden">
                      {/* Scanning line */}
                      <div className="absolute top-0 left-0 right-0 h-[2px] bg-cyan-400 shadow-[0_0_10px_rgba(6,182,212,1)] animate-[scan-vertical_2s_ease-in-out_infinite]"></div>

                      <div className="w-12 h-12 flex items-center justify-center relative">
                         <div className="absolute inset-0 border-2 border-cyan-500/20 rounded-full"></div>
                         <div className="absolute inset-0 border-2 border-transparent border-t-cyan-400 rounded-full animate-spin"></div>
                         <Activity className="w-5 h-5 text-cyan-400" />
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-cyan-400 text-[10px] font-mono tracking-[0.2em] uppercase">Synthesizing Prompt</span>
                        <div className="w-32 h-1 bg-cyan-950 rounded-full overflow-hidden">
                           <div className="h-full bg-cyan-500 w-1/2 rounded-full animate-[progress_1s_ease-in-out_infinite_alternate]"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* Footer Status Bar */}
      <footer className="h-8 bg-[#050505] border-t border-cyan-900/50 px-6 flex items-center justify-between text-[9px] text-cyan-600 shrink-0 z-20 font-mono tracking-widest relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/3 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent"></div>
        <div className="flex gap-6 items-center">
          <span className="flex items-center gap-2">
            STATUS: <span className={isGenerating ? "text-cyan-400 animate-pulse" : "text-cyan-600"}>{isGenerating ? 'PROCESSING' : 'IDLE'}</span>
          </span>
          <span className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-cyan-400 shadow-[0_0_5px_rgba(6,182,212,0.8)] animate-pulse"></span> SYSTEM_ONLINE</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-sm bg-[#050505] border border-cyan-500 shadow-[0_0_5px_rgba(6,182,212,0.5)]"></span> ENGINE: {(selectedTextModel ? selectedTextModelLabel : (isUnavailableHistoricalModel ? 'UNAVAILABLE MODEL' : 'NO TEXT MODEL')).toUpperCase()}</span>
          {lastSaved && (
            <span className="hidden sm:flex items-center gap-1.5 opacity-50">
              <RefreshCw className="w-2.5 h-2.5" /> SYNCED: {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div className="flex gap-4">
          <span className="text-cyan-400/80 font-bold uppercase tracking-widest">{featureMode === 'prompt' ? `${mode} MODE` : featureMode === 'reverse' ? 'REVERSE-ENGINE' : 'VISUAL-EDITOR'}</span>
        </div>
      </footer>

      {/* Mention Popup */}
      <AnimatePresence>
        {showMentions && filteredMentions.length > 0 && (
          <motion.div
            ref={mentionPopupRef}
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            style={{
              top: `${mentionCursorPos.top}px`,
              left: `${mentionCursorPos.left}px`,
            }}
            className="fixed z-[100] flex items-start"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="w-64 bg-[#0a0a0a] border border-cyan-500/30 rounded shadow-[0_0_30px_rgba(6,182,212,0.4)] max-h-48 overflow-y-auto minimal-scrollbar flex flex-col shrink-0">
              <div className="p-2 border-b border-cyan-900/50 bg-cyan-950/20 text-[9px] font-mono text-cyan-500 tracking-widest uppercase sticky top-0 backdrop-blur-md z-10">Select Attachment</div>
              {filteredMentions.map((att, idx) => (
                <div
                  key={idx}
                  className={`p-2 flex items-center gap-2 cursor-pointer transition-colors border-b border-cyan-900/20 last:border-0 ${idx === mentionListIndex ? 'bg-cyan-900/50 text-cyan-200' : 'text-cyan-400 hover:bg-cyan-950/40'}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    insertMention(att.indexLabel.substring(1));
                  }}
                  onMouseEnter={() => setMentionListIndex(idx)}
                >
                  <Paperclip className="w-3 h-3 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-mono text-cyan-200">{att.indexLabel}</span>
                    <span className="text-[8px] font-mono opacity-50 truncate max-w-[180px]">{att.name}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Hover Preview Panel */}
            {filteredMentions[mentionListIndex] && (
              <div className="ml-2 w-48 bg-[#0a0a0a] border border-cyan-500/30 rounded shadow-[0_0_30px_rgba(6,182,212,0.4)] flex flex-col hidden sm:flex shrink-0">
                <div className="p-2 border-b border-cyan-900/50 bg-cyan-950/20 text-[9px] font-mono text-cyan-500 tracking-widest uppercase">Preview</div>
                <div className="p-2 flex items-center justify-center min-h-[120px] bg-cyan-950/10">
                  {filteredMentions[mentionListIndex].mimeType.startsWith('image/') ? (
                      <img
                        src={`data:${filteredMentions[mentionListIndex].mimeType};base64,${filteredMentions[mentionListIndex].data}`}
                        alt="Preview"
                        className="max-w-full max-h-32 object-contain rounded shadow-md"
                      />
                  ) : filteredMentions[mentionListIndex].mimeType.startsWith('video/') ? (
                      <video
                        src={`data:${filteredMentions[mentionListIndex].mimeType};base64,${filteredMentions[mentionListIndex].data}`}
                        className="max-w-full max-h-32 rounded shadow-md"
                        muted
                        autoPlay
                        loop
                      />
                  ) : filteredMentions[mentionListIndex].mimeType.startsWith('audio/') ? (
                      <div className="flex flex-col items-center">
                        <Activity className="w-6 h-6 text-cyan-400 mb-2 animate-pulse" />
                        <span className="text-[8px] text-cyan-600 font-mono text-center truncate w-full px-2" title={filteredMentions[mentionListIndex].name}>{filteredMentions[mentionListIndex].name}</span>
                      </div>
                  ) : (
                      <div className="flex flex-col items-center">
                        <FileText className="w-6 h-6 text-cyan-600 mb-2" />
                        <span className="text-[8px] text-cyan-600 font-mono text-center truncate w-full px-2" title={filteredMentions[mentionListIndex].name}>{filteredMentions[mentionListIndex].name}</span>
                      </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attachment Preview Modal */}
      <AnimatePresence>
        {previewAttachment && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8 bg-[#050505]/90 backdrop-blur-md"
            onClick={() => setPreviewAttachment(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ duration: 0.2, type: "spring", damping: 25, stiffness: 300 }}
              className="bg-[#050505] border border-cyan-900/50 rounded-lg shadow-[0_0_50px_rgba(6,182,212,0.15)] flex flex-col w-full max-w-5xl max-h-full overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-3 lg:p-4 border-b border-cyan-900/50 shrink-0 bg-cyan-950/20 relative">
                <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-cyan-500/50 via-transparent to-transparent"></div>
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-8 h-8 rounded shrink-0 bg-cyan-950 flex items-center justify-center border border-cyan-800/50">
                     <Paperclip className="w-4 h-4 text-cyan-400" />
                  </div>
                  <h3 className="text-sm font-mono tracking-wide text-cyan-100 truncate">{previewAttachment.name}</h3>
                </div>
                <button
                  onClick={() => setPreviewAttachment(null)}
                  className="p-2 rounded bg-cyan-950/30 hover:bg-red-950/50 hover:border-red-500/50 border border-cyan-900/50 text-cyan-500 hover:text-red-400 transition-all shrink-0 group"
                >
                  <X className="w-4 h-4 group-hover:scale-110 transition-transform" />
                </button>
              </div>

              <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-black relative minimal-scrollbar min-h-[300px]">
                {/* Subtle grid background for preview area */}
                <div className="absolute inset-0 z-0 opacity-10 pointer-events-none"
                  style={{
                    backgroundImage: 'linear-gradient(to right, #082f49 1px, transparent 1px), linear-gradient(to bottom, #082f49 1px, transparent 1px)',
                    backgroundSize: '20px 20px'
                  }}>
                </div>

                <div className="relative z-10 w-full flex justify-center">
                  {previewAttachment.mimeType.startsWith('image/') ? (
                     <img
                        src={`data:${previewAttachment.mimeType};base64,${previewAttachment.data}`}
                        alt={previewAttachment.name}
                        className="max-w-full max-h-[75vh] object-contain rounded border border-cyan-900/30 shadow-2xl"
                     />
                  ) : previewAttachment.mimeType.startsWith('video/') ? (
                     <video
                        src={`data:${previewAttachment.mimeType};base64,${previewAttachment.data}`}
                        className="max-w-full max-h-[75vh] rounded border border-cyan-900/30 shadow-2xl"
                        controls
                        autoPlay
                     />
                  ) : previewAttachment.mimeType.startsWith('audio/') ? (
                     <div className="flex flex-col items-center justify-center p-8 bg-cyan-950/10 rounded-lg border border-cyan-500/20 w-full max-w-lg">
                        <Activity className="w-12 h-12 text-cyan-400 mb-4 animate-pulse" />
                        <audio
                           src={`data:${previewAttachment.mimeType};base64,${previewAttachment.data}`}
                           className="w-full h-10"
                           controls
                           autoPlay
                        />
                        <p className="mt-4 text-[10px] text-cyan-600 font-mono tracking-widest">{previewAttachment.name}</p>
                     </div>
                  ) : (
                     <div className="flex flex-col items-center justify-center py-20 px-8 text-cyan-800 text-center border border-cyan-900/30 rounded-lg bg-cyan-950/10">
                        <div className="w-24 h-24 bg-cyan-950/50 rounded-full flex items-center justify-center mb-6 border border-cyan-800/50 shadow-[0_0_30px_rgba(6,182,212,0.1)] relative">
                          <div className="absolute inset-0 rounded-full border border-cyan-500/20 animate-ping opacity-20"></div>
                          <Paperclip className="w-10 h-10 text-cyan-600" />
                        </div>
                        <p className="text-lg font-mono tracking-widest uppercase text-cyan-300 mb-3">Preview Unsupported</p>
                        <p className="text-sm font-mono text-cyan-700/80 mb-6 max-w-md leading-relaxed">Direct visualization of {previewAttachment.mimeType || 'this dataset'} is currently unavailable in the visualizer module.</p>
                        <p className="text-[10px] uppercase tracking-[0.2em] px-4 py-2 bg-[#050505] rounded border border-cyan-900/50 text-cyan-500 font-mono">FILE: {previewAttachment.name}</p>
                     </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom API Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-[#050505]/95 backdrop-blur-md"
            ></motion.div>

            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-lg bg-[#0c0e12] border border-cyan-500/30 rounded-xl shadow-[0_0_50px_rgba(6,182,212,0.1)] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6 border-b border-cyan-900/30 flex justify-between items-center bg-cyan-950/5">
                <div>
                  <h2 className="text-lg font-mono font-bold text-cyan-400 tracking-[0.2em] flex items-center gap-3 uppercase">
                    <Settings className="w-5 h-5 text-cyan-400 animate-pulse" /> Model Priority Sequence
                  </h2>
                  <p className="text-[10px] text-cyan-600 font-mono mt-1 uppercase tracking-wider">智能模型与优先推荐级别配置 (Model Sequence Cascade)</p>
                </div>
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="p-2 hover:bg-cyan-900/20 rounded-full transition-colors text-cyan-600 hover:text-cyan-400"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-8 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                {/* 1. Model Engine Selection */}
                <div className="space-y-4">
                  <label className="text-[10px] font-mono text-cyan-400 uppercase tracking-[0.2em] flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5" /> Cascade Configuration (推荐级与退避选择)
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    <select
                      value={selectedTextModel?.id || 'default'}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        if (!nextId || nextId === 'default' || UNAVAILABLE_GEMINI_MODELS.has(nextId)) return;
                        handleActiveApiChange(nextId);
                        handleModelChange('custom');
                      }}
                      className="w-full bg-[#050505] border border-cyan-900/50 rounded px-4 py-3.5 text-xs font-mono text-cyan-100 focus:border-cyan-500 outline-none transition-all appearance-none cursor-pointer hover:bg-cyan-950/20"
                    >
                      {!selectedTextModel && UNAVAILABLE_GEMINI_MODELS.has(selectedModel) && (
                        <option value={selectedModel}>该模型已不可用，请重新选择</option>
                      )}
                      {!user && <option value="default">请先登录后加载文字生成模型</option>}
                      {user && isTextModelsLoading && <option value="default">正在加载文字生成模型...</option>}
                      {user && !isTextModelsLoading && textModelOptions.length === 0 && <option value="default">暂无可用 TEXT_GENERATOR 模型</option>}
                      {textModelOptions.map((model) => (
                        <option key={model.id} value={model.id}>{getTextModelDisplayName(model)}</option>
                      ))}
                    </select>
                    {textModelsError && (
                      <p className="text-[10px] text-red-400 font-mono">模型列表加载失败，请确认登录状态或后端服务。</p>
                    )}
                    {isUnavailableHistoricalModel && (
                      <p className="text-[10px] text-amber-300 font-mono">该模型已不可用，请重新选择。</p>
                    )}
                  </div>
                </div>

                {/* Info block explaining integration with top-right settings */}
                <div className="pt-4 border-t border-cyan-900/20 space-y-4">
                  <div className="p-4 rounded-xl bg-[#07090e] border border-cyan-500/10 space-y-3">
                    <span className="block text-[10px] text-cyan-400 font-bold tracking-widest font-mono uppercase">
                      💡 智能联动说明 Neural Route Dispatcher
                    </span>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      本模块设置的运行引擎会自动对接到右上角的 <strong className="text-cyan-400">UNIFIED PROXY API CONTROLS (全局API控制)</strong>。专门针对其中的 <strong className="text-cyan-400 font-mono">TEXT GENERATOR (文字生成类别)</strong> 接口。
                    </p>
                    <p className="text-[11px] text-zinc-400 leading-relaxed mt-2 border-t border-white/5 pt-2">
                      这里展示的是后端已启用的文字生成模型。执行时只发送模型 ID，由后端读取 baseUrl、modelName 和密钥并完成代理调用；如果历史模型已停用或删除，系统会要求重新选择，不会自动降级到其他模型。
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-black border-t border-cyan-900/30 flex justify-end gap-4">
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="text-[10px] text-cyan-900 hover:text-cyan-600 font-mono uppercase transition-colors px-4 py-2"
                >
                  Discard
                </button>
                <button
                  onClick={() => {
                    setStatusText(user ? 'ACCOUNT_SYNCED' : 'BANK_SYNCED');
                    setTimeout(() => {
                      setIsSettingsOpen(false);
                      setStatusText('');
                    }, 1000);
                  }}
                  className="bg-cyan-950/50 hover:bg-cyan-900/60 text-cyan-100 text-[10px] font-mono uppercase px-8 py-2 rounded border border-cyan-500/50 transition-all flex items-center gap-2 group shadow-[0_0_15px_rgba(6,182,212,0.1)]"
                >
                  <Save className="w-3.5 h-3.5 group-hover:scale-110 transition-transform text-cyan-400" />
                  {statusText === 'ACCOUNT_SYNCED' ? 'Cloud Link Secured' : (statusText === 'BANK_SYNCED' ? 'Neural Link Ready' : 'Apply Priorities')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Style Lab Modal */}
      <AnimatePresence>
        {isStylesModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsStylesModalOpen(false)}
              className="absolute inset-0 bg-[#050505]/95 backdrop-blur-md"
            ></motion.div>

            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-4xl h-[80vh] bg-[#0c0e12] border border-purple-500/30 rounded-xl shadow-[0_0_50px_rgba(168,85,247,0.2)] flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-purple-900/30 flex justify-between items-center shrink-0">
                <div>
                  <h2 className="text-lg font-mono font-bold text-purple-300 tracking-[0.2em] flex items-center gap-3">
                    <Fingerprint className="w-5 h-5" /> STYLE GENE SEQUENCER
                  </h2>
                  <p className="text-xs text-purple-600 font-mono mt-1 uppercase tracking-wider">定义技术表现手法与艺术风格基因 (Techniques & Styles)</p>
                </div>
                <button
                  onClick={() => setIsStylesModalOpen(false)}
                  className="p-2 hover:bg-purple-900/20 rounded-full transition-colors text-purple-500 hover:text-purple-300"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Styles Grid with Categories */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-8 custom-scrollbar space-y-12">
                {/* Technical Manifestation Section */}
                <section>
                  <div className="flex items-center justify-between mb-6 border-b border-purple-900/20 pb-2">
                    <h3 className="text-[12px] font-bold text-purple-400 uppercase tracking-[0.3em] flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5" /> 1. 技术表现手法 (TECHNICAL)
                    </h3>
                    <span className="text-[9px] text-purple-900 font-mono">MULTI-SELECT SUPPORTED</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {TECHNICAL_TECHNIQUES.map((tech) => (
                      <button
                        key={tech.id}
                        onClick={() => toggleTechnique(tech.id)}
                        className={`group relative rounded-xl overflow-hidden border-2 transition-all duration-300 h-32 sm:h-40 ${selectedTechniques.includes(tech.id) ? 'border-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.3)]' : 'border-purple-900/40 hover:border-purple-500/60'}`}
                      >
                        <img
                          src={tech.preview}
                          alt={tech.label}
                          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                        />
                        <div className={`absolute inset-0 transition-all duration-300 flex items-center justify-center p-4 ${selectedTechniques.includes(tech.id) ? 'bg-purple-900/30 backdrop-blur-[2px]' : 'bg-[#050505]/60 group-hover:bg-[#050505]/30'}`}>
                          <span className="text-sm sm:text-base font-bold text-white uppercase tracking-[0.2em] text-center drop-shadow-lg drop-shadow-black">{tech.label}</span>
                        </div>
                        {selectedTechniques.includes(tech.id) && (
                          <div className="absolute top-3 right-3">
                            <div className="bg-purple-500 text-white p-1 rounded-full shadow-lg ring-4 ring-purple-500/20">
                              <Check className="w-3 h-3" />
                            </div>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </section>

                {/* Artistic Style Section */}
                <section>
                  <div className="flex items-center justify-between mb-6 border-b border-cyan-900/20 pb-2">
                    <h3 className="text-[12px] font-bold text-cyan-400 uppercase tracking-[0.3em] flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5" /> 2. 艺术风格基因 (ARTISTIC)
                    </h3>
                    <span className="text-[9px] text-cyan-900 font-mono">UNLIMITED COMBINATIONS</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                    {ART_STYLES.map((style) => (
                      <button
                        key={style.id}
                        onClick={() => toggleStyle(style.id)}
                        className={`group relative rounded-lg overflow-hidden border transition-all duration-300 h-28 sm:h-36 ${selectedStyles.includes(style.id) ? 'border-cyan-500 shadow-[0_0_15px_rgba(6,185,212,0.3)]' : 'border-cyan-900/40 hover:border-cyan-500/60'}`}
                      >
                        <img
                          src={style.preview}
                          alt={style.label}
                          className={`w-full h-full object-cover transition-all duration-500 ${selectedStyles.includes(style.id) ? 'scale-105' : 'grayscale group-hover:grayscale-0'}`}
                        />
                        <div className={`absolute inset-0 transition-all duration-300 flex items-center justify-center p-2 text-center ${selectedStyles.includes(style.id) ? 'bg-cyan-900/40 backdrop-blur-[1px]' : 'bg-[#050505]/70 group-hover:bg-cyan-900/30'}`}>
                          <span className="text-[11px] sm:text-xs font-bold text-white uppercase tracking-[0.15em] leading-tight drop-shadow-md drop-shadow-black">{style.label}</span>
                        </div>
                        {selectedStyles.includes(style.id) && (
                          <div className="absolute top-2 right-2">
                            <div className="w-4 h-4 bg-cyan-500 text-black rounded-full flex items-center justify-center shadow-lg border border-cyan-300/50">
                              <Check className="w-2.5 h-2.5" strokeWidth={3} />
                            </div>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              </div>

              {/* Modal Footer */}
              <div className="p-4 bg-[#080a0c] border-t border-purple-900/30 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                  <div className="flex -space-x-2">
                    {[...selectedTechniques, ...selectedStyles].slice(0, 5).map((id, i) => {
                      const item = [...TECHNICAL_TECHNIQUES, ...ART_STYLES].find(x => x.id === id);
                      return item ? (
                        <div key={i} className="w-6 h-6 rounded-full border border-purple-950 overflow-hidden bg-purple-900">
                          <img src={item.preview} className="w-full h-full object-cover" alt="" title={item.label} />
                        </div>
                      ) : null;
                    })}
                    {([...selectedTechniques, ...selectedStyles].length > 5) && (
                      <div className="w-6 h-6 rounded-full border border-purple-950 bg-purple-950 flex items-center justify-center text-[8px] font-mono text-purple-400">
                        +{([...selectedTechniques, ...selectedStyles].length - 5)}
                      </div>
                    )}
                  </div>
                  <p className="text-[9px] text-purple-800 font-mono uppercase tracking-widest">
                    {([...selectedTechniques, ...selectedStyles].length)} GENETIC GEOMETRIES SELECTED
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setSelectedTechniques([]); setSelectedStyles([]); }}
                    className="text-[10px] text-purple-900 hover:text-purple-600 font-mono uppercase transition-colors px-3 py-1.5"
                  >
                    Reset Gear
                  </button>
                  <button
                    onClick={() => setIsStylesModalOpen(false)}
                    className="bg-purple-900/50 hover:bg-purple-800/60 text-purple-100 text-[10px] font-mono uppercase px-6 py-1.5 rounded border border-purple-500/50 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)]"
                  >
                    Initialize DNA
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom styles */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes scan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(50%); }
        }
        @keyframes scan-vertical {
          0% { top: 0; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        @keyframes progress {
          0% { width: 0%; }
          100% { width: 100%; }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
          height: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(6, 182, 212, 0.02);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(6, 182, 212, 0.2);
          border-radius: 2px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(6, 182, 212, 0.5);
        }
        .minimal-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .minimal-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .minimal-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(6, 182, 212, 0.2);
          border-radius: 4px;
        }
        .minimal-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(6, 182, 212, 0.4);
        }
      `}} />
    </div>
  );
}
