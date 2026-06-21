import type { Attachment } from '../../services/geminiService';
import type { PromptOptimizationProfileKey } from '../../types';

export type Mode = 'auto' | 'light' | 'standard' | 'cinematic';
export type FeatureMode = 'prompt' | 'reverse' | 'edit' | 'image_prompt' | 'music_prompt';
export type ImagePromptGear = 'regular' | 'extreme';
export type ModelType = string;

export type PromptOptimizationTaskSession = {
  taskId: string;
  featureMode: FeatureMode;
  status: string;
  progress: number;
  isResumed: boolean;
};

export interface StyleOption {
  id: string;
  label: string;
  preview: string;
  description?: string;
  category?: string;
}

export type HistoryItem = {
  id: string;
  timestamp: Date;
  featureMode: FeatureMode;
  input: string;
  output: string;
  attachments: { name: string; mimeType: string; data: string; isPruned?: boolean; cloudAttachmentId?: string }[];
  model: string;
  mode?: string;
  wordCount?: string;
  duration?: string;
  imagePromptGear?: string;
  techniques?: string[];
  styles?: string[];
  promptCount?: number;
  customModelId?: string;
  customModelAlias?: string;
};

export interface UndoState {
  input: string;
  attachments: Attachment[];
  mode: Mode;
  featureMode: FeatureMode;
  imagePromptGear: ImagePromptGear;
  selectedModel: ModelType;
  selectedTechniques: string[];
  selectedStyles: string[];
  promptCount: number;
  duration: string;
  wordCount: string;
}

export interface PromptMatrixProps {
  currentUserRole?: 'ADMIN' | 'DEVELOPER' | 'USER' | '管理者' | '助理' | '成员' | null;
  currentProjectId?: string | null;
  shots?: any[];
  onUpdateShots?: (newShots: any[]) => void;
  promptOptimizationProfiles?: Partial<Record<PromptOptimizationProfileKey, string>>;
  embeddedInConfig?: boolean;
}
