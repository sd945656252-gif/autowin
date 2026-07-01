import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CanvasNode, CustomApiConfig, ProductionStage, SlashAssetResolveResult } from '../../types';
import { Video, Settings, Trash2, Loader2, PlayCircle, AlertTriangle, Play, Sliders, ChevronDown, Sparkles, Maximize2, Download, Upload, Save, UploadCloud, Link2 } from 'lucide-react';
import { resolveVideoConfig } from '../../utils/videoConfig';
import { motion, AnimatePresence } from 'motion/react';
import { downloadMedia } from '../../utils/download';
import { useTempMedia } from '../../hooks/useTempMedia';
import { makeUrlPermanent } from '../../utils/persistence';
import { isStaleProductionAssetError, notifyProductionAssetsChanged, staleProductionAssetMessage } from '../../utils/productionAssetErrors';
import MediaZoomOverlay from '../MediaZoomOverlay';
import ExpandedPromptOverlay from '../ExpandedPromptOverlay';
import MentionEditor from '../MentionEditor';
import MediaThumbnail from '../MediaThumbnail';
import { createProductionAsset, fetchModelCapabilities, submitProductionAssetReview } from '../../lib/db';
import SlashAssetPicker from '../SlashAssetPicker';
import { mediaAssetIdFromUrl, pollWorkflowTaskStatus } from './workflowNodeUtils';

interface VideoGeneratorNodeProps {
  node: CanvasNode;
  userRole: 'ADMIN' | 'DEVELOPER' | 'USER';
  isSelected: boolean;
  onUpdate: (updatedFields: Partial<CanvasNode> | ((node: CanvasNode) => Partial<CanvasNode>)) => void;
  onDelete: (e: React.MouseEvent) => void;
  onSelect: (e: React.MouseEvent) => void;
  onSubmitReview?: (e: React.MouseEvent) => void;
  apiConfigs?: CustomApiConfig[];
  currentProjectId?: string | null;
  productionStage?: ProductionStage;
}

function mediaKindFromMime(mimeType?: string | null): 'image' | 'video' | 'audio' | null {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.startsWith('audio/')) return 'audio';
  return null;
}

function staleAssetIdFromError(error: unknown) {
  const details = (error as { details?: { assetId?: unknown } } | null | undefined)?.details;
  return details?.assetId ? String(details.assetId) : null;
}

export default function VideoGeneratorNode({
  node,
  userRole,
  isSelected,
  onUpdate,
  onDelete,
  onSelect,
  onSubmitReview,
  apiConfigs = [],
  currentProjectId,
  productionStage = 'SHOT_04'
}: VideoGeneratorNodeProps) {
  const queryClient = useQueryClient();
  const [isPlaying, setIsPlaying] = useState(false);
  const [showAdvancedMenu, setShowAdvancedMenu] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [magnifiedMedia, setMagnifiedMedia] = useState<{ src: string; type: 'image' | 'video' } | null>(null);
  const [isExpandedPrompt, setIsExpandedPrompt] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastAutoRunKeyRef = useRef<string | null>(null);

  // Available API configs for this node type
  const availableConfigs = apiConfigs?.filter(c => c.type === 'video') || [];
  const configLabel = (config?: CustomApiConfig | null) => String(config?.displayName || config?.alias || config?.modelName || config?.id || '').trim();

  // State defaults for the node
  const currentSelectValue = node.selected_api_id || (availableConfigs.length > 0 ? availableConfigs[0].id : '');
  const currentModel = node.model || (availableConfigs.length > 0 ? configLabel(availableConfigs[0]) : '');
  const currentPrompt = node.prompt || '';
  const scene3dVisualPromptParts = [
    node.scene3dMotionPrompt ? `Scene3D motion plan: ${node.scene3dMotionPrompt}` : '',
    node.scene3dMoodPrompt ? `Scene3D mood: ${node.scene3dMoodPrompt}` : '',
    node.scene3dRenderStylePrompt ? `Scene3D render style: ${node.scene3dRenderStylePrompt}` : '',
    node.scene3dVisualContext ? `Scene3D visual context: ${JSON.stringify(node.scene3dVisualContext).slice(0, 2000)}` : ''
  ].filter(Boolean);
  const executionPrompt = [currentPrompt, ...scene3dVisualPromptParts].filter(Boolean).join('\n\n');
  const useCustomApi = !!node.use_custom_api;
  const customModel = node.custom_model || '';
  const rawGeneratedMedia = node.generated_media || '';
  const resolvedTempMedia = useTempMedia(rawGeneratedMedia === '[LOCAL_CACHE_ONLY]' ? undefined : rawGeneratedMedia);
  const generatedMedia = rawGeneratedMedia === '[LOCAL_CACHE_ONLY]' ? resolvedTempMedia : (resolvedTempMedia || rawGeneratedMedia);
  const generatedMediaAssetId = node.generated_media_asset_id || mediaAssetIdFromUrl(rawGeneratedMedia) || mediaAssetIdFromUrl(generatedMedia) || undefined;
  const isLoading = !!node.isLoading;
  const nodeError = node.error || '';
  const [assetSavingMode, setAssetSavingMode] = useState<'save' | 'submit' | null>(null);
  const [assetSaveMessage, setAssetSaveMessage] = useState('');
  const [staleMediaAssetIds, setStaleMediaAssetIds] = useState<Set<string>>(new Set());

  const handleFieldChange = (fields: Partial<CanvasNode> | ((node: CanvasNode) => Partial<CanvasNode>)) => {
    onUpdate(fields);
  };

  const markStaleReferenceAsset = (assetId: string | null) => {
    setStaleMediaAssetIds((prev) => {
      const next = new Set(prev);
      if (assetId) {
        next.add(assetId);
      } else {
        uploadedFiles.forEach((file) => {
          if (file.assetId) next.add(file.assetId);
        });
      }
      return next;
    });
  };

  const clearStaleReferenceAssets = () => {
    const nextList = uploadedFiles.filter((file) => !file.assetId || !staleMediaAssetIds.has(file.assetId));
    const modeUpdates = adjustGenerationModeAndFields(nextList);
    setStaleMediaAssetIds(new Set());
    handleFieldChange({
      video_media_list: nextList,
      ...modeUpdates,
      error: nextList.length === uploadedFiles.length ? node.error : ''
    });
    setSlashImportMessage(nextList.length === uploadedFiles.length ? '当前没有可移除的失效参考素材。' : '已移除失效参考素材，请重新选择。');
    window.setTimeout(() => setSlashImportMessage(''), 2600);
  };

  const refreshStaleProductionAssets = (reason: string) => {
    queryClient.invalidateQueries({ queryKey: ['production-assets'] });
    queryClient.invalidateQueries({ queryKey: ['slash-assets'] });
    notifyProductionAssetsChanged({ reason, nodeId: node.id, stage: productionStage });
  };


  const activeCustomConfig = apiConfigs.find(c =>
    c.type === 'video' &&
    (c.id === node.selected_api_id ||
     (customModel && c.modelName === customModel) ||
     configLabel(c).toLowerCase() === currentModel.trim().toLowerCase() ||
     c.id === currentModel)
  );
  const { data: videoCapabilities = [] } = useQuery({
    queryKey: ['model-capabilities', 'VIDEO_GENERATOR'],
    queryFn: () => fetchModelCapabilities('VIDEO_GENERATOR'),
    staleTime: 0
  });
  const activeCapability = activeCustomConfig?.capabilityProfile || (activeCustomConfig?.canonicalModelId
    ? videoCapabilities.find((item) => item.canonicalModelId === activeCustomConfig.canonicalModelId)
    : null);
  const capabilityParams = activeCapability?.videoCapabilities;
  const capabilityExecutable = activeCapability ? activeCapability.executable : false;
  const capabilityWarning = activeCustomConfig && activeCapability && !capabilityExecutable
    ? '该模型尚未完成官方参数验证，不能执行生成任务。'
    : activeCustomConfig && !activeCapability
      ? '该模型尚未绑定后端能力模板，不能执行生成任务。'
      : '';

  // Resolve config dynamically to respect native model rules
  const videoConfig = resolveVideoConfig(currentModel, useCustomApi, activeCustomConfig ? activeCustomConfig.modelName : '', activeCustomConfig ? configLabel(activeCustomConfig) : '', activeCustomConfig ? {
    ...(activeCustomConfig.metadata || {}),
    ...(capabilityParams ? {
      minDuration: Math.min(...(capabilityParams.controls?.duration || [4]).filter((value) => value > 0)),
      maxDuration: Math.max(...(capabilityParams.controls?.duration || [10])),
      defaultDuration: capabilityParams.controls?.duration?.[0] ?? 5,
      durations: capabilityParams.controls?.duration,
      resolutions: capabilityParams.controls?.resolution,
      ratios: capabilityParams.controls?.aspectRatio,
      hasAudio: capabilityParams.controls?.generateAudio,
      supportedInputTypes: [
        capabilityParams.inputSlots?.referenceImages?.enabled ? 'image' : null,
        capabilityParams.inputSlots?.sourceVideo?.enabled ? 'video' : null,
        capabilityParams.inputSlots?.audio?.enabled ? 'audio' : null
      ].filter(Boolean),
      maxFiles: (capabilityParams.limits?.maxInputImages || 0) + (capabilityParams.limits?.maxInputVideos || 0) + (capabilityParams.limits?.maxInputAudios || 0),
      supportsFirstAndLastFrame: !!(capabilityParams.inputSlots?.firstFrame?.enabled && capabilityParams.inputSlots?.lastFrame?.enabled),
      supportsAllInOneReference: !!capabilityParams.inputSlots?.referenceImages?.enabled,
      description: `${activeCapability?.verificationStatus || 'UNVERIFIED'} capability profile`
    } : {})
  } : undefined);

  // States for reference uploads, file list, and drag & drop
  const [isUploading, setIsUploading] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashButtonRef = useRef<HTMLButtonElement>(null);
  const [slashPickerAnchor, setSlashPickerAnchor] = useState<{ top: number; left: number } | null>(null);
  const [slashImportMessage, setSlashImportMessage] = useState('');

  const uploadedFiles = node.video_media_list || [];
  const maxFiles = videoConfig.maxFiles || 6;
  const isUploadDisabled = uploadedFiles.length >= maxFiles;
  const staleUploadedFilesCount = uploadedFiles.filter((file) => file.assetId && staleMediaAssetIds.has(file.assetId)).length;
  const hasStaleUploadedFiles = staleUploadedFilesCount > 0;

  const currentMode = node.video_generation_mode || 'text_to_video';
  const imagesCount = uploadedFiles.filter(f => f.type === 'image').length;
  const hasVideoOrAudio = uploadedFiles.some(f => f.type === 'video' || f.type === 'audio');
  const canToggleManually = imagesCount === 2 && !hasVideoOrAudio && videoConfig.supportsFirstAndLastFrame;
  const needsModeChoice = currentMode === 'needs_user_choice';
  const modeLabel = currentMode === 'text_to_video'
    ? '纯文生视频'
    : currentMode === 'image_to_video'
      ? '图生视频'
      : currentMode === 'first_last_frame'
        ? '首尾帧模式'
        : currentMode === 'reference_to_video' || currentMode === 'all_in_one_reference'
          ? '参考图生成视频'
          : currentMode === 'video_edit'
            ? '视频编辑'
            : '需要选择模式';
  const modeReason = needsModeChoice
    ? '检测到 2 张图片，需明确选择“首尾帧”或“参考图”，系统不会静默猜测。'
    : hasVideoOrAudio
      ? '检测到视频或音频素材，后端会按素材 assetId 校验并识别模式。'
      : imagesCount > 1
        ? `检测到 ${imagesCount} 张参考图，当前按参考图生成视频处理。`
        : imagesCount === 1
          ? '检测到 1 张图片，当前按图生视频处理。'
          : '未检测到参考素材，当前按文生视频处理。';

  // Media helper for retrieving durations
  const formatDurationFromMs = (durationMs: number) => {
    const sec = Math.max(0, Math.round(durationMs / 1000));
    const minutes = Math.floor(sec / 60);
    const seconds = sec % 60;
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const getMediaDuration = (url: string, type: 'video' | 'audio'): Promise<string> => {
    return new Promise((resolve) => {
      const element = document.createElement(type);
      element.src = url;
      element.preload = 'metadata';
      element.onloadedmetadata = () => {
        if (Number.isFinite(element.duration) && element.duration > 0) {
          resolve(formatDurationFromMs(element.duration * 1000));
          return;
        }
        resolve(type === 'video' ? '0:05' : '0:10');
      };
      element.onerror = () => {
        resolve(type === 'video' ? '0:05' : '0:10');
      };
      setTimeout(() => resolve(type === 'video' ? '0:05' : '0:10'), 4000);
    });
  };

  // Adjust generator mode based on current uploads
  const adjustGenerationModeAndFields = (files: NonNullable<CanvasNode['video_media_list']>): { video_generation_mode: NonNullable<CanvasNode['video_generation_mode']>; videoInputs: CanvasNode['videoInputs'] } => {
    const imgsCount = files.filter(f => f.type === 'image').length;
    const hasVOrA = files.some(f => f.type === 'video' || f.type === 'audio');
    const imageAssetIds = files.filter(f => f.type === 'image' && f.assetId).map(f => f.assetId!)
    const firstVideo = files.find(f => f.type === 'video' && f.assetId)?.assetId;
    const firstAudio = files.find(f => f.type === 'audio' && f.assetId)?.assetId;
    const baseInputs: CanvasNode['videoInputs'] = {
      referenceImageAssetIds: imageAssetIds,
      sourceVideoAssetId: firstVideo,
      audioAssetId: firstAudio
    };
    
    if (files.length === 0) {
      return { video_generation_mode: 'text_to_video', videoInputs: { referenceImageAssetIds: [] } };
    }
    if (imgsCount > 2) {
      return { video_generation_mode: 'reference_to_video', videoInputs: baseInputs };
    }
    if (hasVOrA) {
      return { video_generation_mode: firstVideo ? 'video_edit' : 'reference_to_video', videoInputs: baseInputs };
    }
    // Exactly 2 images: require explicit user choice between first-last-frame and reference mode.
    if (imgsCount === 2) {
      if (node.video_generation_mode === 'first_last_frame' && videoConfig.supportsFirstAndLastFrame) {
        return { video_generation_mode: 'first_last_frame', videoInputs: { ...baseInputs, firstFrameAssetId: imageAssetIds[0], lastFrameAssetId: imageAssetIds[1], referenceImageAssetIds: [] } };
      }
      if (node.video_generation_mode === 'reference_to_video' || node.video_generation_mode === 'all_in_one_reference') {
        return { video_generation_mode: 'reference_to_video', videoInputs: baseInputs };
      }
      return { video_generation_mode: 'needs_user_choice', videoInputs: baseInputs };
    }
    // Exactly 1 image
    return { video_generation_mode: 'image_to_video', videoInputs: { referenceImageAssetIds: imageAssetIds } };
  };

  const sanitizeVideoInputs = (mode: NonNullable<CanvasNode['video_generation_mode']>, inputs?: CanvasNode['videoInputs']): CanvasNode['videoInputs'] => {
    const safeInputs = { ...(inputs || {}) };
    const keepImage = videoConfig.supportedInputTypes.includes('image');
    const keepVideo = videoConfig.supportedInputTypes.includes('video');
    const keepAudio = videoConfig.supportedInputTypes.includes('audio');

    if (!keepImage) {
      delete safeInputs.referenceImageAssetIds;
      delete safeInputs.firstFrameAssetId;
      delete safeInputs.lastFrameAssetId;
    }
    if (!keepVideo) {
      delete safeInputs.sourceVideoAssetId;
      delete safeInputs.referenceVideoAssetId;
    }
    if (!keepAudio) {
      delete safeInputs.audioAssetId;
    }

    if (mode === 'text_to_video') {
      return { referenceImageAssetIds: [] };
    }

    if (mode === 'image_to_video') {
      const referenceImageAssetIds = keepImage ? (safeInputs.referenceImageAssetIds || []).filter(Boolean).map(String) : [];
      return {
        referenceImageAssetIds,
        firstFrameAssetId: keepImage ? (safeInputs.firstFrameAssetId || referenceImageAssetIds[0]) : undefined
      };
    }

    if (mode === 'first_last_frame') {
      return {
        referenceImageAssetIds: [],
        firstFrameAssetId: keepImage ? safeInputs.firstFrameAssetId : undefined,
        lastFrameAssetId: keepImage ? safeInputs.lastFrameAssetId : undefined
      };
    }

    if (mode === 'reference_to_video' || mode === 'all_in_one_reference') {
      return {
        referenceImageAssetIds: keepImage ? (safeInputs.referenceImageAssetIds || []).filter(Boolean).map(String) : [],
        sourceVideoAssetId: keepVideo ? safeInputs.sourceVideoAssetId : undefined,
        referenceVideoAssetId: keepVideo ? safeInputs.referenceVideoAssetId : undefined,
        audioAssetId: keepAudio ? safeInputs.audioAssetId : undefined
      };
    }

    if (mode === 'video_edit') {
      return {
        referenceImageAssetIds: keepImage ? (safeInputs.referenceImageAssetIds || []).filter(Boolean).map(String) : [],
        sourceVideoAssetId: keepVideo ? safeInputs.sourceVideoAssetId : undefined,
        referenceVideoAssetId: keepVideo ? safeInputs.referenceVideoAssetId : undefined,
        audioAssetId: keepAudio ? safeInputs.audioAssetId : undefined,
        editInstruction: safeInputs.editInstruction
      };
    }

    return safeInputs;
  };

  const pollWorkflowTask = (taskId: string, options?: { maxPollMs?: number; persistMedia?: boolean }) => {
    pollWorkflowTaskStatus({
      taskId,
      maxPollMs: options?.maxPollMs ?? 11 * 60 * 1000,
      persistMedia: options?.persistMedia,
      permanentMediaPrefix: 'video_gen',
      emptyMediaError: '视频生成任务未返回有效路径',
      timeoutError: '视频生成状态同步超时，请到配置与监控运行记录查看上游 API 或后台 worker 是否超时。',
      syncFailureError: '视频生成状态同步失败，请检查网络或后端工作流服务。',
      currentProgress: node.progress,
      currentStatusMessage: node.statusMessage,
      onUpdate
    });
  };

  const handleUploadFile = async (file: File) => {
    if (uploadedFiles.length >= maxFiles) return;

    let fileType: 'image' | 'video' | 'audio' | null = null;
    if (file.type.startsWith('image/')) {
      fileType = 'image';
    } else if (file.type.startsWith('video/')) {
      fileType = 'video';
    } else if (file.type.startsWith('audio/')) {
      fileType = 'audio';
    }

    if (!fileType) {
      handleFieldChange({ error: `Unsupported reference file type: ${file.name}` });
      return;
    }

    if (!videoConfig.supportedInputTypes.includes(fileType)) {
      handleFieldChange({ error: `The selected model does not support ${fileType} reference input.` });
      return;
    }

    setIsUploading(true);
    handleFieldChange({ error: '' });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('key', `${node.id}-${Date.now()}`);

    try {
      const res = await fetch('/api/media/upload', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData,
      });
      const data = await res.json();
      if (data.success && data.url) {
        // Update UI immediately with temp URL for efficiency
        const tempMediaItem = {
          url: data.url,
          assetId: data.assetId,
          type: fileType,
          name: file.name,
          duration: undefined,
        };
        
        const initialList = [...uploadedFiles, tempMediaItem];
        handleFieldChange({
          video_media_list: initialList,
          ...adjustGenerationModeAndFields(initialList)
        });

        // Resolve permanent storage and duration in background
        (async () => {
          try {
            const permanentUrl = await makeUrlPermanent(data.url, 'uploaded_ref');
            let durationStr: string | undefined = undefined;
            if (fileType === 'video' || fileType === 'audio') {
              durationStr = durationStr || await getMediaDuration(permanentUrl, fileType);
            }

            // Sync back to node state once ready
            handleFieldChange((prev: any) => ({
              video_media_list: (prev.video_media_list || []).map((item: any) => 
                item.url === data.url ? { ...item, url: permanentUrl, assetId: data.assetId, duration: durationStr } : item
              )
            }));
          } catch (err) {
            console.warn("Background persistence failed, relying on temp URL", err);
          }
        })();
      } else {
        handleFieldChange({ error: data.error || 'Upload failed. Please try again.' });
      }
    } catch (err) {
      console.error('File Upload Error:', err);
      handleFieldChange({ error: 'Network upload failed. Please try again later.' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteMediaItem = (itemIdx: number) => {
    const removedAssetId = uploadedFiles[itemIdx]?.assetId;
    const nextList = uploadedFiles.filter((_, idx) => idx !== itemIdx);
    const modeUpdates = adjustGenerationModeAndFields(nextList);
    if (removedAssetId) {
      setStaleMediaAssetIds((prev) => {
        const next = new Set(prev);
        next.delete(removedAssetId);
        return next;
      });
    }
    handleFieldChange({
      video_media_list: nextList,
      ...modeUpdates
    });
  };

  const openSlashPicker = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!currentProjectId || !slashButtonRef.current) return;
    const rect = slashButtonRef.current.getBoundingClientRect();
    setSlashPickerAnchor({ top: rect.bottom + 8, left: rect.left });
  };

  const importSlashAsset = async (resolved: SlashAssetResolveResult) => {
    const fileType = mediaKindFromMime(resolved.asset.mimeType);
    const streamUrl = resolved.reference?.streamUrl;
    const mediaAssetId = resolved.reference?.mediaAssetId || mediaAssetIdFromUrl(streamUrl);

    if (!fileType || !streamUrl || !mediaAssetId) {
      setSlashImportMessage('所选团队美术资产没有可用媒体文件。');
      window.setTimeout(() => setSlashImportMessage(''), 2600);
      return;
    }
    if (!videoConfig.supportedInputTypes.includes(fileType)) {
      setSlashImportMessage(`当前模型不支持 ${fileType.toUpperCase()} 参考输入。`);
      window.setTimeout(() => setSlashImportMessage(''), 2600);
      return;
    }
    if (uploadedFiles.length >= maxFiles) {
      setSlashImportMessage(`参考素材已达上限 (${maxFiles})。`);
      window.setTimeout(() => setSlashImportMessage(''), 2600);
      return;
    }

    let duration: string | undefined;
    if (fileType === 'video' || fileType === 'audio') {
      duration = await getMediaDuration(streamUrl, fileType);
    }

    const imported = {
      url: streamUrl,
      assetId: mediaAssetId,
      type: fileType,
      name: resolved.asset.displayName || resolved.asset.originalName || '团队美术资产',
      duration
    };
    const nextList = [...uploadedFiles.filter((item) => item.assetId !== mediaAssetId), imported].slice(0, maxFiles);
    setStaleMediaAssetIds((prev) => {
      const next = new Set(prev);
      next.delete(mediaAssetId);
      return next;
    });
    handleFieldChange({
      video_media_list: nextList,
      ...adjustGenerationModeAndFields(nextList),
      error: ''
    });
    setSlashImportMessage('团队美术资产已加入参考素材。');
    window.setTimeout(() => setSlashImportMessage(''), 2600);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isUploadDisabled) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDropFiles = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    if (isUploadDisabled) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const remainingSpace = maxFiles - uploadedFiles.length;
      const allowedFiles = files.slice(0, remainingSpace);
      allowedFiles.forEach(f => {
        handleUploadFile(f as any);
      });
    }
  };

  // Video parameter defaults
  const rawAspectRatio = node.aspect_ratio || '16:9';
  const currentAspectRatio = videoConfig.ratios && videoConfig.ratios.length > 0
    ? (videoConfig.ratios.includes(rawAspectRatio) ? rawAspectRatio : videoConfig.ratios[0])
    : rawAspectRatio;
  
  const durationOptions = Array.isArray(videoConfig.durations) && videoConfig.durations.length > 0
    ? videoConfig.durations
    : [];
  let currentDuration = node.video_duration || videoConfig.defaultDuration;
  if (durationOptions.length > 0) {
    currentDuration = durationOptions.includes(currentDuration) ? currentDuration : durationOptions[0];
  } else if (currentDuration < videoConfig.minDuration) {
    currentDuration = videoConfig.minDuration;
  } else if (currentDuration > videoConfig.maxDuration) {
    currentDuration = videoConfig.maxDuration;
  }

  // Ensure resolution is one of the supported ones
  let currentResolution = node.video_resolution || '720P';
  if (!videoConfig.resolutions.includes(currentResolution)) {
    currentResolution = videoConfig.resolutions[0] || '720P';
  }

  const videoControls = capabilityParams?.controls || null;
  const supportsVideoNegativePrompt = videoControls ? Boolean(videoControls.negativePrompt) : false;
  const supportsVideoSeed = videoControls ? Boolean(videoControls.seed) : false;
  const currentNegativePrompt = node.negative_prompt || '';
  const currentSeed = node.seed !== undefined ? node.seed : -1;
  const currentGenerateAudio = videoConfig.hasAudio && node.generate_audio !== false;
  const durationLabel = (duration: number) => duration === -1 ? 'Auto' : `${duration}s`;
  const effectiveVideoMode = currentMode === 'all_in_one_reference' ? 'reference_to_video' : currentMode;
  const sanitizedVideoInputs = sanitizeVideoInputs(effectiveVideoMode, node.videoInputs);
  const allowedModes = new Set(videoConfig.supportsFirstAndLastFrame
    ? ['text_to_video', 'image_to_video', 'first_last_frame', 'reference_to_video', 'video_edit', 'all_in_one_reference', 'needs_user_choice']
    : ['text_to_video', 'image_to_video', 'reference_to_video', 'video_edit', 'all_in_one_reference', 'needs_user_choice']);
  const currentModeIsAllowed = allowedModes.has(currentMode);
  const normalizedCurrentMode = currentModeIsAllowed ? currentMode : 'text_to_video';

  useEffect(() => {
    const updates: Partial<CanvasNode> = {};
    const normalized = sanitizeVideoInputs(effectiveVideoMode, node.videoInputs);
    if (JSON.stringify(normalized) !== JSON.stringify(node.videoInputs || {})) {
      updates.videoInputs = normalized;
    }
    if (!currentModeIsAllowed || (currentMode === 'first_last_frame' && !videoConfig.supportsFirstAndLastFrame)) {
      updates.video_generation_mode = normalizedCurrentMode;
    }
    if (rawAspectRatio !== currentAspectRatio) updates.aspect_ratio = currentAspectRatio;
    if (node.video_resolution !== currentResolution) updates.video_resolution = currentResolution;
    if (node.video_duration !== currentDuration) updates.video_duration = currentDuration;
    if (!supportsVideoNegativePrompt && currentNegativePrompt) updates.negative_prompt = '';
    if (!supportsVideoSeed && node.seed !== undefined) updates.seed = undefined;
    if (!videoConfig.hasAudio && node.generate_audio !== undefined) updates.generate_audio = undefined;
    if (Object.keys(updates).length > 0) handleFieldChange(updates);
  }, [effectiveVideoMode, videoConfig.supportedInputTypes.join(','), videoConfig.supportsFirstAndLastFrame, videoConfig.hasAudio, JSON.stringify(node.videoInputs || {}), currentModeIsAllowed, normalizedCurrentMode, currentMode, rawAspectRatio, currentAspectRatio, currentResolution, currentDuration, node.video_resolution, node.video_duration, supportsVideoNegativePrompt, supportsVideoSeed, currentNegativePrompt, node.seed, node.generate_audio]);

  const runGeneration = async () => {
    if (isLoading) return;

    if (hasStaleUploadedFiles) {
      onUpdate({
        assistant_auto_run_requested_at: undefined,
        assistant_auto_run_action_id: undefined,
        error: '参考素材中存在已失效项目，请移除后重新选择。'
      });
      return;
    }

    if (!currentPrompt.trim()) {
      onUpdate({
        assistant_auto_run_requested_at: undefined,
        assistant_auto_run_action_id: undefined,
        error: '请先填写提示词。'
      });
      return;
    }

    onUpdate({ isLoading: true, error: '' });

    const matchedConfig = activeCustomConfig;

    const useProxyApi = !!matchedConfig;
    if (useProxyApi && (!activeCapability || !activeCapability.executable)) {
      onUpdate({
        isLoading: false,
        assistant_auto_run_requested_at: undefined,
        assistant_auto_run_action_id: undefined,
        error: capabilityWarning || '该模型能力未验证，不能执行。'
      });
      return;
    }
    if (needsModeChoice) {
      onUpdate({
        isLoading: false,
        assistant_auto_run_requested_at: undefined,
        assistant_auto_run_action_id: undefined,
        error: '检测到 2 张图片，请先选择首尾帧模式或参考图生成视频模式。'
      });
      return;
    }
    const finalUrl = matchedConfig ? undefined : '';
    const finalKey = matchedConfig ? undefined : node.custom_key;
    const finalModel = matchedConfig ? undefined : currentModel;

    try {
      const response = await fetch('/api/workflow/execute', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          node_id: node.id,
          node_type: 'video_generator',
          model: currentModel,
          prompt: executionPrompt,
          user_role: userRole,
          use_custom_api: useProxyApi,
          custom_config_id: matchedConfig?.id,
          custom_url: finalUrl,
          custom_key: finalKey,
          custom_model: finalModel,
          video_resolution: currentResolution,
          aspect_ratio: currentAspectRatio,
          video_duration: currentDuration,
          generate_audio: currentGenerateAudio,
          negative_prompt: supportsVideoNegativePrompt ? currentNegativePrompt : undefined,
          seed: supportsVideoSeed ? currentSeed : undefined,
          video_generation_mode: effectiveVideoMode,
          video_inputs: sanitizedVideoInputs
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.error || '后端任务排队失败') as Error & { status?: number; code?: string; details?: unknown };
        error.status = response.status;
        error.code = data.code;
        error.details = data.details;
        throw error;
      }
      if (data.success && data.task_id) {
        const taskId = data.task_id;
        onUpdate({ workflow_task_id: taskId, workflow_run_id: data.run_id || undefined, statusMessage: '等待后台执行...', progress: 1 });
        pollWorkflowTask(taskId, { maxPollMs: 11 * 60 * 1000, persistMedia: true });
      } else {
        onUpdate({
          isLoading: false,
          error: data.error || '后端任务排队失败',
        });
      }
    } catch (err: any) {
      console.error('Run workflow execute failed:', err);
      if (isStaleProductionAssetError(err)) {
        markStaleReferenceAsset(staleAssetIdFromError(err));
        refreshStaleProductionAssets('video_generation_reference_stale');
        onUpdate({
          isLoading: false,
          assistant_auto_run_requested_at: undefined,
          assistant_auto_run_action_id: undefined,
          statusMessage: '参考素材已失效',
          error: staleProductionAssetMessage('生成已停止'),
        });
        return;
      }
      onUpdate({
        isLoading: false,
        error: `网络握手失败: ${err.message || err}`,
      });
    }
  };

  const handleRunGeneration = (e: React.MouseEvent) => {
    e.stopPropagation();
    void runGeneration();
  };

  useEffect(() => {
    const autoRunKey = node.assistant_auto_run_action_id || node.assistant_auto_run_requested_at;
    if (!autoRunKey || lastAutoRunKeyRef.current === autoRunKey || isLoading) return;
    lastAutoRunKeyRef.current = autoRunKey;
    onUpdate({
      assistant_auto_run_requested_at: undefined,
      assistant_auto_run_action_id: undefined
    });
    void runGeneration();
  }, [node.assistant_auto_run_action_id, node.assistant_auto_run_requested_at, isLoading]);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!generatedMedia) return;
    const filename = `${node.name || 'video'}_${node.id.slice(0, 4)}.mp4`;
    downloadMedia(generatedMedia, filename);
  };

  const handleSaveProductionAsset = async (submitReview: boolean, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!currentProjectId) {
      setAssetSaveMessage('请先选择团队项目');
      return;
    }
    if (!generatedMedia) {
      setAssetSaveMessage('请先生成视频');
      return;
    }

    setAssetSavingMode(submitReview ? 'submit' : 'save');
    setAssetSaveMessage(submitReview ? '正在保存并提审...' : '正在保存资产...');
    try {
      const mediaAssetId = generatedMediaAssetId || undefined;
      const asset = await createProductionAsset({
        projectId: currentProjectId,
        stage: productionStage,
        originalName: `${node.name || '镜头生成视频'}-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`,
        description: currentPrompt?.trim().slice(0, 500) || '画布视频生成节点产出',
        mediaAssetId,
        mimeType: mediaAssetId ? undefined : 'text/uri-list',
        sourceType: 'canvas_video_generator',
        sourceId: node.id,
        sourcePayload: {
          mediaUrl: generatedMedia,
          prompt: currentPrompt,
          executionPrompt,
          scene3dMoodPrompt: node.scene3dMoodPrompt || null,
          scene3dRenderStylePrompt: node.scene3dRenderStylePrompt || null,
          scene3dVisualContext: node.scene3dVisualContext || null,
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          model: currentModel,
          customConfigId: activeCustomConfig?.id || null,
          workflowTaskId: node.workflow_task_id || null,
          workflowRunId: node.workflow_run_id || null,
          videoInputs: node.videoInputs || null,
          videoMediaList: node.video_media_list || [],
          generatedAt: new Date().toISOString()
        },
        metadata: {
          savedFrom: 'VideoGeneratorNode',
          stageName: productionStage,
          mediaAssetId: mediaAssetId || null
        }
      });
      const finalAsset = submitReview ? await submitProductionAssetReview(asset.id) : asset;
      window.dispatchEvent(new CustomEvent('jiying:production-assets-changed', { detail: { assetId: finalAsset.id, stage: finalAsset.stage } }));
      setAssetSaveMessage(finalAsset.reviewStatus === 'IN_REVIEW' ? '已保存并提审' : '已保存到个人资产');
      window.setTimeout(() => setAssetSaveMessage(''), 2600);
    } catch (error) {
      if (isStaleProductionAssetError(error)) {
        refreshStaleProductionAssets('video_asset_save_stale');
        setAssetSaveMessage(staleProductionAssetMessage('保存资产失败'));
      } else {
        setAssetSaveMessage(error instanceof Error ? error.message : '保存资产失败');
      }
    } finally {
      setAssetSavingMode(null);
    }
  };

  useEffect(() => {
    if (!generatedMedia) return;
    const assetId = mediaAssetIdFromUrl(generatedMedia);
    if (assetId && node.generated_media_asset_id !== assetId) onUpdate({ generated_media_asset_id: assetId });
  }, [generatedMedia, node.generated_media_asset_id, onUpdate]);

  // Hover Playback Handlers
  const handleMouseEnter = () => {
    if (videoRef.current && generatedMedia) {
      videoRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(() => undefined);
    }
  };

  const handleMouseLeave = () => {
    if (videoRef.current && generatedMedia) {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  // Refs for closing dropdown on outside click
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (node.isLoading && !node.workflow_task_id) {
      onUpdate({
        isLoading: false,
        error: '旧任务缺少状态追踪 ID，请重新运行该节点。',
        statusMessage: '旧任务状态不可恢复'
      });
    }
    if (node.isLoading && node.workflow_task_id) pollWorkflowTask(node.workflow_task_id);
  }, [node.id]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement;
      // If clicking the portal or inside the portal, don't close
      if (target.closest('.settings-portal')) return;

      if (settingsRef.current && !settingsRef.current.contains(target)) {
        if (showAdvancedMenu) setShowAdvancedMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showAdvancedMenu]);

  return (
    <div
      onClick={onSelect}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDropFiles}
      className={`node-box select-none glass-panel rounded-xl border flex flex-col z-10 group relative transition-all duration-500 w-[440px] bg-zinc-950/90 backdrop-blur-2xl ${
        isSelected
          ? 'border-green-500/50 shadow-[0_0_50px_rgba(34,197,94,0.15)] ring-1 ring-green-500/20'
          : 'border-white/5 hover:border-white/10 shadow-2xl'
      }`}
    >
      {/* Drag & Drop Visual Hint Overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 bg-green-500/10 border-2 border-dashed border-green-500 rounded-xl flex flex-col items-center justify-center z-50 backdrop-blur-sm pointer-events-none transition-all duration-300">
          <div className="bg-black/90 px-4 py-3 rounded-xl border border-green-500/30 flex flex-col items-center gap-1.5 shadow-2xl">
            <Upload className="w-6 h-6 text-green-400 animate-bounce" />
            <span className="text-[11px] font-bold text-green-300 font-mono tracking-wider uppercase">松开鼠标即可上传素材</span>
          </div>
        </div>
      )}
      {/* Ports */}
      <div className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center cursor-crosshair z-30 shadow-lg">
        <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
      </div>
      <div className="absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center cursor-crosshair z-30 shadow-lg">
        <div className={`w-1.5 h-1.5 bg-green-500 rounded-full ${isLoading ? 'animate-ping' : ''}`} />
      </div>

      {/* Main Preview Surface - Always Visible */}
      <div className="relative w-full h-[247px] bg-[#1a1a1a] overflow-hidden group/vid rounded-t-xl">
        {isLoading ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20">
            <div className="relative w-16 h-16 mb-4">
              <svg className="w-full h-full" viewBox="0 0 100 100">
                <circle
                  className="text-white/10"
                  strokeWidth="4"
                  stroke="currentColor"
                  fill="transparent"
                  r="40"
                  cx="50"
                  cy="50"
                />
                <circle
                  className="text-green-500 transition-all duration-500"
                  strokeWidth="4"
                  strokeDasharray={251.2}
                  strokeDashoffset={251.2 - (251.2 * (node.progress || 0)) / 100}
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="transparent"
                  r="40"
                  cx="50"
                  cy="50"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                 <span className="text-[11px] font-bold text-white font-mono">{Math.round(node.progress || 0)}%</span>
              </div>
            </div>
            <span className="text-[10px] text-green-400 font-mono tracking-[0.2em] animate-pulse uppercase mb-1">
              {node.statusMessage || '生成中'}
            </span>
            <div className="flex gap-1">
               <span className="w-1.5 h-1.5 rounded-full bg-green-500/50 animate-bounce [animation-delay:-0.3s]"></span>
               <span className="w-1.5 h-1.5 rounded-full bg-green-500/50 animate-bounce [animation-delay:-0.15s]"></span>
               <span className="w-1.5 h-1.5 rounded-full bg-green-500/50 animate-bounce"></span>
            </div>
          </div>
        ) : nodeError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-black/90 z-20">
            <AlertTriangle className="w-8 h-8 text-red-500/80 mb-3" />
            <p className="text-[11px] text-red-400 font-mono leading-relaxed">{nodeError}</p>
          </div>
        ) : generatedMedia ? (
          <div className="w-full h-full relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
            <video ref={videoRef} src={generatedMedia} loop muted playsInline className="w-full h-full object-cover" />
            {!isPlaying && (
              <div className="absolute inset-0 bg-black/20 flex items-center justify-center transition-opacity opacity-100 group-hover/vid:opacity-0 pointer-events-none">
                <div className="bg-black/40 backdrop-blur-sm border border-white/10 p-3 rounded-full text-white/90 shadow-2xl">
                  <Play className="w-6 h-6 fill-current" />
                </div>
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/vid:opacity-100 transition-opacity flex items-center justify-center gap-4 z-10">
              <button
                onClick={(e) => { e.stopPropagation(); setPreviewOpen(true); }}
                className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white transition-all transform hover:scale-110 active:scale-95 border border-white/20"
                title="放大预览"
              >
                <Maximize2 className="w-5 h-5" />
              </button>
              <button
                onClick={handleDownload}
                className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white transition-all transform hover:scale-110 active:scale-95 border border-white/20"
                title="下载视频"
              >
                <Download className="w-5 h-5" />
              </button>
            </div>
            {isPlaying && (
              <div className="absolute bottom-3 left-3 bg-black/60 border border-white/5 px-2 py-1 rounded text-[10px] text-zinc-300 font-mono shadow-xl">
                预览中
              </div>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-800">
            <Video className="w-10 h-10 mb-2 opacity-20" />
            <span className="text-[10px] font-mono tracking-widest opacity-30">就绪</span>
          </div>
        )}

        {/* Floating Indicator (Visible when collapsed) */}
        {!isSelected && (
          <div className="absolute top-4 left-4 z-10 flex items-center space-x-2 bg-black/40 backdrop-blur-md px-2 py-1 rounded-md border border-white/5">
             <div className={`w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-green-400 animate-pulse' : (node.status === '审核中' ? 'bg-red-400' : 'bg-green-600')}`} />
             <span className="text-[9px] font-bold text-zinc-400 font-mono tracking-tighter uppercase">{node.name || '生视频节点'}</span>
             {node.status === '审核中' && (
               <span className="text-[8px] bg-red-500/20 text-red-400 px-1 rounded ml-1 animate-pulse border border-red-500/30">REVIEW</span>
             )}
          </div>
        )}
      </div>

      {/* Expandable Control Suite */}
      <AnimatePresence>
        {isSelected && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="overflow-hidden bg-white/[0.02]"
          >
            {/* Header (Inside Suite) */}
            <div className="px-5 py-3.5 border-b border-white/5 flex justify-between items-center">
              <div className="flex items-center space-x-3">
                 <Sparkles className="w-3.5 h-3.5 text-green-400" />
                 <span className="text-xs font-semibold text-zinc-100 tracking-wide uppercase font-mono">生视频节点</span>
              </div>
              <div className="flex items-center space-x-2">
                {assetSaveMessage && (
                  <span className={`hidden 2xl:inline max-w-[150px] truncate text-[9px] font-mono ${assetSaveMessage.includes('失败') || assetSaveMessage.includes('请先') ? 'text-red-300' : 'text-emerald-300'}`}>
                    {assetSaveMessage}
                  </span>
                )}
                <button
                  onClick={(event) => handleSaveProductionAsset(false, event)}
                  disabled={!generatedMedia || isLoading || !currentProjectId || Boolean(assetSavingMode)}
                  className="text-[10px] px-2.5 py-1 rounded border transition-all select-none tracking-widest font-mono font-bold text-green-200 bg-green-400/10 border-green-400/25 hover:bg-green-400/20 disabled:text-zinc-600 disabled:bg-transparent disabled:border-white/5 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1"
                  title={currentProjectId ? '保存到个人镜头资产' : '请先选择团队项目'}
                >
                  {assetSavingMode === 'save' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  资产
                </button>
                <button
                  onClick={(event) => handleSaveProductionAsset(true, event)}
                  disabled={!generatedMedia || isLoading || !currentProjectId || Boolean(assetSavingMode)}
                  className="text-[10px] px-2.5 py-1 rounded border transition-all select-none tracking-widest font-mono font-bold text-emerald-200 bg-emerald-400/10 border-emerald-400/25 hover:bg-emerald-400/20 disabled:text-zinc-600 disabled:bg-transparent disabled:border-white/5 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1"
                  title={currentProjectId ? '保存为个人资产并提交审核' : '请先选择团队项目'}
                >
                  {assetSavingMode === 'submit' ? <Loader2 className="w-3 h-3 animate-spin" /> : <UploadCloud className="w-3 h-3" />}
                  提审
                </button>
                <button
                  onClick={onSubmitReview}
                  disabled={node.status === '审核中' || !generatedMedia || isLoading}
                  className={`text-[10px] px-2.5 py-1 rounded border transition-all select-none tracking-widest font-mono font-bold ${
                    node.status === '审核中'
                      ? 'text-green-400 bg-green-400/10 border-green-400/30 animate-pulse'
                      : !generatedMedia || isLoading
                        ? 'text-zinc-600 bg-transparent border-white/5 cursor-not-allowed opacity-50'
                        : 'text-zinc-400 bg-white/5 border-white/10 hover:text-white hover:bg-white/10 hover:border-white/20'
                  }`}
                >
                  {node.status === '审核中' ? '审核中' : '提交审核'}
                </button>
                <button onClick={onDelete} className="text-zinc-600 hover:text-red-400 transition-colors p-1">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <div className="relative group/prompt">
                <MentionEditor
                  value={currentPrompt}
                  onChange={(val) => handleFieldChange({ prompt: val })}
                  mediaList={uploadedFiles}
                  placeholder="描述你想生成的视频内容... (输入 @ 调用附件)"
                  className="bg-black/40"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsExpandedPrompt(true);
                  }}
                  className="absolute bottom-3 right-3 p-1.5 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-500 hover:text-green-400 rounded-lg border border-white/5 opacity-0 group-hover/prompt:opacity-100 transition-all cursor-pointer shadow-xl backdrop-blur-sm z-20"
                  title="放大编辑提示词"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Uploaded Media References Section */}
              {uploadedFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-[10px] text-zinc-500 font-bold uppercase tracking-wider font-mono">
                    <span className={hasStaleUploadedFiles ? 'text-red-300' : ''}>参考素材 ({uploadedFiles.length}/{maxFiles}){hasStaleUploadedFiles ? ` · ${staleUploadedFilesCount} 个需重选` : ''}</span>
                    {hasStaleUploadedFiles ? (
                      <button type="button" onClick={clearStaleReferenceAssets} className="rounded border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-[9px] text-red-200 hover:bg-red-500/20">
                        移除失效
                      </button>
                    ) : (
                      <span className="text-zinc-600">类型: {videoConfig.supportedInputTypes.join(' | ').toUpperCase()}</span>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2 bg-black/40 border border-white/5 rounded-xl p-2.5">
                    {uploadedFiles.map((file, idx) => {
                      const isStale = Boolean(file.assetId && staleMediaAssetIds.has(file.assetId));
                      return (
                        <div
                          key={idx}
                          onClick={() => {
                            if (isStale) return;
                            if (file.type === 'image' || file.type === 'video') {
                              setMagnifiedMedia({ src: file.url, type: file.type });
                            }
                          }}
                          className={`relative group/media h-16 rounded-lg bg-zinc-900/60 overflow-hidden flex flex-col items-center justify-center transition-all duration-200 ${
                            isStale
                              ? 'cursor-default border border-red-400/60 ring-1 ring-red-500/30'
                              : `border border-white/5 ${(file.type === 'image' || file.type === 'video') ? 'cursor-pointer hover:border-green-500/40 hover:bg-zinc-800/60 hover:scale-[1.02]' : ''}`
                          }`}
                          title={isStale ? '该参考素材已失效，请移除后重新选择。' : file.name}
                        >
                          <MediaThumbnail
                            url={file.url}
                            type={file.type}
                            className={`w-full h-full object-cover ${isStale ? 'opacity-35 grayscale' : ''}`}
                          />
                          {isStale && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-950/50 px-1 text-center">
                              <AlertTriangle className="h-4 w-4 text-red-200" />
                              <span className="text-[8px] font-mono font-black text-red-100">需重选</span>
                            </div>
                          )}
                          {file.type === 'video' && file.duration && !isStale && (
                            <span className="absolute bottom-1 right-1 bg-black/75 border border-white/10 text-[8px] font-mono font-black text-white px-1 leading-normal rounded pointer-events-none">
                              {file.duration}
                            </span>
                          )}
                          {file.type === 'audio' && file.name && !isStale && (
                            <span className="absolute bottom-1 left-0 right-0 text-[7px] font-mono text-zinc-500 text-center truncate px-1 opacity-60 pointer-events-none">
                              {file.name}
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteMediaItem(idx);
                            }}
                            className={`absolute top-1 right-1 bg-red-650 hover:bg-red-500 text-white p-1 rounded-md transition-opacity z-10 cursor-pointer shadow-lg ${
                              isStale ? 'opacity-100' : 'opacity-0 group-hover/media:opacity-100'
                            }`}
                            title={isStale ? '移除失效素材' : '移除素材'}
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Generation Mode Selector / Lock Descriptors */}
                  <div className="bg-zinc-900/30 border border-white/5 p-2.5 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest font-mono">模式设定 / 生成模式</span>
                      <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-zinc-950 border border-zinc-900 text-green-400 font-semibold uppercase">
                        {modeLabel}
                      </span>
                    </div>

                    {canToggleManually ? (
                      <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-950">
                        <button
                          type="button"
                          onClick={() => handleFieldChange({
                            video_generation_mode: 'reference_to_video',
                            videoInputs: {
                              referenceImageAssetIds: uploadedFiles.filter(f => f.type === 'image' && f.assetId).map(f => f.assetId!),
                              sourceVideoAssetId: uploadedFiles.find(f => f.type === 'video' && f.assetId)?.assetId,
                              audioAssetId: uploadedFiles.find(f => f.type === 'audio' && f.assetId)?.assetId
                            }
                          })}
                          className={`flex-1 py-1.5 rounded-md text-[10px] font-mono text-center font-bold relative transition-all cursor-pointer ${
                            currentMode === 'reference_to_video' || currentMode === 'all_in_one_reference'
                              ? 'bg-zinc-800 text-white border border-white/5 shadow-lg'
                              : 'text-zinc-500 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          参考图生成视频
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const imageAssetIds = uploadedFiles.filter(f => f.type === 'image' && f.assetId).map(f => f.assetId!);
                            handleFieldChange({
                              video_generation_mode: 'first_last_frame',
                              videoInputs: { firstFrameAssetId: imageAssetIds[0], lastFrameAssetId: imageAssetIds[1], referenceImageAssetIds: [] }
                            });
                          }}
                          className={`flex-1 py-1.5 rounded-md text-[10px] font-mono text-center font-bold relative transition-all cursor-pointer ${
                            currentMode === 'first_last_frame'
                              ? 'bg-zinc-800 text-white border border-white/5 shadow-lg'
                              : 'text-zinc-500 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          首尾帧模式
                        </button>
                      </div>
                    ) : (
                      <div className="bg-zinc-950/40 p-2 rounded-lg border border-zinc-900/60 text-[9px] text-zinc-400 leading-relaxed font-mono flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                        <span>
                          {modeReason}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Toolbar */}
              <div className="flex items-center justify-between border-t border-white/5 pt-4 relative">
                <div className="flex items-center space-x-2" ref={settingsRef}>
                  <button
                    ref={slashButtonRef}
                    type="button"
                    disabled={!currentProjectId || isUploadDisabled}
                    onClick={openSlashPicker}
                    className={`px-3 py-1.5 rounded-lg border text-[11px] font-mono font-bold flex items-center gap-1.5 transition-all outline-none ${
                      !currentProjectId || isUploadDisabled
                        ? 'bg-zinc-950 text-zinc-650 border-zinc-900 cursor-not-allowed opacity-40'
                        : 'bg-green-500/10 text-green-300 border-green-500/20 hover:bg-green-500/15 hover:border-green-500/30'
                    }`}
                    title={currentProjectId ? '从团队美术资产导入参考素材' : '请先选择团队项目'}
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    <span>团队美术</span>
                  </button>
                  {/* Media Upload Trigger (Left of select dropdown) */}
                  <div className="relative">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadFile(file);
                        e.target.value = ''; // Reset file status
                      }}
                      accept={
                        videoConfig.supportedInputTypes
                          .map(t => {
                            if (t === 'image') return '.jpg,.jpeg,.png,.webp';
                            if (t === 'video') return '.mp4,.mov';
                            if (t === 'audio') return '.mp3,.wav';
                            return '';
                          })
                          .filter(Boolean)
                          .join(',')
                      }
                      className="hidden"
                      disabled={isUploadDisabled || isUploading}
                    />
                    <button
                      type="button"
                      disabled={isUploadDisabled || isUploading}
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      className={`px-3 py-1.5 rounded-lg border text-[11px] font-mono font-bold flex items-center gap-1.5 transition-all outline-none ${
                        isUploadDisabled
                          ? 'bg-zinc-950 text-zinc-650 border-zinc-900 cursor-not-allowed opacity-40'
                          : isUploading
                            ? 'bg-green-500/10 text-green-400 border-green-500/20 cursor-wait'
                            : 'bg-white/5 text-zinc-300 border-white/5 hover:bg-white/10 hover:border-white/10'
                      }`}
                      title={isUploadDisabled ? `已达上传上限 (${uploadedFiles.length}/${maxFiles})` : "上传参考素材 (图片/视频/音频)"}
                    >
                      <Upload className="w-3.5 h-3.5 text-zinc-400" />
                      <span>
                        {isUploading ? '上传中...' : `素材 (${uploadedFiles.length}/${maxFiles})`}
                      </span>
                    </button>
                  </div>

                  <div className="relative">
                      <select
                        value={currentSelectValue}
                        onChange={(e) => {
                          const nextId = e.target.value;
                          const matchedConfig = apiConfigs?.find(c => c.id === nextId);
                          const nextModel = matchedConfig ? configLabel(matchedConfig) : nextId;
                          const cfg = resolveVideoConfig(nextModel, !!matchedConfig, matchedConfig?.modelName || '', configLabel(matchedConfig), matchedConfig?.metadata);
                          handleFieldChange({
                            model: nextModel,
                            video_duration: cfg.defaultDuration,
                            video_resolution: cfg.resolutions.includes(currentResolution) ? currentResolution : cfg.resolutions[0],
                            generate_audio: cfg.hasAudio,
                            use_custom_api: !!matchedConfig,
                            selected_api_id: matchedConfig ? matchedConfig.id : ''
                          });
                        }}
                        className="bg-white/5 border border-white/5 rounded-lg px-3 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-green-500/50 cursor-pointer font-mono hover:bg-white/10 transition-all appearance-none pr-8"
                      >
                        {availableConfigs.length === 0 ? (
                          <option value="" disabled className="bg-zinc-950">尚未配置 API 模型</option>
                        ) : (
                          availableConfigs.map(c => (
                            <option key={c.id} value={c.id} className="bg-zinc-950 text-white">
                              {configLabel(c)}
                            </option>
                          ))
                        )}
                      </select>
                    <ChevronDown className="w-3 h-3 text-zinc-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>

                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowAdvancedMenu(!showAdvancedMenu);
                        }}
                        className={`p-2 rounded-lg transition-all border ${
                          showAdvancedMenu ? 'bg-zinc-100 text-black border-white shadow-md' : 'bg-white/5 text-zinc-400 border-white/5 hover:border-white/10'
                        }`}
                        title="参数配置"
                      >
                        <Settings className="w-4 h-4" />
                      </button>

                      {/* Parameters Dropdown Menu (Portaled) */}
                      {showAdvancedMenu && createPortal(
                        <div 
                          className="fixed inset-0 z-[1000] pointer-events-none settings-portal"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowAdvancedMenu(false);
                          }}
                        >
                          <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            onClick={(e) => e.stopPropagation()}
                            className="pointer-events-auto absolute bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-5 space-y-6"
                            style={{
                              width: '340px',
                              left: settingsRef.current ? settingsRef.current.getBoundingClientRect().left : 0,
                              bottom: settingsRef.current ? (window.innerHeight - settingsRef.current.getBoundingClientRect().top + 12) : 0,
                              zIndex: 1001
                            }}
                          >
                            <div className="flex items-center justify-between border-b border-white/5 pb-3">
                               <div className="flex items-center gap-2">
                                  <Sliders className="w-3.5 h-3.5 text-green-400" />
                                  <span className="text-xs font-bold text-white tracking-widest uppercase font-mono">视频参数配置</span>
                               </div>
                               <span className="text-[9px] text-zinc-500 font-mono tracking-tighter uppercase">{videoConfig.name}</span>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                              {/* Aspect Ratio */}
                              {videoConfig.ratios && videoConfig.ratios.length > 0 && (
                                <div className="space-y-2">
                                  <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">画布比例 (ASPECT)</span>
                                  <div className="grid grid-cols-3 gap-1.5 max-h-[140px] overflow-y-auto pr-1">
                                    {videoConfig.ratios.map((ratio) => (
                                      <button
                                        key={ratio}
                                        type="button"
                                        onClick={() => handleFieldChange({ aspect_ratio: ratio })}
                                        className={`py-1.5 rounded-md border text-[10px] font-mono transition-all cursor-pointer ${
                                          currentAspectRatio === ratio 
                                            ? 'bg-zinc-100 text-black border-white shadow-[0_0_10px_rgba(255,255,255,0.1)]' 
                                            : 'bg-white/5 text-zinc-400 border-transparent hover:border-white/10 hover:bg-white/10'
                                        }`}
                                      >
                                        {ratio}
                                      </button>
                                    ))}
                  </div>
                </div>
                              )}

                              {/* Quality */}
                              {videoConfig.resolutions && videoConfig.resolutions.length > 0 && (
                                <div className="space-y-2">
                                  <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">输出分辨率 (RES)</span>
                                  <div className="flex flex-col gap-1.5">
                                    {videoConfig.resolutions.map((res) => (
                                      <button
                                        key={res}
                                        type="button"
                                        onClick={() => handleFieldChange({ video_resolution: res })}
                                        className={`py-1.5 rounded-md border text-[10px] font-mono transition-all text-left px-3 flex justify-between items-center cursor-pointer ${
                                          currentResolution === res 
                                            ? 'bg-zinc-100 text-black border-white shadow-[0_0_10px_rgba(255,255,255,0.1)]' 
                                            : 'bg-white/5 text-zinc-400 border-transparent hover:border-white/10 hover:bg-white/10'
                                        }`}
                                      >
                                        <span>{res}</span>
                                        {currentResolution === res && <div className="w-1 h-1 rounded-full bg-black" />}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-6 items-end">
                              {/* Duration adaptation */}
                              {durationOptions.length > 0 ? (
                                <div className="space-y-2">
                                  <div className="flex justify-between items-center text-[10px] text-zinc-500 uppercase font-bold tracking-widest">
                                    <span>生成时长 (SEC)</span>
                                    <span className="text-green-400 font-mono">{durationLabel(currentDuration)}</span>
                                  </div>
                                  <div className="grid grid-cols-4 gap-1.5">
                                    {durationOptions.map((duration) => (
                                      <button
                                        key={duration}
                                        type="button"
                                        onClick={() => handleFieldChange({ video_duration: duration })}
                                        className={`py-1.5 rounded-md border text-[10px] font-mono transition-all cursor-pointer ${
                                          currentDuration === duration
                                            ? 'bg-zinc-100 text-black border-white shadow-sm'
                                            : 'bg-white/5 text-zinc-400 border-transparent hover:border-white/10 hover:bg-white/10'
                                        }`}
                                      >
                                        {durationLabel(duration)}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : videoConfig.minDuration !== videoConfig.maxDuration ? (
                                <div className="space-y-2">
                                  <div className="flex justify-between items-center text-[10px] text-zinc-500 uppercase font-bold tracking-widest">
                                    <span>生成时长 (SEC)</span>
                                    <span className="text-green-400 font-mono">{currentDuration}s</span>
                                  </div>
                                  <input
                                    type="range"
                                    min={videoConfig.minDuration}
                                    max={videoConfig.maxDuration}
                                    step={videoConfig.step || 1}
                                    value={currentDuration}
                                    onChange={(e) => handleFieldChange({ video_duration: parseInt(e.target.value) })}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full accent-green-500 h-1 bg-white/5 rounded-full appearance-none cursor-pointer"
                                  />
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest block">生成时长 (SEC)</span>
                                  <div className="py-1.5 px-3 rounded-md bg-white/5 border border-white/5 text-[10px] text-zinc-400 font-mono">
                                    锁定 {currentDuration}s (固定值)
                                  </div>
                                </div>
                              )}
                              
                              {videoConfig.hasAudio && currentMode !== 'first_last_frame' && (
                                <div className="space-y-2">
                                  <span className="text-[10px] text-zinc-505 uppercase font-bold tracking-widest">音效渲染 (AUDIO)</span>
                                  <div className="flex gap-1.5">
                                    {[true, false].map((val) => (
                                      <button
                                        key={String(val)}
                                        type="button"
                                        onClick={() => handleFieldChange({ generate_audio: val })}
                                        className={`flex-1 py-1.5 rounded-md border text-[10px] font-mono transition-all cursor-pointer ${
                                          currentGenerateAudio === val 
                                            ? 'bg-zinc-100 text-black border-white shadow-sm' 
                                            : 'bg-white/5 text-zinc-400 border-transparent hover:border-white/10 hover:bg-white/10'
                                        }`}
                                      >
                                        {val ? 'ON' : 'OFF'}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {(supportsVideoNegativePrompt || supportsVideoSeed) && (
                              <div className="grid grid-cols-2 gap-6 items-end">
                                {supportsVideoNegativePrompt && (
                                  <div className="space-y-2">
                                    <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">负向提示词 (NEG)</span>
                                    <textarea
                                      value={currentNegativePrompt}
                                      onChange={(e) => handleFieldChange({ negative_prompt: e.target.value })}
                                      onClick={(e) => e.stopPropagation()}
                                      rows={3}
                                      className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[10px] text-zinc-200 outline-none resize-none focus:border-green-400/40"
                                      placeholder="避免出现的画面元素"
                                    />
                                  </div>
                                )}
                                {supportsVideoSeed && (
                                  <div className="space-y-2">
                                    <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">随机种子 (SEED)</span>
                                    <input
                                      type="number"
                                      value={currentSeed}
                                      min={-1}
                                      onChange={(e) => handleFieldChange({ seed: Number(e.target.value) })}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[10px] text-zinc-200 outline-none focus:border-green-400/40"
                                      placeholder="-1"
                                    />
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="pt-4 border-t border-white/5 flex justify-end">
                                <button 
                                  onClick={() => setShowAdvancedMenu(false)}
                                  className="text-[10px] text-zinc-500 hover:text-white transition-colors uppercase font-mono tracking-widest flex items-center gap-1.5"
                                >
                                  <span>关闭配置</span>
                                </button>
                            </div>
                          </motion.div>
                        </div>,
                        document.body
                      )}
                    </div>
                </div>

                <button
                  onClick={handleRunGeneration}
                  disabled={isLoading || !currentPrompt.trim() || hasStaleUploadedFiles || needsModeChoice || (!!activeCustomConfig && (!activeCapability || !capabilityExecutable))}
                  className={`flex items-center space-x-2 px-6 py-2 rounded-xl text-xs font-black tracking-widest uppercase transition-all duration-300 ${
                    isLoading 
                      ? 'bg-green-500/10 text-green-500 border border-green-500/30'
                      : !currentPrompt.trim() || hasStaleUploadedFiles || needsModeChoice || (!!activeCustomConfig && (!activeCapability || !capabilityExecutable))
                        ? 'bg-zinc-900/50 text-zinc-700 border border-white/5'
                        : 'bg-green-500 text-black hover:bg-green-400 hover:scale-[1.02] shadow-[0_0_20px_rgba(34,197,94,0.3)] border border-transparent'
                  }`}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{node.progress ? `${Math.round(node.progress)}%` : 'CONSTRUCTING'}</span>
                    </>
                  ) : (
                    <>
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>RUN</span>
                    </>
                  )}
                </button>
              </div>
              {slashImportMessage && (
                <div className={`mt-3 rounded-lg border px-3 py-2 text-[10px] font-mono ${
                  slashImportMessage.includes('已加入')
                    ? 'border-emerald-500/25 bg-emerald-950/20 text-emerald-200'
                    : 'border-amber-500/30 bg-amber-950/20 text-amber-200'
                }`}>
                  {slashImportMessage}
                </div>
              )}
              {capabilityWarning && (
                <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[10px] text-amber-200 font-mono">
                  {capabilityWarning}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Full-screen Preview */}
      <AnimatePresence>
        {previewOpen && generatedMedia && (
          <MediaZoomOverlay
            src={generatedMedia}
            type="video"
            name={node.name}
            onClose={() => setPreviewOpen(false)}
          />
        )}
        {magnifiedMedia && (
          <MediaZoomOverlay
            src={magnifiedMedia.src}
            type={magnifiedMedia.type}
            name={`${node.name || 'reference'}_upload`}
            onClose={() => setMagnifiedMedia(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isExpandedPrompt && (
          <ExpandedPromptOverlay
            value={currentPrompt}
            onChange={(val) => handleFieldChange({ prompt: val })}
            onClose={() => setIsExpandedPrompt(false)}
            mediaList={uploadedFiles}
            title="极影视频制片 • 提示词高级编辑"
            placeholder="描述你想生成的视频内容... (输入 @ 调用附件)"
            accentColor="green"
          />
        )}
      </AnimatePresence>
      {currentProjectId && slashPickerAnchor && (
        <SlashAssetPicker
          projectId={currentProjectId}
          fromStage="SHOT_04"
          query=""
          anchor={slashPickerAnchor}
          onClose={() => setSlashPickerAnchor(null)}
          onResolved={(resolved) => {
            void importSlashAsset(resolved);
            setSlashPickerAnchor(null);
          }}
        />
      )}
    </div>
  );
}
