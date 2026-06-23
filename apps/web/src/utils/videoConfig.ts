/**
 * Dedicated utility for resolving native physical parameters of diverse video generation models.
 * Dynamically parses model strings (including custom user-defined APIs) to realign bounds on
 * duration, resolution, aspect ratio, and multi-track audio features.
 */

export interface VideoModelConfig {
  id: string;
  name: string;
  minDuration: number;
  maxDuration: number;
  defaultDuration: number;
  durations?: number[];
  step: number;
  resolutions: string[];
  ratios: string[];
  description: string;
  hasAudio: boolean;
  supportedInputTypes: ('image' | 'video' | 'audio')[];
  maxFiles: number;
  supportsFirstAndLastFrame: boolean;
  supportsAllInOneReference: boolean;
}

export const BUILT_IN_VIDEO_MODELS: VideoModelConfig[] = [
  {
    id: 'sora',
    name: 'OpenAI Sora [Preview]',
    minDuration: 5,
    maxDuration: 60,
    defaultDuration: 10,
    step: 5,
    resolutions: ['1080P', '4K'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    description: 'OpenAI 旗舰视频生成模型，支持长达 60s 的物理连贯视频。支持全能参考（图像与视频混合）。',
    hasAudio: true,
    supportedInputTypes: ['image', 'video'],
    maxFiles: 4,
    supportsFirstAndLastFrame: true,
    supportsAllInOneReference: true,
  },
  {
    id: 'runway-gen-3',
    name: 'Runway Gen-3 Alpha',
    minDuration: 5,
    maxDuration: 10,
    defaultDuration: 5,
    step: 5,
    resolutions: ['720P', '1080P'],
    ratios: ['16:9', '9:16', '1:1'],
    description: 'Runway 最新实时视频生成引擎，画质极佳。支持首尾帧模式与高质图生视频。',
    hasAudio: true,
    supportedInputTypes: ['image', 'video'],
    maxFiles: 2,
    supportsFirstAndLastFrame: true,
    supportsAllInOneReference: false,
  },
  {
    id: 'cogvideox-5b',
    name: 'CogVideoX 5B',
    minDuration: 5,
    maxDuration: 10,
    defaultDuration: 5,
    step: 5,
    resolutions: ['720P'],
    ratios: ['16:9', '4:3', '1:1'],
    description: '清华系开源视频生成巅峰，支持高动态表现。支持单图变视频。',
    hasAudio: false,
    supportedInputTypes: ['image'],
    maxFiles: 1,
    supportsFirstAndLastFrame: false,
    supportsAllInOneReference: false,
  },
  {
    id: 'seedance-2.0',
    name: 'Seedance 2.0',
    minDuration: 4,
    maxDuration: 15,
    defaultDuration: -1,
    durations: [-1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    step: 1,
    resolutions: ['480p', '720p', '1080p'],
    ratios: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    description: 'Seedance 2.0 视频生成配置，支持文生视频、图生视频、首尾帧、图/视频/音频参考与同步音频。',
    hasAudio: true,
    supportedInputTypes: ['image', 'video', 'audio'],
    maxFiles: 15,
    supportsFirstAndLastFrame: true,
    supportsAllInOneReference: true,
  },
  {
    id: 'kling-v1',
    name: 'Kling V1',
    minDuration: 5,
    maxDuration: 10,
    defaultDuration: 5,
    step: 5,
    resolutions: ['720P', '1080P'],
    ratios: ['16:9', '9:16', '1:1'],
    description: '可灵 Kling 旗舰模型。支持首尾帧双图参考模式。',
    hasAudio: true,
    supportedInputTypes: ['image'],
    maxFiles: 2,
    supportsFirstAndLastFrame: true,
    supportsAllInOneReference: false,
  },
  {
    id: 'luma-dream-machine',
    name: 'Luma Dream Machine',
    minDuration: 5,
    maxDuration: 5,
    defaultDuration: 5,
    step: 0,
    resolutions: ['720P'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    description: 'Luma 梦想机。支持首尾帧插帧视频生成。',
    hasAudio: false,
    supportedInputTypes: ['image'],
    maxFiles: 2,
    supportsFirstAndLastFrame: true,
    supportsAllInOneReference: false,
  }
];

export function resolveVideoConfig(
  modelId: string,
  useCustomApi?: boolean,
  customModelName?: string,
  customAlias?: string,
  metadata?: any
): VideoModelConfig {
  if (useCustomApi && metadata && (metadata.resolutions || metadata.ratios)) {
    return {
      id: customModelName || modelId,
      name: customAlias || customModelName || modelId,
      minDuration: metadata.minDuration || 4,
      maxDuration: metadata.maxDuration || 10,
      defaultDuration: metadata.defaultDuration || 5,
      durations: metadata.durations,
      step: metadata.step || 1,
      resolutions: metadata.resolutions || ['720P', '1080P'],
      ratios: metadata.ratios || ['16:9', '9:16', '1:1'],
      description: metadata.description || '由数据库保存的视频生成配置。',
      hasAudio: metadata.hasAudio !== undefined ? metadata.hasAudio : true,
      supportedInputTypes: metadata.supportedInputTypes || ['image', 'video', 'audio'],
      maxFiles: metadata.maxFiles || 6,
      supportsFirstAndLastFrame: metadata.supportsFirstAndLastFrame !== undefined ? metadata.supportsFirstAndLastFrame : true,
      supportsAllInOneReference: metadata.supportsAllInOneReference !== undefined ? metadata.supportsAllInOneReference : true,
    };
  }

  const targetId = [modelId, useCustomApi ? customModelName : '', useCustomApi ? customAlias : ''].filter(Boolean).join(' ').toLowerCase().replace(/[\s_\.\-]/g, '');
  
  // Advanced Pattern Matching
  const found = BUILT_IN_VIDEO_MODELS.find(m => {
    const mId = m.id.toLowerCase().replace(/[\s_\.\-]/g, '');
    const mName = m.name.toLowerCase().replace(/[\s_\.\-]/g, '');
    return mId === targetId || 
    mName === targetId ||
    targetId.includes(mId) ||
    (targetId.includes('sora') && m.id === 'sora') ||
    (targetId.includes('runway') && m.id === 'runway-gen-3') ||
    (targetId.includes('gen3') && m.id === 'runway-gen-3') ||
    (targetId.includes('cogvideo') && m.id === 'cogvideox-5b') ||
    (targetId.includes('kling') && m.id === 'kling-v1') ||
    (targetId.includes('dreammachine') && m.id === 'luma-dream-machine') ||
    (targetId.includes('luma') && m.id === 'luma-dream-machine') ||
    (targetId.includes('seedance') && m.id === 'seedance-2.0');
  });

  if (found) return found;

  // 2. Generic fallback for custom APIs or unknown models
  return {
    id: (useCustomApi && customModelName) ? customModelName : (modelId || 'generic-video'),
    name: (useCustomApi && customModelName) ? customModelName : (modelId || '自定义视频模型'),
    minDuration: 4,
    maxDuration: 10,
    defaultDuration: 5,
    step: 1,
    resolutions: ['720P', '1080P'],
    ratios: ['16:9', '9:16', '1:1'],
    description: '通用的视频生成配置。如需特定优化，请联系经理同步模型 Meta 信息。',
    hasAudio: true,
    supportedInputTypes: ['image', 'video', 'audio'],
    maxFiles: 6,
    supportsFirstAndLastFrame: true,
    supportsAllInOneReference: true,
  };
}
