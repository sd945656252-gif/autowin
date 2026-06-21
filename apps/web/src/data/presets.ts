import { CanvasNode, PromptShot, ReferenceFile, VideoClip } from '../types';

export const initialReferences: ReferenceFile[] = [
  { id: 'ref1', name: '三体_黑暗森林_摘录.md', category: 'story' },
  { id: 'ref2', name: '世界观设定大纲.docx', category: 'story' },
  { id: 'ref3', name: '银翼杀手_剧照集.zip', category: 'art' },
  { id: 'ref4', name: '大雨中低音沉静节奏.mp3', category: 'music' },
  { id: 'ref5', name: '赛博街道_背景音效.wav', category: 'music' },
  { id: 'ref6', name: '动作捕捉参考_打斗.mp4', category: 'video' },
  { id: 'ref7', name: '高空俯视_参考图.jpg', category: 'art' }
];

export const initialShots: PromptShot[] = [
  {
    id: 'shot1',
    shotNumber: 'Sc01_01',
    duration: '4s',
    shotType: '特写 (CU)',
    cameraMotion: '缓慢推镜 (Dolly In)',
    visualPrompt: 'Cinematic close-up of a muddy water puddle on a cyberpunk street, reflecting neon lights, heavy rain falling, dark and gritty tone, 8k resolution, photorealistic.',
    motionPrompt: 'Slow push in towards the puddle, heavy rain splashing on the water surface, neon reflection shimmering and distorting.',
    remarks: '画面水洼倒影必须清晰渲染出环境光晕'
  },
  {
    id: 'shot2',
    shotNumber: 'Sc01_02',
    duration: '3s',
    shotType: '中景 (MS)',
    cameraMotion: '固定 (Static)',
    visualPrompt: 'Medium shot, a female cyborg named Mumu hiding behind an abandoned vending machine, cyberpunk alleyway, battle-damaged armor, muddy face, breathing heavily.',
    motionPrompt: 'Character breathing heavily, shoulders moving up and down, rain pouring constantly in the background.',
    remarks: '注意战甲的破损细节要和美术资产设定一致。'
  },
  {
    id: 'shot3',
    shotNumber: 'Sc01_03',
    duration: '5s',
    shotType: '全景 (WS)',
    cameraMotion: '低角度仰拍',
    visualPrompt: 'Wide shot, low angle, a massive villain search drone hovering above the cyberpunk street, red scanning laser beam sweeping across the wet ground, oppressive atmosphere.',
    motionPrompt: 'Drone hovering ominously, red laser beam actively sweeping back and forth, illuminating the dark street.',
    remarks: '无人机投射的红光范围要配合 Mumu 所藏身处的反转明暗。'
  }
];

export const initialNodes: CanvasNode[] = [
  {
    id: 'node1',
    name: 'Mumu视窗',
    type: '角色',
    x: 100,
    y: 80,
    parentId: null,
    collapsed: false
  },
];

export const initialVideos: VideoClip[] = [
  { id: 'v1', name: '001_环境空镜.mp4', duration: '00:05', thumbnail: 'https://images.unsplash.com/photo-1515630278258-407f66498911?q=80&w=300&auto=format&fit=crop' },
  { id: 'v2', name: '002_机甲特写.mp4', duration: '00:12', thumbnail: 'https://images.unsplash.com/photo-1605806616949-1e87b487cb2a?q=80&w=300&auto=format&fit=crop' },
  { id: 'v3', name: '003_爆炸高潮.mp4', duration: '00:08', thumbnail: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=300&auto=format&fit=crop', active: true }
];
