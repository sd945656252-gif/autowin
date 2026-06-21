export type ShowcaseMetadata = {
  title: string;
  category: string;
};

export type ShowcasePreview = {
  title: string;
  category: string;
  synopsis: string;
  promptUsed: string;
  directorNotes: string;
};

export const MAIN_SHOWCASE_KEYS = ['mv', 'sword', 'santi'];

export const DEFAULT_SHOWCASE_VIDEOS: Record<string, string | null> = {
  mv: null,
  sword: null,
  santi: null,
  'extra-1': null,
  'extra-2': null,
  'extra-3': null,
  'extra-4': null,
  'extra-5': null,
  'extra-6': null
};

export const DEFAULT_SHOWCASE_METADATA: Record<string, ShowcaseMetadata> = {
  mv: { title: '《生》 MV', category: '音乐视频' },
  sword: { title: '雪刀 (Snow Sword)', category: '游戏概念预演' },
  santi: { title: '三体 - 衍生短片', category: '科幻微电影' },
  'extra-1': { title: '明日之境', category: '科幻概念预演' },
  'extra-2': { title: '赛博纪元', category: '都市朋克概念' },
  'extra-3': { title: '武神崛起', category: '动作动态捕捉' },
  'extra-4': { title: '古迹迷踪', category: '写实遗迹建模' },
  'extra-5': { title: '机械革命', category: '重机工业预演' },
  'extra-6': { title: '微光星球', category: '物理体积光效' }
};

export const FALLBACK_SHOWCASE_METADATA: ShowcaseMetadata = {
  title: '未命名动态作品',
  category: '极影概念预演'
};

export function sortShowcaseKeys(a: string, b: string) {
  const aIdx = MAIN_SHOWCASE_KEYS.indexOf(a);
  const bIdx = MAIN_SHOWCASE_KEYS.indexOf(b);
  if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
  if (aIdx !== -1) return -1;
  if (bIdx !== -1) return 1;
  const aNum = parseInt(a.split('-')[1] || '0', 10) || 0;
  const bNum = parseInt(b.split('-')[1] || '0', 10) || 0;
  return aNum - bNum;
}

export function getNextExtraShowcaseKey(videos: Record<string, string | null>) {
  const existingExtraIndices = Object.keys(videos)
    .filter((key) => key.startsWith('extra-'))
    .map((key) => parseInt(key.split('-')[1] || '0', 10))
    .filter((value) => !Number.isNaN(value));

  const maxIndex = existingExtraIndices.length > 0 ? Math.max(...existingExtraIndices) : 0;
  return `extra-${maxIndex + 1}`;
}
