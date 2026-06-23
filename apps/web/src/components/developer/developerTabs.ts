export type DeveloperTabId = 'models' | 'prompt-optimization' | 'library' | 'announcements' | 'system';

export const developerTabs: Array<{ id: DeveloperTabId; label: string; description: string }> = [
  { id: 'models', label: '模型中心', description: '模型配置、密钥、连接测试与参数探测' },
  { id: 'prompt-optimization', label: '提示词优化', description: '视频、生图、反推、改图和音乐提示词身份设定' },
  { id: 'library', label: '素材库', description: '所有项目已转为团队资源的素材汇总' },
  { id: 'announcements', label: '公告发布', description: '向全站账号发布公告' },
  { id: 'system', label: '系统状态与日志', description: '服务健康、队列、工作流与审计日志' }
];
