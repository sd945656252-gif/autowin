import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { CanvasNode, CustomApiConfig, ProductionStage } from '../../types';
import { Sparkles, ImageIcon, Settings, Trash2, Loader2, PlayCircle, AlertTriangle, ArrowRight, Sliders, ChevronDown, Maximize2, Download, Upload, X, Plus, Save, UploadCloud } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getImageDimensions } from '../../utils/imageResolution';
import { resolveImageConfig } from '../../utils/imageConfig';
import { downloadMedia } from '../../utils/download';
import { useTempMedia } from '../../hooks/useTempMedia';
import { makeUrlPermanent } from '../../utils/persistence';
import MediaZoomOverlay from '../MediaZoomOverlay';
import ImageEditorOverlay from '../ImageEditorOverlay';
import ExpandedPromptOverlay from '../ExpandedPromptOverlay';
import MentionEditor from '../MentionEditor';
import MediaThumbnail from '../MediaThumbnail';
import { createProductionAsset, fetchModelCapabilities, submitProductionAssetReview } from '../../lib/db';
import { mediaAssetIdFromUrl, pollWorkflowTaskStatus } from './workflowNodeUtils';

interface ImageGeneratorNodeProps {
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

type ImageUploadResult = { url: string | null; assetId?: string; previewId: string };

export default function ImageGeneratorNode({
  node,
  userRole,
  isSelected,
  onUpdate,
  onDelete,
  onSelect,
  onSubmitReview,
  apiConfigs = [],
  currentProjectId,
  productionStage = 'ART_03'
}: ImageGeneratorNodeProps) {
  const [showAdvancedMenu, setShowAdvancedMenu] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [optimisticPreviews, setOptimisticPreviews] = useState<{ id: string; localUrl: string }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAutoRunKeyRef = useRef<string | null>(null);
  const [magnifiedImageSrc, setMagnifiedImageSrc] = useState<string | null>(null);

  // States for unified image crop and pixel adjustment
  const [activePreviewImage, setActivePreviewImage] = useState<{ url: string; index?: number; type: 'generated' | 'uploaded' } | null>(null);
  const resolvedActivePreviewUrl = useTempMedia(activePreviewImage?.url);
  const [isCropping, setIsCropping] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const [assetSavingMode, setAssetSavingMode] = useState<'save' | 'submit' | null>(null);
  const [assetSaveMessage, setAssetSaveMessage] = useState('');

  const [isExpandedPrompt, setIsExpandedPrompt] = useState(false);

  // Available API configs for this node type
  const availableConfigs = apiConfigs?.filter(c => c.type === 'image') || [];
  const configLabel = (config?: CustomApiConfig | null) => String(config?.displayName || config?.alias || config?.modelName || config?.id || '').trim();
  
  // State defaults for the node
  // Fallback to the first available config if node.model is empty, so visual state matches logic state
  const currentSelectValue = node.selected_api_id || (availableConfigs.length > 0 ? availableConfigs[0].id : '');
  const currentModel = node.model || (availableConfigs.length > 0 ? configLabel(availableConfigs[0]) : '');
  const currentPrompt = node.prompt || '';
  const useCustomApi = !!node.use_custom_api;
  const customModel = node.custom_model || '';
  const rawGeneratedMedia = node.generated_media || '';
  const resolvedTempMedia = useTempMedia(rawGeneratedMedia === '[LOCAL_CACHE_ONLY]' ? undefined : rawGeneratedMedia);
  const generatedMedia = rawGeneratedMedia === '[LOCAL_CACHE_ONLY]' ? resolvedTempMedia : (resolvedTempMedia || rawGeneratedMedia);
  const generatedMediaAssetId = node.generated_media_asset_id || mediaAssetIdFromUrl(rawGeneratedMedia) || mediaAssetIdFromUrl(generatedMedia) || undefined;
  const isLoading = !!node.isLoading;
  const nodeError = node.error || '';

  const activeCustomConfig = apiConfigs.find(c =>
    c.type === 'image' &&
    (c.id === node.selected_api_id ||
     (customModel && c.modelName === customModel) ||
     configLabel(c).toLowerCase() === currentModel.trim().toLowerCase() ||
     c.id === currentModel)
  );
  const { data: imageCapabilities = [] } = useQuery({
    queryKey: ['model-capabilities', 'IMAGE_GENERATOR'],
    queryFn: () => fetchModelCapabilities('IMAGE_GENERATOR'),
    staleTime: 0
  });
  const activeCapability = activeCustomConfig?.capabilityProfile || (activeCustomConfig?.canonicalModelId
    ? imageCapabilities.find((item) => item.canonicalModelId === activeCustomConfig.canonicalModelId)
    : null);
  const capabilityParams = activeCapability?.imageCapabilities;
  const capabilityExecutable = activeCapability ? activeCapability.executable : false;
  const capabilityWarning = activeCustomConfig && activeCapability && !capabilityExecutable
    ? '该模型尚未完成官方参数验证，不能执行生成任务。'
    : activeCustomConfig && !activeCapability
      ? '该模型尚未绑定后端能力模板，不能执行生成任务。'
      : '';

  const rawAspectRatio = node.aspect_ratio || '1:1';
  const rawNumOutputs = node.num_outputs || 1;
  const currentStylePreset = node.style_preset || 'photorealistic';
  const currentNegativePrompt = node.negative_prompt || '';
  const currentCfgScale = node.cfg_scale !== undefined ? node.cfg_scale : 7.5;
  const currentSteps = node.steps !== undefined ? node.steps : 25;
  const currentSeed = node.seed !== undefined ? node.seed : -1;
  const rawImageQuality = node.image_quality || 'standard';
  const normalizedRawImageQuality = rawImageQuality === 'standard' && capabilityParams?.controls?.quality?.includes('medium')
    ? 'medium'
    : rawImageQuality;
  const rawOutputFormat = node.output_format || 'png';
  const rawImageBackground = node.image_background || 'auto';
  const rawModeration = node.moderation || 'auto';
  const rawOutputCompression = node.output_compression !== undefined ? node.output_compression : 100;
  const rawPartialImages = node.partial_images !== undefined ? node.partial_images : 0;
  const rawStream = node.stream || false;

  const rawResolution = node.resolution || '1K';
  const capabilitySizeOptions = Array.isArray(capabilityParams?.controls?.size) ? capabilityParams.controls.size : [];
  const capabilityResolutions = capabilitySizeOptions.length > 0
    ? capabilitySizeOptions
    : capabilityParams?.controls?.sizeConstraints
      ? ['1K', '2K', '4K']
      : undefined;
  
  // Resolve model config for dynamic parameter options
  const imageConfig = resolveImageConfig(currentModel, useCustomApi, activeCustomConfig ? activeCustomConfig.modelName : '', activeCustomConfig ? configLabel(activeCustomConfig) : '', activeCustomConfig ? {
    ...(activeCustomConfig.metadata || {}),
      ...(capabilityParams ? {
        resolutions: capabilityResolutions,
        ratios: capabilityParams.controls?.aspectRatio,
        qualities: capabilityParams.controls?.quality,
        maxImages: capabilityParams.limits?.maxInputImages,
      supportsNegativePrompt: capabilityParams.controls?.negativePrompt,
      supportsAspectRatio: Array.isArray(capabilityParams.controls?.aspectRatio) && capabilityParams.controls.aspectRatio.length > 0,
      supportsQuality: Array.isArray(capabilityParams.controls?.quality) && capabilityParams.controls.quality.length > 0,
      description: `${activeCapability?.verificationStatus || 'UNVERIFIED'} capability profile`
    } : {})
  } : undefined);

  const sizeConstraints = capabilityParams?.controls?.sizeConstraints;
  const currentAspectRatio = (sizeConstraints || imageConfig.ratios?.includes(rawAspectRatio))
    ? rawAspectRatio
    : (imageConfig.ratios?.[0] || '1:1');
  const currentImageQuality = imageConfig.qualities?.includes(normalizedRawImageQuality)
    ? normalizedRawImageQuality
    : (imageConfig.qualities?.[0] || 'standard');
  const currentResolution = imageConfig.resolutions?.includes(rawResolution)
    ? rawResolution
    : (imageConfig.resolutions?.[0] || '1K');
  const imageControls = capabilityParams?.controls || null;
  const supportsImageResolution = imageConfig.supportsResolution !== false && Array.isArray(imageConfig.resolutions) && imageConfig.resolutions.length > 0;
  const supportsImageQuality = !imageControls || Array.isArray(imageControls.quality) && imageControls.quality.length > 0;
  const outputFormatOptions = Array.isArray(imageControls?.outputFormat) ? imageControls.outputFormat : [];
  const backgroundOptions = Array.isArray(imageControls?.background) ? imageControls.background : [];
  const moderationOptions = Array.isArray(imageControls?.moderation) ? imageControls.moderation : [];
  const outputCompressionRange = imageControls?.outputCompression && imageControls.outputCompression !== false ? imageControls.outputCompression : null;
  const partialImagesRange = imageControls?.partialImages && imageControls.partialImages !== false ? imageControls.partialImages : null;
  const supportsOutputFormat = outputFormatOptions.length > 0;
  const supportsBackground = backgroundOptions.length > 0;
  const supportsModeration = moderationOptions.length > 0;
  const supportsOutputCompression = Boolean(outputCompressionRange);
  const supportsStream = Boolean(imageControls?.stream);
  const supportsPartialImages = Boolean(partialImagesRange);
  const currentOutputFormat = outputFormatOptions.includes(rawOutputFormat) ? rawOutputFormat : (outputFormatOptions[0] || 'png');
  const currentImageBackground = backgroundOptions.includes(rawImageBackground) ? rawImageBackground : (backgroundOptions[0] || 'auto');
  const currentModeration = moderationOptions.includes(rawModeration) ? rawModeration : (moderationOptions[0] || 'auto');
  const currentOutputCompression = outputCompressionRange
    ? Math.min(Number(outputCompressionRange.max), Math.max(Number(outputCompressionRange.min), rawOutputCompression))
    : rawOutputCompression;
  const currentPartialImages = partialImagesRange
    ? Math.min(Number(partialImagesRange.max), Math.max(Number(partialImagesRange.min), rawPartialImages))
    : rawPartialImages;
  const supportsNegativePrompt = imageControls ? Boolean(imageControls.negativePrompt) : imageConfig.supportsNegativePrompt !== false;
  const supportsSteps = Boolean(imageControls?.steps && imageControls.steps !== false);
  const supportsCfgScale = Boolean(imageControls?.cfgScale && imageControls.cfgScale !== false);
  const supportsSeed = Boolean(imageControls?.seed);

  const defaultDims = getImageDimensions(imageConfig.id, currentAspectRatio, currentResolution, currentImageQuality, sizeConstraints);
  const currentWidth = node.width !== undefined ? node.width : defaultDims.w;
  const currentHeight = node.height !== undefined ? node.height : defaultDims.h;
  const currentUploadedImages = node.uploaded_images || [];
  const maxImages = imageConfig.maxImages || 4;
  const currentNumOutputs = rawNumOutputs;
  const maxOutputsFromCapability = capabilityParams?.limits?.maxOutputImages || currentNumOutputs;
  const normalizedNumOutputs = Math.min(maxOutputsFromCapability, currentNumOutputs);

  const imageInputAssetIds = node.imageInputs?.referenceImageAssetIds || [];
  const resolvedImageMode = node.imageInputs?.sourceImageAssetId && (node.imageInputs?.maskImageAssetId || node.imageInputs?.editInstruction)
    ? 'image_edit'
    : imageInputAssetIds.length > 0 || node.imageInputs?.sourceImageAssetId
      ? 'image_to_image'
      : 'text_to_image';
  const imageModeLabel = resolvedImageMode === 'image_edit' ? '图像编辑' : resolvedImageMode === 'image_to_image' ? '图生图' : '文生图';
  const imageModeReason = resolvedImageMode === 'image_edit'
    ? '检测到源图和编辑信息，后端将按图像编辑模式校验。'
    : resolvedImageMode === 'image_to_image'
      ? `检测到 ${imageInputAssetIds.length || 1} 个图片 assetId，后端将按图生图模式校验。`
      : '未检测到图片 assetId，后端将按文生图模式校验。';

  const pollWorkflowTask = (taskId: string, options?: { maxPollMs?: number; persistMedia?: boolean }) => {
    pollWorkflowTaskStatus({
      taskId,
      maxPollMs: options?.maxPollMs ?? 4 * 60 * 1000,
      persistMedia: options?.persistMedia,
      permanentMediaPrefix: 'img_gen',
      emptyMediaError: '生成失败，模型未返回图像数据',
      timeoutError: '生成状态同步超时，请到配置与监控运行记录查看上游 API 或后台 worker 是否超时。',
      syncFailureError: '生成状态同步失败，请检查网络或后端工作流服务。',
      currentProgress: node.progress,
      currentStatusMessage: node.statusMessage,
      onUpdate
    });
  };

  useEffect(() => {
    const updates: Partial<CanvasNode> = {};
    if (rawAspectRatio !== currentAspectRatio) updates.aspect_ratio = currentAspectRatio;
    if (rawImageQuality !== currentImageQuality) updates.image_quality = currentImageQuality as any;
    if (rawResolution !== currentResolution) updates.resolution = currentResolution;
    if (supportsOutputFormat && rawOutputFormat !== currentOutputFormat) updates.output_format = currentOutputFormat as any;
    if (supportsBackground && rawImageBackground !== currentImageBackground) updates.image_background = currentImageBackground as any;
    if (supportsModeration && rawModeration !== currentModeration) updates.moderation = currentModeration as any;
    if (supportsOutputCompression && rawOutputCompression !== currentOutputCompression) updates.output_compression = currentOutputCompression;
    if (supportsPartialImages && rawPartialImages !== currentPartialImages) updates.partial_images = currentPartialImages;
    if (!supportsOutputFormat && node.output_format) updates.output_format = undefined;
    if (!supportsBackground && node.image_background) updates.image_background = undefined;
    if (!supportsModeration && node.moderation) updates.moderation = undefined;
    if (!supportsOutputCompression && node.output_compression !== undefined) updates.output_compression = undefined;
    if (!supportsPartialImages && node.partial_images !== undefined) updates.partial_images = undefined;
    if (!supportsStream && node.stream !== undefined) updates.stream = undefined;
    if (!supportsNegativePrompt && currentNegativePrompt) updates.negative_prompt = '';
    if (!supportsSteps && node.steps !== undefined) updates.steps = undefined;
    if (!supportsCfgScale && node.cfg_scale !== undefined) updates.cfg_scale = undefined;
    if (!supportsSeed && node.seed !== undefined) updates.seed = undefined;
    if (currentNumOutputs > maxOutputsFromCapability) updates.num_outputs = maxOutputsFromCapability;
    if (updates.aspect_ratio || updates.image_quality || updates.resolution) {
      const dims = getImageDimensions(imageConfig.id, updates.aspect_ratio || currentAspectRatio, updates.resolution as any || currentResolution, updates.image_quality as any || currentImageQuality, sizeConstraints);
      updates.width = dims.w;
      updates.height = dims.h;
    }
    if (Object.keys(updates).length > 0) onUpdate(updates);
  }, [activeCustomConfig?.id, activeCapability?.activeRevisionId, rawAspectRatio, rawImageQuality, rawResolution, rawOutputFormat, rawImageBackground, rawModeration, rawOutputCompression, rawPartialImages, rawStream, currentAspectRatio, currentImageQuality, currentResolution, currentOutputFormat, currentImageBackground, currentModeration, currentOutputCompression, currentPartialImages, imageConfig.id, currentNegativePrompt, supportsNegativePrompt, supportsOutputFormat, supportsBackground, supportsModeration, supportsOutputCompression, supportsPartialImages, supportsStream, supportsSteps, supportsCfgScale, supportsSeed, maxOutputsFromCapability, currentNumOutputs]);

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

  const updateAspectRatioIfSupported = (ratio: string) => {
    if (!sizeConstraints && !imageConfig.ratios?.includes(ratio)) return false;
    if (currentAspectRatio === ratio) return false;
    const dims = getImageDimensions(imageConfig.id, ratio, currentResolution, currentImageQuality as any, sizeConstraints);
    onUpdate({ aspect_ratio: ratio, width: dims.w, height: dims.h });
    return true;
  };

  const handleUploadFiles = async (files: FileList | File[]) => {
    const spaceLeft = maxImages - (currentUploadedImages.length + optimisticPreviews.length);
    if (spaceLeft <= 0) return;

    const filesToUpload = Array.from(files)
      .filter(f => f.type.startsWith('image/'))
      .slice(0, spaceLeft);

    if (filesToUpload.length === 0) return;

    // Create unique optimistic previews for visual feedback
    const newPreviews = filesToUpload.map((file) => {
      const id = `${Date.now()}-${Math.random()}`;
      const localUrl = URL.createObjectURL(file);
      return { id, localUrl };
    });

    setOptimisticPreviews(prev => [...prev, ...newPreviews]);
    setIsUploadingImage(true);

    try {
      // Parallel file uploads
      const uploadPromises: Promise<ImageUploadResult>[] = filesToUpload.map(async (file, index) => {
        const correspondingPreview = newPreviews[index];
        const formData = new FormData();
        formData.append("image", file);
        try {
          const res = await fetch("/api/images/upload", {
            method: "POST",
            credentials: 'same-origin',
            body: formData,
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.url) {
              return { url: data.url, assetId: data.assetId || undefined, previewId: correspondingPreview.id };
            }
          }
        } catch (err) {
          console.error(`Upload failed for ${file.name}`, err);
        }
        return { url: null, assetId: undefined, previewId: correspondingPreview.id };
      });

      const results = await Promise.all(uploadPromises);
      const validUrls = results.filter((r): r is { url: string; assetId?: string; previewId: string } => r.url !== null);

      if (validUrls.length > 0) {
        // Update UI immediately with temp URLs
        const tempUrls = validUrls.map(r => r.url);
        const assetIds = validUrls.map(r => r.assetId).filter(Boolean) as string[];
        onUpdate((prev: any) => ({
          uploaded_images: [...(prev.uploaded_images || []), ...tempUrls],
          imageInputs: {
            ...(prev.imageInputs || {}),
            referenceImageAssetIds: [...(prev.imageInputs?.referenceImageAssetIds || []), ...assetIds]
          }
        }));

        // Resolve permanent storage in background
        (async () => {
          try {
            const pUrls = await Promise.all(tempUrls.map(url => makeUrlPermanent(url, 'uploaded_ref')));
            onUpdate((node: any) => ({
              uploaded_images: (node.uploaded_images || []).map((url: string) => {
                const idx = tempUrls.indexOf(url);
                return idx !== -1 ? pUrls[idx] : url;
              })
            }));
          } catch (e) {
            console.warn("Background image persistence failed", e);
          }
        })();
      }

      // Cleanup local URL references to prevent memory leaks
      newPreviews.forEach(p => URL.revokeObjectURL(p.localUrl));
    } catch (err) {
      console.error("Upload process encountered error", err);
    } finally {
      // Remove these specific previews from tracking once transit completes
      setOptimisticPreviews(prev => prev.filter(p => !newPreviews.some(np => np.id === p.id)));
      setIsUploadingImage(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUploadFiles(e.target.files);
    }
  };

  // Synchronize activePreviewImage when generatedMedia changes
  // The preview area is specifically for generated content.
  useEffect(() => {
    if (generatedMedia) {
      setActivePreviewImage({
        url: generatedMedia,
        type: 'generated'
      });
      const assetId = mediaAssetIdFromUrl(generatedMedia);
      if (assetId && node.generated_media_asset_id !== assetId) onUpdate({ generated_media_asset_id: assetId });
    } else {
      setActivePreviewImage(null);
    }
  }, [generatedMedia, node.generated_media_asset_id, onUpdate]);

  // Handle Restore back to the Original Image model version
  const handleRestoreToOriginal = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activePreviewImage) return;

    if (activePreviewImage.type === 'generated') {
      if (node.original_generated_media) {
        onUpdate({
          generated_media: node.original_generated_media,
          original_generated_media: ''
        });
        setActivePreviewImage(prev => prev ? { ...prev, url: node.original_generated_media! } : null);
      }
    } else {
      const idx = activePreviewImage.index;
      if (idx !== undefined && node.original_uploaded_images && node.original_uploaded_images[idx]) {
        const origUrl = node.original_uploaded_images[idx];
        const nextUploaded = [...currentUploadedImages];
        nextUploaded[idx] = origUrl;

        const nextOriginals = [...(node.original_uploaded_images || [])];
        nextOriginals[idx] = ''; // Clear tracking

        onUpdate({
          uploaded_images: nextUploaded,
          original_uploaded_images: nextOriginals
        });
        setActivePreviewImage(prev => prev ? { ...prev, url: origUrl, index: idx } : null);
      }
    }
  };

  useEffect(() => {
    if (!useCustomApi || !activeCustomConfig?.autoDetectParams || !currentPrompt) return;
    const p = currentPrompt.toLowerCase();
    const updates: Partial<CanvasNode> = {};
    
    if (imageConfig.supportsAspectRatio !== false) {
      if (p.includes("16:9") || p.includes("横屏") || p.includes("landscape")) {
        updateAspectRatioIfSupported("16:9");
      } else if (p.includes("9:16") || p.includes("竖屏") || p.includes("portrait")) {
        updateAspectRatioIfSupported("9:16");
      } else if (p.includes("1:1") || p.includes("正方形") || p.includes("square")) {
        updateAspectRatioIfSupported("1:1");
      }
    }
    if (Object.keys(updates).length > 0) onUpdate(updates);
  }, [currentPrompt, useCustomApi, activeCustomConfig]);

  const runGeneration = async () => {
    if (isLoading) return;

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
    const finalUrl = matchedConfig ? undefined : '';
    const finalKey = matchedConfig ? undefined : node.custom_key;
    const finalModel = matchedConfig ? undefined : currentModel;

    try {
      const response = await fetch('/api/workflow/execute', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
          node_id: node.id,
          node_type: 'image_generator',
          model: currentModel,
          prompt: currentPrompt,
          user_role: userRole,
          use_custom_api: useProxyApi,
          custom_config_id: matchedConfig?.id,
          custom_url: finalUrl,
          custom_key: finalKey,
          custom_model: finalModel,
          aspect_ratio: currentAspectRatio,
          width: currentWidth,
          height: currentHeight,
          num_outputs: normalizedNumOutputs,
          style_preset: currentStylePreset,
          negative_prompt: supportsNegativePrompt ? currentNegativePrompt : undefined,
          cfg_scale: supportsCfgScale ? currentCfgScale : undefined,
          steps: supportsSteps ? currentSteps : undefined,
          seed: supportsSeed ? currentSeed : undefined,
          resolution: supportsImageResolution ? currentResolution : undefined,
          image_quality: supportsImageQuality ? currentImageQuality : undefined,
          output_format: supportsOutputFormat ? currentOutputFormat : undefined,
          output_compression: supportsOutputCompression && currentOutputFormat !== 'png' ? currentOutputCompression : undefined,
          image_background: supportsBackground ? currentImageBackground : undefined,
          moderation: supportsModeration ? currentModeration : undefined,
          partial_images: supportsPartialImages && rawStream ? currentPartialImages : undefined,
          stream: supportsStream ? rawStream : undefined,
          image_generation_mode: node.imageGenerationMode || 'auto',
          image_inputs: node.imageInputs || { referenceImageAssetIds: [] }
        }),
      });

      const data = await response.json();
      if (data.success && data.task_id) {
        // Start Polling for status
        const taskId = data.task_id;
        onUpdate({ workflow_task_id: taskId, workflow_run_id: data.run_id || undefined, statusMessage: '等待后台执行...', progress: 1 });
        pollWorkflowTask(taskId, { maxPollMs: 4 * 60 * 1000, persistMedia: true });
      } else {
        onUpdate({ isLoading: false, error: data.error || '后端任务创建失败' });
      }
    } catch (err: any) {
      onUpdate({ isLoading: false, error: `网络握手失败: ${err.message || err}` });
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

  const handleFieldChange = (fields: Partial<CanvasNode> | ((node: CanvasNode) => Partial<CanvasNode>)) => onUpdate(fields);

  const handleSaveProductionAsset = async (submitReview: boolean, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!currentProjectId) {
      setAssetSaveMessage('请先选择团队项目');
      return;
    }
    if (!generatedMedia) {
      setAssetSaveMessage('请先生成图片');
      return;
    }

    setAssetSavingMode(submitReview ? 'submit' : 'save');
    setAssetSaveMessage(submitReview ? '正在保存并提审...' : '正在保存资产...');
    try {
      const mediaAssetId = generatedMediaAssetId || undefined;
      const asset = await createProductionAsset({
        projectId: currentProjectId,
        stage: productionStage,
        originalName: `${node.name || '美术设计生成图'}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`,
        description: currentPrompt?.trim().slice(0, 500) || '画布图片生成节点产出',
        mediaAssetId,
        mimeType: mediaAssetId ? undefined : 'text/uri-list',
        sourceType: 'canvas_image_generator',
        sourceId: node.id,
        sourcePayload: {
          mediaUrl: generatedMedia,
          prompt: currentPrompt,
          nodeId: node.id,
          nodeName: node.name,
          nodeType: node.type,
          model: currentModel,
          customConfigId: activeCustomConfig?.id || null,
          workflowTaskId: node.workflow_task_id || null,
          workflowRunId: node.workflow_run_id || null,
          imageInputs: node.imageInputs || null,
          generatedAt: new Date().toISOString()
        },
        metadata: {
          savedFrom: 'ImageGeneratorNode',
          stageName: productionStage,
          mediaAssetId: mediaAssetId || null
        }
      });
      const finalAsset = submitReview ? await submitProductionAssetReview(asset.id) : asset;
      window.dispatchEvent(new CustomEvent('jiying:production-assets-changed', { detail: { assetId: finalAsset.id, stage: finalAsset.stage } }));
      setAssetSaveMessage(finalAsset.reviewStatus === 'IN_REVIEW' ? '已保存并提审' : '已保存到个人资产');
      window.setTimeout(() => setAssetSaveMessage(''), 2600);
    } catch (error) {
      setAssetSaveMessage(error instanceof Error ? error.message : '保存资产失败');
    } finally {
      setAssetSavingMode(null);
    }
  };

  // Refs for closing dropdown on outside click
  const settingsRef = useRef<HTMLDivElement>(null);

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
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (currentUploadedImages.length < maxImages) {
          setIsDragging(true);
        }
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        if (currentUploadedImages.length < maxImages && e.dataTransfer.files) {
          handleUploadFiles(e.dataTransfer.files);
        }
      }}
      className={`node-box select-none glass-panel rounded-xl border flex flex-col z-10 group relative transition-all duration-500 w-[440px] bg-zinc-950/95 backdrop-blur-2xl ${
        isDragging
          ? 'border-emerald-500 ring-2 ring-emerald-500/40 bg-emerald-950/10 scale-[1.01] shadow-[0_0_50px_rgba(16,185,129,0.15)]'
          : isSelected
            ? 'border-cyan-500/50 shadow-[0_0_50px_rgba(6,182,212,0.15)] ring-1 ring-cyan-500/20'
            : 'border-white/5 hover:border-white/10 shadow-2xl'
      }`}
    >
      {/* Drop overlay prompt */}
      {isDragging && (
        <div className="absolute inset-0 bg-emerald-950/45 border-2 border-dashed border-emerald-500 rounded-xl flex items-center justify-center z-50 pointer-events-none backdrop-blur-[2px]">
          <div className="bg-zinc-950/95 border border-emerald-500/30 px-5 py-3 rounded-xl flex items-center gap-3 shadow-2xl animate-bounce">
            <ImageIcon className="w-5 h-5 text-emerald-400 animate-pulse" />
            <span className="text-xs font-bold text-emerald-300">松开鼠标即可上传参考图</span>
          </div>
        </div>
      )}
      {/* Ports */}
      <div className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center cursor-crosshair z-30 shadow-lg">
        <div className="w-1.5 h-1.5 bg-cyan-500 rounded-full" />
      </div>
      <div className="absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-zinc-900 border-2 border-zinc-800 flex items-center justify-center cursor-crosshair z-30 shadow-lg">
        <div className={`w-1.5 h-1.5 bg-cyan-500 rounded-full ${isLoading ? 'animate-ping' : ''}`} />
      </div>

      {/* Operations Toolbar above the image preview box */}
      {isSelected && activePreviewImage && (
        <div className="flex items-center justify-between px-3.5 py-2.5 bg-zinc-900 border-b border-white/5 text-xs text-zinc-300 gap-2 rounded-t-xl">
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
            <span>目标:</span>
            <span className="text-zinc-200 truncate max-w-[120px]">
              {activePreviewImage.type === 'generated' ? '生成结果' : `参考图 #${(activePreviewImage.index ?? 0) + 1}`}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsCropping(true);
                setIsResizing(false);
              }}
              className={`px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[10px] font-bold border transition-colors flex items-center gap-1 cursor-pointer ${
                isCropping ? 'border-cyan-500 text-cyan-400 bg-cyan-500/10' : 'border-transparent text-zinc-300'
              }`}
            >
              裁剪
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsResizing(true);
                setIsCropping(false);
              }}
              className={`px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[10px] font-bold border transition-colors flex items-center gap-1 cursor-pointer ${
                isResizing ? 'border-cyan-500 text-cyan-400 bg-cyan-500/10' : 'border-transparent text-zinc-300'
              }`}
            >
              尺寸调整
            </button>
            {(() => {
              const activeIndex = activePreviewImage.index;
              const hasOriginal = activePreviewImage.type === 'generated'
                ? !!node.original_generated_media
                : (activeIndex !== undefined && node.original_uploaded_images && !!node.original_uploaded_images[activeIndex]);
              return hasOriginal ? (
                <button
                  onClick={handleRestoreToOriginal}
                  className="px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-[10px] font-bold text-rose-400 border border-rose-500/20 transition-colors cursor-pointer"
                  title="还原为未调整过的原始大图"
                >
                  还原
                </button>
              ) : null;
            })()}
          </div>
        </div>
      )}

      {/* Image Preview Surface - Always Visible */}
      <div className={`relative w-full h-[247px] bg-[#1a1a1a] overflow-hidden group/img ${isSelected && activePreviewImage ? 'rounded-t-none' : 'rounded-t-xl'}`}>
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
                  className="text-cyan-500 transition-all duration-500"
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
            <span className="text-[10px] text-cyan-400 font-mono tracking-[0.2em] animate-pulse uppercase mb-1">
              {node.statusMessage || '渲染中'}
            </span>
            <div className="flex gap-1">
               <span className="w-1.5 h-1.5 rounded-full bg-cyan-500/50 animate-bounce [animation-delay:-0.3s]"></span>
               <span className="w-1.5 h-1.5 rounded-full bg-cyan-500/50 animate-bounce [animation-delay:-0.15s]"></span>
               <span className="w-1.5 h-1.5 rounded-full bg-cyan-500/50 animate-bounce"></span>
            </div>
          </div>
        ) : nodeError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-black/95 z-20">
            <AlertTriangle className="w-6 h-6 text-red-500 mb-2" />
            <p className="text-[10px] text-red-400 font-mono leading-normal max-h-[160px] overflow-y-auto w-full px-2">
              {nodeError}
            </p>
            <button 
              onClick={() => onUpdate({ error: '' })}
              className="mt-3 text-[9px] text-zinc-500 hover:text-white underline font-mono cursor-pointer"
            >
              CLEAR ERROR
            </button>
          </div>
        ) : activePreviewImage ? (
          <div className="w-full h-full relative group cursor-default">
            {resolvedActivePreviewUrl ? (
              <img 
                src={resolvedActivePreviewUrl} 
                alt="Active Preview" 
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-black/40">
                <Loader2 className="w-6 h-6 text-zinc-600 animate-spin mb-2" />
                <span className="text-[10px] text-zinc-500 font-mono">加载素材中...</span>
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-all flex items-center justify-center gap-4">
               <button
                 onClick={(e) => {
                   e.stopPropagation();
                   setMagnifiedImageSrc(activePreviewImage.url);
                 }}
                 className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white transition-all transform hover:scale-110 active:scale-95 border border-white/20 cursor-pointer animate-in fade-in zoom-in"
                 title="放大预览"
               >
                 <Maximize2 className="w-5 h-5" />
               </button>
               <button
                 onClick={(e) => {
                   e.stopPropagation();
                   downloadMedia(activePreviewImage.url, activePreviewImage.type === 'generated' ? 'result.jpg' : 'reference.jpg');
                 }}
                 className="p-3 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white transition-all transform hover:scale-110 active:scale-95 border border-white/20 cursor-pointer animate-in fade-in zoom-in"
                 title="下载图片"
               >
                 <Download className="w-5 h-5" />
               </button>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-800">
            <ImageIcon className="w-10 h-10 mb-2 opacity-20" />
            <span className="text-[10px] font-mono tracking-widest opacity-30">就绪</span>
          </div>
        )}

        {/* Fullscreen Image Overlay Editor */}
        <AnimatePresence>
          {isExpandedPrompt && (
            <ExpandedPromptOverlay
              value={currentPrompt}
              onChange={(val) => handleFieldChange({ prompt: val })}
              onClose={() => setIsExpandedPrompt(false)}
              mediaList={currentUploadedImages.map((url, idx) => ({
                url,
                type: 'image' as const,
                name: `参考图 ${idx + 1}`
              }))}
              title="极影图像制片 • 提示词高级编辑"
              placeholder="描述你想生成的画面内容... (输入 @ 调用附件)"
              accentColor="cyan"
            />
          )}
        </AnimatePresence>

        {(isCropping || isResizing) && activePreviewImage && (
          <ImageEditorOverlay
            src={activePreviewImage.url}
            type={activePreviewImage.type}
            index={activePreviewImage.index}
            initialTab={isCropping ? 'crop' : 'resize'}
            maxResolution={imageConfig.resolutions?.includes('4K') ? 4096 : imageConfig.resolutions?.includes('2K') ? 2048 : 1024}
            onClose={() => {
              setIsCropping(false);
              setIsResizing(false);
            }}
            onConfirm={async (finalUrl) => {
              const permanentUrl = await makeUrlPermanent(finalUrl, 'edited');
              if (activePreviewImage.type === 'generated') {
                const originalUrl = node.original_generated_media || node.generated_media || '';
                onUpdate({
                  generated_media: permanentUrl,
                  original_generated_media: originalUrl
                });
                setActivePreviewImage({ url: permanentUrl, type: 'generated' });
              } else {
                const idx = activePreviewImage.index;
                if (idx !== undefined) {
                  const originalUrl = (node.original_uploaded_images && node.original_uploaded_images[idx]) || currentUploadedImages[idx] || '';

                  const nextUploaded = [...currentUploadedImages];
                  nextUploaded[idx] = permanentUrl;

                  const nextOriginals = node.original_uploaded_images ? [...node.original_uploaded_images] : Array(currentUploadedImages.length).fill('');
                  nextOriginals[idx] = originalUrl;

                  onUpdate({
                    uploaded_images: nextUploaded,
                    original_uploaded_images: nextOriginals
                  });
                  setActivePreviewImage({ url: permanentUrl, index: idx, type: 'uploaded' });
                }
              }
              setIsCropping(false);
              setIsResizing(false);
            }}
          />
        )}

        {/* Floating Identity (Collapsed Only) */}
        {!isSelected && (
          <div className="absolute top-4 left-4 z-10 flex items-center space-x-2 bg-black/40 backdrop-blur-md px-2 py-1 rounded-md border border-white/5">
             <div className={`w-1.5 h-1.5 rounded-full ${isLoading ? 'bg-cyan-400 animate-pulse' : (node.status === '审核中' ? 'bg-red-400' : 'bg-cyan-600')}`} />
             <span className="text-[9px] font-bold text-zinc-400 font-mono tracking-tighter uppercase">{node.name || '生图节点'}</span>
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
            className="overflow-hidden bg-white/[0.01]"
          >
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
              <div className="flex items-center space-x-3">
                 <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                 <span className="text-xs font-semibold text-zinc-100 tracking-wide uppercase font-mono">{node.name ? node.name.toUpperCase() : 'RENDER CONSOLE'}</span>
                 {currentUploadedImages.length > 0 ? (
                   <span className="text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono font-bold animate-pulse">
                     图生图
                   </span>
                 ) : (
                   <span className="text-[9px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/15 px-1.5 py-0.5 rounded font-mono font-bold">
                     文生图
                   </span>
                 )}
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
                  className="text-[10px] px-2.5 py-1 rounded border transition-all select-none tracking-widest font-mono font-bold text-cyan-200 bg-cyan-400/10 border-cyan-400/25 hover:bg-cyan-400/20 disabled:text-zinc-600 disabled:bg-transparent disabled:border-white/5 disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1"
                  title={currentProjectId ? '保存到个人美术资产' : '请先选择团队项目'}
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
                      ? 'text-cyan-400 bg-cyan-400/10 border-cyan-400/30 animate-pulse'
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
              {/* Uploaded image thumbnails display */}
              {(currentUploadedImages.length > 0 || optimisticPreviews.length > 0) && (
                <div className="flex flex-wrap gap-2 bg-black/30 border border-white/5 rounded-xl p-3 animate-fadeIn">
                  {currentUploadedImages.map((imgUrl, idx) => (
                    <div key={idx} className={`relative w-12 h-12 bg-zinc-900 border rounded-lg overflow-hidden group/thumb cursor-pointer hover:border-cyan-500/50 transition-all ${
                      activePreviewImage?.type === 'uploaded' && activePreviewImage.index === idx ? 'border-cyan-500 ring-1 ring-cyan-500/30' : 'border-white/10'
                    }`}>
                      <MediaThumbnail
                        url={imgUrl}
                        type="image"
                        className="w-full h-full object-cover hover:scale-110 transition-transform duration-300"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMagnifiedImageSrc(imgUrl);
                        }}
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const nextImages = currentUploadedImages.filter((_, i) => i !== idx);
                          const nextOriginals = node.original_uploaded_images ? node.original_uploaded_images.filter((_, i) => i !== idx) : [];
                          
                          onUpdate({ 
                            uploaded_images: nextImages,
                            original_uploaded_images: nextOriginals,
                            imageInputs: {
                              ...(node.imageInputs || {}),
                              referenceImageAssetIds: imageInputAssetIds.filter((_, i) => i !== idx)
                            }
                          });
                          if (activePreviewImage?.type === 'uploaded' && activePreviewImage.index === idx) {
                            setActivePreviewImage(null);
                          }
                        }}
                        className="absolute -top-1 -right-1 bg-rose-500 hover:bg-rose-600 text-white rounded-full p-0.5 shadow-md flex items-center justify-center transition-all z-10 w-4 h-4 cursor-pointer"
                        title="删除图片"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}

                  {optimisticPreviews.map((preview) => (
                    <div key={preview.id} className="relative w-12 h-12 bg-zinc-950 border border-cyan-500/20 rounded-lg overflow-hidden animate-pulse flex items-center justify-center">
                      <img
                        src={preview.localUrl}
                        alt="optimistic preview"
                        className="w-full h-full object-cover opacity-30 scale-105"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                        <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                      </div>
                    </div>
                  ))}

                  {(currentUploadedImages.length + optimisticPreviews.length) < maxImages && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      className="w-12 h-12 bg-white/5 hover:bg-white/10 border border-dashed border-white/10 hover:border-white/20 rounded-lg flex flex-col items-center justify-center text-zinc-500 hover:text-zinc-300 transition-all gap-0.5 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="text-[8px] scale-[0.8] leading-none text-zinc-500">添加</span>
                    </button>
                  )}
                </div>
              )}

              <div className="rounded-xl border border-cyan-500/15 bg-cyan-950/10 px-3 py-2 text-[10px] font-mono text-cyan-100 flex items-center justify-between gap-3">
                <span className="font-bold tracking-widest uppercase">识别模式：{imageModeLabel}</span>
                <span className="text-cyan-200/75 text-right leading-normal">{imageModeReason}</span>
              </div>

              <div className="relative group/prompt">
                <MentionEditor
                  value={currentPrompt}
                  onChange={(val) => handleFieldChange({ prompt: val })}
                  mediaList={currentUploadedImages.map((url, idx) => ({
                    url,
                    type: 'image' as const,
                    name: `参考图 ${idx + 1}`
                  }))}
                  placeholder="描述你想生成的画面内容... (输入 @ 调用附件)"
                  className="bg-black/40"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsExpandedPrompt(true);
                  }}
                  className="absolute bottom-3 right-3 p-1.5 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-500 hover:text-cyan-400 rounded-lg border border-white/5 opacity-0 group-hover/prompt:opacity-100 transition-all cursor-pointer shadow-xl backdrop-blur-sm z-20"
                  title="放大编辑提示词"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Toolbar */}
              <div className="flex items-center justify-between border-t border-white/5 pt-4 relative">
                <div className="flex items-center space-x-2" ref={settingsRef}>
                  {/* Hidden Input file */}
                  <input
                    type="file"
                    accept="image/*"
                    multiple={maxImages > 1}
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                  />

                  {/* Upload Button */}
                  <button
                    type="button"
                    disabled={(currentUploadedImages.length + optimisticPreviews.length) >= maxImages || isUploadingImage}
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    className={`p-2 rounded-lg border transition-all flex items-center justify-center gap-1.5 cursor-pointer max-h-[34px] ${
                      (currentUploadedImages.length + optimisticPreviews.length) >= maxImages
                        ? 'bg-zinc-900 border-white/5 text-zinc-600 cursor-not-allowed opacity-40'
                        : isUploadingImage
                          ? 'bg-cyan-950/20 border-cyan-500/35 text-cyan-400'
                          : 'bg-white/5 border-white/5 text-zinc-400 hover:text-white hover:border-white/10 hover:bg-white/10'
                    }`}
                    title={
                      (currentUploadedImages.length + optimisticPreviews.length) >= maxImages
                        ? `已达到该模型上传上限 (${maxImages}张)`
                        : isUploadingImage
                          ? '正在上传...'
                          : `上传参考图片 (上限${maxImages}张)`
                    }
                  >
                    {isUploadingImage ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    {(currentUploadedImages.length + optimisticPreviews.length) > 0 && (
                      <span className="text-[9px] font-mono font-bold px-1 bg-cyan-500/20 text-cyan-400 rounded-full font-mono tracking-tighter">
                        {currentUploadedImages.length + optimisticPreviews.length}/{maxImages}
                      </span>
                    )}
                  </button>

                  <div className="relative">
                      <select
                        value={currentSelectValue}
                        onChange={(e) => {
                          const nextId = e.target.value;
                        const matchedConfig = apiConfigs?.find(c => c.id === nextId);
                          const nextModel = matchedConfig ? configLabel(matchedConfig) : nextId;
                          const nextCapability = matchedConfig?.canonicalModelId
                            ? imageCapabilities.find((item) => item.canonicalModelId === matchedConfig.canonicalModelId)
                            : null;
                          const nextCapabilityParams = nextCapability?.imageCapabilities;
                          const nextSizeConstraints = nextCapabilityParams?.controls?.sizeConstraints;
                          const resolvedConfig = resolveImageConfig(nextModel, !!matchedConfig, matchedConfig?.modelName || '', configLabel(matchedConfig), matchedConfig ? {
                            ...(matchedConfig.metadata || {}),
                            ...(nextCapabilityParams ? {
                              resolutions: nextSizeConstraints ? ['1K', '2K', '4K'] : undefined,
                              ratios: nextCapabilityParams.controls?.aspectRatio,
                              qualities: nextCapabilityParams.controls?.quality,
                              maxImages: nextCapabilityParams.limits?.maxInputImages,
                              supportsNegativePrompt: nextCapabilityParams.controls?.negativePrompt,
                              supportsAspectRatio: Array.isArray(nextCapabilityParams.controls?.aspectRatio) && nextCapabilityParams.controls.aspectRatio.length > 0,
                              supportsQuality: Array.isArray(nextCapabilityParams.controls?.quality) && nextCapabilityParams.controls.quality.length > 0
                            } : {})
                          } : undefined);
                          const nextResolution = resolvedConfig.resolutions?.includes(currentResolution) ? currentResolution : (resolvedConfig.resolutions?.[0] || '1K');
                          const dims = getImageDimensions(resolvedConfig.id, currentAspectRatio, nextResolution, currentImageQuality, nextSizeConstraints);
                          handleFieldChange({
                            model: nextModel,
                            resolution: nextResolution,
                            width: dims.w,
                            height: dims.h,
                            use_custom_api: !!matchedConfig,
                            selected_api_id: matchedConfig ? matchedConfig.id : ''
                          });
                        }}
                        className="bg-white/5 border border-white/5 rounded-lg px-3 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-cyan-500/50 cursor-pointer font-mono hover:bg-white/10 transition-all appearance-none pr-8"
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
                          showAdvancedMenu ? 'bg-zinc-100 text-black border-white' : 'bg-white/5 text-zinc-400 border-white/5 hover:border-white/10'
                        }`}
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
                            <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-2">
                               <div className="flex items-center gap-2">
                                  <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                                  <span className="text-xs font-bold text-white tracking-widest uppercase font-mono">参数调节</span>
                               </div>
                               <span className="text-[9px] text-zinc-500 font-mono tracking-tighter uppercase">{imageConfig.name} 配置中</span>
                            </div>

                            <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-4">
                                  {imageConfig.supportsResolution !== false && imageConfig.resolutions && imageConfig.resolutions.length > 0 && (
                                    <div className="space-y-2">
                                      <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">分辨率 (RES)</span>
                                      <div className="grid grid-cols-3 gap-1.5">
                                        {imageConfig.resolutions.map((level) => (
                                          <button
                                            key={level}
                                            type="button"
                                            onClick={() => {
                                              const dims = getImageDimensions(imageConfig.id, currentAspectRatio, level, currentImageQuality, sizeConstraints);
                                              handleFieldChange({ resolution: level, width: dims.w, height: dims.h });
                                            }}
                                            className={`py-1.5 rounded-md border text-[10px] font-mono transition-all cursor-pointer ${
                                              currentResolution === level ? 'bg-zinc-100 text-black border-white shadow-[0_0_10px_rgba(255,255,255,0.2)]' : 'bg-white/5 text-zinc-400 border-transparent hover:border-white/10 hover:bg-white/10'
                                            }`}
                                          >
                                            {level}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  
                                  {imageConfig.supportsQuality !== false && imageConfig.qualities && imageConfig.qualities.length > 0 && (
                                    <div className="space-y-2">
                                      <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">画质 (QUALITY)</span>
                                      <div className="flex flex-col gap-1.5">
                                        {imageConfig.qualities.map((q) => (
                                          <button
                                            key={q}
                                            type="button"
                                            onClick={() => {
                                              const dims = getImageDimensions(imageConfig.id, currentAspectRatio, currentResolution, q as any, sizeConstraints);
                                              handleFieldChange({ image_quality: q as any, width: dims.w, height: dims.h });
                                            }}
                                            className={`py-1.5 rounded-md border text-[10px] font-mono transition-all px-3 text-left flex items-center justify-between cursor-pointer ${
                                              currentImageQuality === q ? 'bg-zinc-100 text-black border-white shadow-[0_0_10px_rgba(255,255,255,0.2)]' : 'bg-white/5 text-zinc-400 border-transparent hover:border-white/10 hover:bg-white/10'
                                            }`}
                                          >
                                            <span>{q.toUpperCase()}</span>
                                            {currentImageQuality === q && <div className="w-1 h-1 rounded-full bg-black" />}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>

                                {imageConfig.supportsAspectRatio !== false && imageConfig.ratios && imageConfig.ratios.length > 0 && (
                                  <div className="space-y-2">
                                    <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">比例 (RATIO)</span>
                                    <div className="grid grid-cols-2 gap-1.5 max-h-[160px] overflow-y-auto pr-1">
                                      {imageConfig.ratios.map((ratio) => (
                                        <button
                                          key={ratio}
                                          type="button"
                                          onClick={() => {
                                            const dims = getImageDimensions(imageConfig.id, ratio, currentResolution, currentImageQuality, sizeConstraints);
                                            handleFieldChange({ aspect_ratio: ratio, width: dims.w, height: dims.h });
                                          }}
                                          className={`py-1.5 rounded-md border text-[10px] font-mono transition-all cursor-pointer ${
                                            currentAspectRatio === ratio ? 'bg-zinc-100 text-black border-white shadow-[0_0_10px_rgba(255,255,255,0.2)]' : 'bg-white/5 text-zinc-400 border-transparent hover:border-white/10 hover:bg-white/10'
                                          }`}
                                        >
                                          {ratio}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Supports Negative Prompt Field if enabled */}
                              {imageConfig.supportsNegativePrompt !== false && (
                                <div className="space-y-1.5 border-t border-white/5 pt-3">
                                  <span className="block text-[10px] text-zinc-500 uppercase font-bold tracking-widest">负向提示词 (NEGATIVE PROMPT)</span>
                                  <input
                                    type="text"
                                    value={currentNegativePrompt}
                                    onChange={(e) => handleFieldChange({ negative_prompt: e.target.value })}
                                    className="w-full bg-[#0d0f19] border border-white/5 rounded-md px-2.5 py-1.5 text-[10px] text-zinc-200 outline-none focus:border-cyan-500 font-mono"
                                    placeholder="描述你不希望画面中出现的元素或特征..."
                                  />
                                </div>
                              )}

                              {(supportsOutputFormat || supportsBackground || supportsModeration) && (
                                <div className="grid grid-cols-3 gap-2 border-t border-white/5 pt-3">
                                  {supportsOutputFormat && (
                                    <div className="space-y-1.5">
                                      <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-widest">格式</span>
                                      <select
                                        value={currentOutputFormat}
                                        onChange={(e) => handleFieldChange({ output_format: e.target.value as any })}
                                        className="w-full bg-[#0d0f19] border border-white/5 rounded-md px-2 py-1.5 text-[10px] text-zinc-200 outline-none focus:border-cyan-500 font-mono"
                                      >
                                        {outputFormatOptions.map((item) => <option key={item} value={item} className="bg-zinc-950">{item.toUpperCase()}</option>)}
                                      </select>
                                    </div>
                                  )}
                                  {supportsBackground && (
                                    <div className="space-y-1.5">
                                      <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-widest">背景</span>
                                      <select
                                        value={currentImageBackground}
                                        onChange={(e) => handleFieldChange({ image_background: e.target.value as any })}
                                        className="w-full bg-[#0d0f19] border border-white/5 rounded-md px-2 py-1.5 text-[10px] text-zinc-200 outline-none focus:border-cyan-500 font-mono"
                                      >
                                        {backgroundOptions.map((item) => <option key={item} value={item} className="bg-zinc-950">{item.toUpperCase()}</option>)}
                                      </select>
                                    </div>
                                  )}
                                  {supportsModeration && (
                                    <div className="space-y-1.5">
                                      <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-widest">审核</span>
                                      <select
                                        value={currentModeration}
                                        onChange={(e) => handleFieldChange({ moderation: e.target.value as any })}
                                        className="w-full bg-[#0d0f19] border border-white/5 rounded-md px-2 py-1.5 text-[10px] text-zinc-200 outline-none focus:border-cyan-500 font-mono"
                                      >
                                        {moderationOptions.map((item) => <option key={item} value={item} className="bg-zinc-950">{item.toUpperCase()}</option>)}
                                      </select>
                                    </div>
                                  )}
                                </div>
                              )}

                              {(supportsOutputCompression || supportsStream) && (
                                <div className="space-y-3 border-t border-white/5 pt-3">
                                  {supportsOutputCompression && currentOutputFormat !== 'png' && (
                                    <div className="space-y-1.5">
                                      <div className="flex items-center justify-between">
                                        <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">压缩率</span>
                                        <span className="text-[9px] text-cyan-400 font-mono">{currentOutputCompression}</span>
                                      </div>
                                      <input
                                        type="range"
                                        min={outputCompressionRange?.min ?? 0}
                                        max={outputCompressionRange?.max ?? 100}
                                        value={currentOutputCompression}
                                        onChange={(e) => handleFieldChange({ output_compression: Number(e.target.value) })}
                                        className="w-full accent-cyan-400"
                                      />
                                    </div>
                                  )}
                                  {supportsStream && (
                                    <div className="grid grid-cols-2 gap-3">
                                      <label className="flex items-center gap-2 rounded-md border border-white/5 bg-[#0d0f19] px-2.5 py-2 text-[10px] text-zinc-300 font-mono">
                                        <input
                                          type="checkbox"
                                          checked={rawStream}
                                          onChange={(e) => handleFieldChange({ stream: e.target.checked })}
                                          className="accent-cyan-400"
                                        />
                                        STREAM
                                      </label>
                                      {supportsPartialImages && rawStream && (
                                        <div className="space-y-1.5">
                                          <div className="flex items-center justify-between">
                                            <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-widest">局部图</span>
                                            <span className="text-[9px] text-cyan-400 font-mono">{currentPartialImages}</span>
                                          </div>
                                          <input
                                            type="range"
                                            min={partialImagesRange?.min ?? 0}
                                            max={partialImagesRange?.max ?? 3}
                                            value={currentPartialImages}
                                            onChange={(e) => handleFieldChange({ partial_images: Number(e.target.value) })}
                                            className="w-full accent-cyan-400"
                                          />
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="pt-4 border-t border-white/5 flex justify-end">
                                <button 
                                  onClick={() => setShowAdvancedMenu(false)}
                                  className="text-[10px] text-zinc-500 hover:text-white transition-colors uppercase font-mono tracking-widest flex items-center gap-1.5"
                                >
                                  <span>关闭菜单</span>
                                  <ArrowRight className="w-2.5 h-2.5" />
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
                  disabled={isLoading || !currentPrompt.trim() || (!!activeCustomConfig && (!activeCapability || !capabilityExecutable))}
                  className={`flex items-center space-x-2 px-6 py-2 rounded-xl text-xs font-black tracking-widest uppercase transition-all duration-300 ${
                    isLoading 
                      ? 'bg-cyan-500/10 text-cyan-500 border border-cyan-500/30'
                      : !currentPrompt.trim() || (!!activeCustomConfig && (!activeCapability || !capabilityExecutable))
                        ? 'bg-zinc-900/50 text-zinc-700 border border-white/5'
                        : 'bg-cyan-500 text-black hover:bg-cyan-400 hover:scale-[1.02] shadow-[0_0_20px_rgba(6,182,212,0.3)] border border-transparent'
                  }`}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{node.progress ? `${Math.round(node.progress)}%` : 'RUNNING'}</span>
                    </>
                  ) : (
                    <>
                      <PlayCircle className="w-3.5 h-3.5" />
                      <span>RUN</span>
                    </>
                  )}
                </button>
              </div>
              {capabilityWarning && (
                <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-[10px] text-amber-200 font-mono">
                  {capabilityWarning}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dynamic Double-magnification Fullscreen Canvas Overlay */}
      <AnimatePresence>
        {magnifiedImageSrc && (
          <MediaZoomOverlay
            src={magnifiedImageSrc}
            type="image"
            name={node.name}
            onClose={() => setMagnifiedImageSrc(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
