import type { LocalAuthUser } from './authTypes';

export async function parseAuthResponse(response: Response): Promise<LocalAuthUser> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success || !data.user) {
    throw new Error(data.error || '认证请求失败。');
  }
  return data.user as LocalAuthUser;
}

export async function parseJsonMutation(response: Response): Promise<any> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || '请求失败。');
  }
  return data;
}

export async function fetchCurrentUser(): Promise<LocalAuthUser | null> {
  const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.error || '无法读取当前登录状态。');
  }
  return data.user || null;
}

export async function assertGoogleOAuthConfigured() {
  const response = await fetch('/api/auth/providers', { credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  const google = data?.providers?.google;
  if (!response.ok || !google?.enabled) {
    const redirectUri = google?.redirectUri || `${window.location.origin}/api/auth/google/callback`;
    throw new Error(`Google OAuth 尚未配置。请在 Google Cloud OAuth Client 中添加回调地址：${redirectUri}，并在 .env 设置 GOOGLE_OAUTH_CLIENT_ID 和 GOOGLE_OAUTH_CLIENT_SECRET。`);
  }
}

export async function sendHeartbeat() {
  const response = await fetch('/api/auth/heartbeat', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error('Heartbeat failed.');
  }
}
