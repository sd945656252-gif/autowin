import { apiJson, getAuthHeaders } from '../api';

export async function uploadNotificationAttachment(file: File): Promise<{
  assetId: string;
  originalName: string;
  mimeType?: string | null;
}> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/media/upload', {
    method: 'POST',
    body: formData,
    headers: await getAuthHeaders()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  if (!data.assetId) throw new Error('附件上传失败，缺少素材 ID。');
  return {
    assetId: data.assetId,
    originalName: data.originalName || file.name,
    mimeType: data.mimeType || file.type || null
  };
}

export async function sendProjectNotice(input: {
  projectId: string;
  receiverId: string;
  title: string;
  content: string;
  attachmentMediaAssetIds?: string[];
}) {
  return apiJson('/api/notifications/notice', input);
}

export async function sendProjectBroadcast(input: {
  projectId: string;
  title: string;
  content: string;
  attachmentMediaAssetIds?: string[];
}) {
  return apiJson('/api/notifications/broadcast', input);
}

export async function sendAnnouncement(input: {
  scope: 'GLOBAL';
  title: string;
  content: string;
  attachmentMediaAssetIds?: string[];
}) {
  return apiJson('/api/notifications/announcements', input);
}
