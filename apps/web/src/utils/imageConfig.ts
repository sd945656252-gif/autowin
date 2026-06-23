export interface ImageModelConfig {
  id: string;
  name: string;
  resolutions: string[];
  ratios: string[];
  qualities: string[];
  description: string;
  supportsAspectRatio?: boolean;
  supportsResolution?: boolean;
  supportsQuality?: boolean;
  supportsNegativePrompt?: boolean;
  maxImages?: number;
}

const GPT_IMAGE_2_RATIOS = ['auto', '1:3', '9:16', '2:3', '3:4', '4:5', '1:1', '5:4', '4:3', '3:2', '16:9', '21:9', '2:1', '3:1'];
const GEMINI_3_FLASH_IMAGE_RATIOS = ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'];
const GEMINI_3_PRO_IMAGE_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

export const BUILT_IN_IMAGE_MODELS: ImageModelConfig[] = [
  {
    id: 'flux-1-pro',
    name: 'Flux.1 Pro [Official]',
    resolutions: ['1K', '2K', '4K'],
    ratios: ['1:1', '16:9', '9:16', '3:2', '2:3', '21:9', '4:5', '5:4'],
    qualities: ['standard', 'high'],
    description: 'Black Forest Labs 旗舰模型，支持电影级超清输出。'
  },
  {
    id: 'flux-1-dev',
    name: 'Flux.1 Dev',
    resolutions: ['1K', '2K'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    qualities: ['standard'],
    description: '开发者社区首选，兼顾速度与画质。'
  },
  {
    id: 'midjourney-v6',
    name: 'Midjourney V6',
    resolutions: ['1K', '2K'],
    ratios: ['1:1', '16:9', '9:16', '2:3', '3:2', '4:5', '5:4'],
    qualities: ['standard', 'high', 'low'],
    description: '顶级艺术化生图模型，光影与纹理表现卓越。'
  },
  {
    id: 'dalle-3',
    name: 'DALL-E 3',
    resolutions: ['1K'],
    ratios: ['1:1', '16:9', '9:16'],
    qualities: ['standard', 'hd'],
    description: 'OpenAI 语义对齐最强的生图模型。'
  },
  {
    id: 'sd-3.5-large',
    name: 'Stable Diffusion 3.5 Large',
    resolutions: ['1K', '2K'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
    qualities: ['standard'],
    description: 'Stability AI 最新开源旗舰，支持复杂的排版与语义。'
  },
  {
    id: 'gpt-image-2',
    name: 'gpt-image-2',
    resolutions: [],
    ratios: GPT_IMAGE_2_RATIOS,
    qualities: ['low', 'medium', 'high', 'auto'],
    description: 'GPT Image 兼容配置。比例和尺寸按当前官方 Images API 可接受范围收口。',
    supportsAspectRatio: true,
    supportsResolution: false,
    supportsQuality: true,
    supportsNegativePrompt: false,
    maxImages: 1
  },
  {
    id: 'stable-diffusion-xl',
    name: 'STABLE-DIFFUSION-XL',
    resolutions: ['1K', '2K', '4K'],
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
    qualities: ['standard', 'high'],
    description: 'SDXL 高画质出图模型，提供极佳的艺术风格与细节表现。'
  },
  {
    id: 'nano-banana-2',
    name: 'nano-banana-2 / gemini-3.1-flash-image',
    resolutions: ['512', '1K', '2K', '4K'],
    ratios: GEMINI_3_FLASH_IMAGE_RATIOS,
    qualities: [],
    description: 'Nano Banana 2 对应 Gemini 3.1 Flash Image，适合快速图像生成。'
  },
  {
    id: 'nano-banana-pro',
    name: 'nano-banana-pro / gemini-3-pro-image',
    resolutions: ['1K', '2K', '4K'],
    ratios: GEMINI_3_PRO_IMAGE_RATIOS,
    qualities: [],
    description: 'Nano Banana Pro 对应 Gemini 3 Pro Image，支持更高质量图像输出。'
  }
];

export function resolveImageConfig(
  modelId: string,
  useCustomApi?: boolean,
  customModelName?: string,
  customAlias?: string,
  metadata?: any
): ImageModelConfig {
  const nameLower = (customModelName || modelId || '').toLowerCase();
  const defaultMaxImages = nameLower.includes('gpt-image-2')
    ? 16
    : (nameLower.includes('midjourney') || nameLower.includes('mj'))
      ? 5
      : (nameLower.includes('dall-e') || nameLower.includes('dalle') || nameLower.includes('imagen'))
        ? 1
        : 4;

  if (useCustomApi && metadata) {
    return {
      id: customModelName || modelId,
      name: customAlias || customModelName || modelId,
      resolutions: metadata.resolutions || ['1K', '2K'],
      ratios: metadata.ratios || ['1:1', '16:9', '9:16'],
      qualities: metadata.qualities || ['standard'],
      description: metadata.description || '由数据库保存的模型配置。',
      supportsAspectRatio: metadata.supportsAspectRatio !== undefined ? metadata.supportsAspectRatio : true,
      supportsResolution: metadata.supportsResolution !== undefined ? metadata.supportsResolution : true,
      supportsQuality: metadata.supportsQuality !== undefined ? metadata.supportsQuality : true,
      supportsNegativePrompt: metadata.supportsNegativePrompt !== undefined ? metadata.supportsNegativePrompt : true,
      maxImages: nameLower.includes('gpt-image-2') ? 16 : (metadata.maxImages !== undefined ? metadata.maxImages : (metadata.max_images !== undefined ? metadata.max_images : defaultMaxImages))
    };
  }

  const targetId = [modelId, useCustomApi ? customModelName : '', useCustomApi ? customAlias : ''].filter(Boolean).join(' ').toLowerCase().replace(/[\s_\.\-]/g, '');
  
  // Advanced Pattern Matching for "Official Parameters"
  const found = BUILT_IN_IMAGE_MODELS.find(m => {
    const mId = m.id.toLowerCase().replace(/[\s_\.\-]/g, '');
    const mName = m.name.toLowerCase().replace(/[\s_\.\-]/g, '');
    return mId === targetId || 
    mName === targetId ||
    targetId.includes(mId) ||
    (targetId.includes('flux') && m.id === 'flux-1-pro') ||
    (targetId.includes('mj') && m.id === 'midjourney-v6') ||
    (targetId.includes('midjourney') && m.id === 'midjourney-v6') ||
    (targetId.includes('dalle') && m.id === 'dalle-3') ||
    (targetId.includes('sd35') && m.id === 'sd-3.5-large') ||
    (targetId.includes('stablediffusion3') && m.id === 'sd-3.5-large') ||
    (targetId.includes('stablediffusionxl') && m.id === 'stable-diffusion-xl') ||
    (targetId.includes('sdxl') && m.id === 'stable-diffusion-xl') ||
    (targetId.includes('gptimage') && m.id === 'gpt-image-2') ||
    (targetId.includes('nanobanana2') && m.id === 'nano-banana-2') ||
    (targetId.includes('gemini31flashimage') && m.id === 'nano-banana-2') ||
    (targetId.includes('nanobananapro') && m.id === 'nano-banana-pro') ||
    (targetId.includes('gemini3proimage') && m.id === 'nano-banana-pro');
  });

  if (found) {
    return {
      ...found,
      maxImages: found.maxImages || defaultMaxImages
    };
  }

  return {
    id: (useCustomApi && customModelName) ? customModelName : (modelId || 'generic-image'),
    name: (useCustomApi && customModelName) ? customModelName : (modelId || '自定义生图模型'),
    resolutions: ['1K', '2K'],
    ratios: ['1:1', '16:9', '9:16'],
    qualities: ['low', 'standard', 'high'],
    description: '通用的生图配置。',
    maxImages: defaultMaxImages
  };
}
