export type ApiFetchOptions = RequestInit & {
  query?: Record<string, string | number | boolean | undefined | null>;
};

export type ApiError = Error & {
  status?: number;
  code?: string;
  details?: unknown;
};

function isPipelineAssistantSmokeEnabled() {
  const queryEnabled = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('assistantSmoke') === '1';
  return typeof window !== 'undefined' && (
    queryEnabled ||
    window.localStorage.getItem('pipeline_assistant_smoke') === '1' ||
    window.sessionStorage.getItem('pipeline_assistant_smoke') === '1'
  );
}

export async function getAuthHeaders(baseHeaders: HeadersInit = {}): Promise<HeadersInit> {
  const headers = { ...(baseHeaders as Record<string, string>) };
  if (isPipelineAssistantSmokeEnabled()) {
    headers['x-pipeline-assistant-smoke'] = '1';
  }
  return headers;
}

export async function apiFetch<T = any>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const query = new URLSearchParams();
  Object.entries(options.query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) query.set(key, String(value));
  });

  const url = query.size > 0 ? `${path}?${query.toString()}` : path;
  const response = await fetch(url, {
    ...options,
    headers: await getAuthHeaders(options.headers || {})
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed: ${response.status}`) as ApiError;
    error.status = response.status;
    error.code = data.code;
    error.details = data.details;
    throw error;
  }
  return data as T;
}

export async function apiJson<T = any>(path: string, body: any, options: ApiFetchOptions = {}): Promise<T> {
  return apiFetch<T>(path, {
    ...options,
    method: options.method || "POST",
    headers: {
      "Content-Type": "application/json",
      ...((options.headers || {}) as Record<string, string>)
    },
    body: JSON.stringify(body)
  });
}
