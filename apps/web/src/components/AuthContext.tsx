import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { get, set } from 'idb-keyval';
import { CanvasState, CustomApiConfig, HistoryItem, SavedPrompt } from '../types';
import { deleteCustomApiConfig, fetchCanvasState, saveCustomApiConfig } from '../lib/db';
import { assertGoogleOAuthConfigured, fetchCurrentUser, parseAuthResponse, parseJsonMutation, sendHeartbeat } from './auth/authApi';
import { type LocalAuthUser, type AuthRole } from './auth/authTypes';
import { emptyCanvasState, loadRemoteAuthData, loadStoredAuthData, persistAuthData, saveGlobalApiConfigsForUser, saveScopedCanvas, syncCanvasToServer, withCanvasProjectMetadata } from './auth/authStorage';

export type { LocalAuthUser, AuthRole } from './auth/authTypes';

interface AuthContextType {
  user: LocalAuthUser | null;
  role: AuthRole;
  setRole: (role: AuthRole) => void;
  loading: boolean;
  login: () => Promise<void>;
  loginByEmail: (email: string, pass: string) => Promise<void>;
  signUpByEmail: (email: string, pass: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (displayName: string, photoURL: string) => Promise<LocalAuthUser>;
  sendPasswordReset: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  saveCanvas: (state: CanvasState, projectId?: string | null) => Promise<void>;
  loadCanvasForProject: (projectId?: string | null) => Promise<CanvasState>;
  canvasState: CanvasState | null;
  globalApiConfigs: CustomApiConfig[] | null;
  saveGlobalApiConfigs: (configs: CustomApiConfig[]) => Promise<void>;
  saveGlobalApiConfig: (config: CustomApiConfig) => Promise<CustomApiConfig | null>;
  deleteGlobalApiConfig: (configId: string) => Promise<void>;
  history: HistoryItem[];
  setHistory: React.Dispatch<React.SetStateAction<HistoryItem[]>>;
  savedPrompts: SavedPrompt[];
  setSavedPrompts: React.Dispatch<React.SetStateAction<SavedPrompt[]>>;
  isHistoryLoaded: boolean;
  isSavedPromptsLoaded: boolean;
  activeCustomApiId: string;
  setActiveCustomApiId: (id: string) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  saveSettings: (activeId: string, model: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<LocalAuthUser | null>(null);
  const [role, setRole] = useState<AuthRole>('USER');
  const [loading, setLoading] = useState(true);
  const [canvasState, setCanvasState] = useState<CanvasState | null>(null);
  const [globalApiConfigs, setGlobalApiConfigs] = useState<CustomApiConfig[] | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>([]);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [isSavedPromptsLoaded, setIsSavedPromptsLoaded] = useState(false);

  const [activeCustomApiId, setActiveCustomApiId] = useState<string>(() => {
    return localStorage.getItem('guest_active_api_id_v3') || 'default';
  });
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem('selected_model_v2') || 'custom';
  });

  useEffect(() => {
    let cancelled = false;
    fetchCurrentUser()
      .then((currentUser) => {
        if (cancelled) return;
        setUser(currentUser);
        setRole(currentUser?.role || 'USER');
      })
      .catch((error) => {
        console.warn('[AuthContext] Failed to load local session:', error);
        if (!cancelled) {
          setUser(null);
          setRole('USER');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    let stopped = false;
    const heartbeat = () => {
      if (stopped || document.visibilityState === 'hidden') return;
      sendHeartbeat().catch((error) => console.warn('[AuthContext] Heartbeat failed:', error));
    };

    heartbeat();
    const interval = window.setInterval(heartbeat, 60_000);
    const onVisibilityChange = () => heartbeat();
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    const ownerId = user?.uid || 'guest';

    const loadUserData = async () => {
      try {
        const { localCanvas, localHistory, localSaved } = await loadStoredAuthData(ownerId);
        if (cancelled) return;
        if (localCanvas) setCanvasState(localCanvas);
        if (localHistory) setHistory(localHistory);
        if (localSaved) setSavedPrompts(localSaved);

        const canManageApiConfigs = user?.role === 'ADMIN' || user?.role === 'DEVELOPER';
        const { remoteCanvas, remoteHistory, remoteSaved, remoteConfigs } = user
          ? await loadRemoteAuthData(ownerId, canManageApiConfigs)
          : {
              remoteCanvas: localCanvas || emptyCanvasState(null),
              remoteHistory: localHistory || [],
              remoteSaved: localSaved || [],
              remoteConfigs: [] as CustomApiConfig[]
            };
        if (cancelled) return;

        const hasRemoteCanvas = (remoteCanvas.nodes?.length || remoteCanvas.shotNodes?.length || remoteCanvas.shots?.length);
        const nextCanvas = withCanvasProjectMetadata(hasRemoteCanvas ? remoteCanvas : (localCanvas || remoteCanvas), null);
        setCanvasState(nextCanvas);
        setHistory(remoteHistory);
        setSavedPrompts(remoteSaved);
        setGlobalApiConfigs(remoteConfigs.filter(c => !['cfg_dalle3_default', 'cfg_sd_default', 'cfg_luma_default'].includes(c.id)));
        setIsHistoryLoaded(true);
        setIsSavedPromptsLoaded(true);

        await persistAuthData(ownerId, nextCanvas, remoteHistory, remoteSaved);
      } catch (error) {
        console.error('[AuthContext] Failed to load user data:', error);
        if (!cancelled) {
          setCanvasState(emptyCanvasState(null));
          setGlobalApiConfigs([]);
          setIsHistoryLoaded(true);
          setIsSavedPromptsLoaded(true);
        }
      }
    };

    loadUserData();
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  const login = async () => {
    await assertGoogleOAuthConfigured();
    window.location.href = '/api/auth/google';
  };

  const loginByEmail = async (email: string, pass: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass })
    });
    const nextUser = await parseAuthResponse(response);
    setUser(nextUser);
    setRole(nextUser.role || 'USER');
  };

  const signUpByEmail = async (email: string, pass: string, name?: string) => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pass, displayName: name })
    });
    const nextUser = await parseAuthResponse(response);
    setUser(nextUser);
    setRole(nextUser.role || 'USER');
  };

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    setUser(null);
    setRole('USER');
  };

  const updateProfile = async (displayName: string, photoURL: string) => {
    const response = await fetch('/api/auth/profile', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName, photoURL })
    });
    const nextUser = await parseAuthResponse(response);
    setUser(nextUser);
    setRole(nextUser.role || 'USER');
    return nextUser;
  };

  const sendPasswordReset = async () => {
    throw new Error('当前本地账号体系未配置邮件服务。请在登录状态下使用“修改本地密码”。');
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    const response = await fetch('/api/auth/password/change', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await parseJsonMutation(response);
    if (data.user) {
      const nextUser = data.user as LocalAuthUser;
      setUser(nextUser);
      setRole(nextUser.role || 'USER');
    }
  };

  const loadCanvasForProject = useCallback(async (projectId?: string | null) => {
    const ownerId = user?.uid || 'guest';
    const storageKey = projectId ? `canvasState_${ownerId}_${projectId}` : `canvasState_${ownerId}`;
    const localCanvas = await get(storageKey) as CanvasState | undefined;
    if (!user) {
      const fallback = withCanvasProjectMetadata(localCanvas || emptyCanvasState(projectId), projectId);
      setCanvasState(fallback);
      return fallback;
    }
    const remoteCanvas = await fetchCanvasState(ownerId, projectId);
    const hasRemoteCanvas = (remoteCanvas.nodes?.length || remoteCanvas.shotNodes?.length || remoteCanvas.shots?.length);
    const nextCanvas = withCanvasProjectMetadata(hasRemoteCanvas ? remoteCanvas : (localCanvas || remoteCanvas), projectId);
    setCanvasState(nextCanvas);
    await set(storageKey, nextCanvas);
    return nextCanvas;
  }, [user?.uid]);

  const saveCanvas = useCallback(async (state: CanvasState, projectId?: string | null) => {
    const ownerId = user?.uid || 'guest';
    const { scopedState, cleanState } = await saveScopedCanvas(state, ownerId, projectId);
    setCanvasState(scopedState);
    if (!user) return;
    await syncCanvasToServer(cleanState, ownerId, projectId);
  }, [user?.uid]);

  const saveGlobalApiConfigs = useCallback(async (configs: CustomApiConfig[]) => {
    if (user?.role !== 'ADMIN' && user?.role !== 'DEVELOPER') return;
    const previousConfigs = globalApiConfigs || [];
    const ownerId = user?.uid || 'guest';
    setGlobalApiConfigs(configs);
    if (!user) return;
    const persistedConfigs = await saveGlobalApiConfigsForUser(configs, previousConfigs, ownerId);
    if (persistedConfigs.length > 0) {
      setGlobalApiConfigs(persistedConfigs.filter(c => !['cfg_dalle3_default', 'cfg_sd_default', 'cfg_luma_default'].includes(c.id)));
    }
  }, [globalApiConfigs, user?.uid]);

  const saveGlobalApiConfig = useCallback(async (config: CustomApiConfig) => {
    if (user?.role !== 'ADMIN' && user?.role !== 'DEVELOPER') return null;
    if (!user) return null;
    const saved = await saveCustomApiConfig(config, user.uid || user.id);
    if (saved) {
      setGlobalApiConfigs((prev) => {
        const current = prev || [];
        const withoutDraftOrExisting = current.filter((item) => item.id !== config.id && item.id !== saved.id);
        return [saved, ...withoutDraftOrExisting].filter(c => !['cfg_dalle3_default', 'cfg_sd_default', 'cfg_luma_default'].includes(c.id));
      });
    }
    return saved;
  }, [user]);

  const deleteGlobalApiConfig = useCallback(async (configId: string) => {
    if (user?.role !== 'ADMIN' && user?.role !== 'DEVELOPER') return;
    if (!user || configId.startsWith('draft_')) return;
    await deleteCustomApiConfig(configId, user.uid || user.id);
    setGlobalApiConfigs((prev) => (prev || []).filter((config) => config.id !== configId));
  }, [user]);

  const saveSettings = useCallback(async (activeId: string, model: string) => {
    setActiveCustomApiId(activeId);
    setSelectedModel(model);
    localStorage.setItem('guest_active_api_id_v3', activeId);
    localStorage.setItem('selected_model_v2', model);
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      role,
      setRole,
      loading,
      login,
      loginByEmail,
      signUpByEmail,
      logout,
      updateProfile,
      sendPasswordReset,
      changePassword,
      saveCanvas,
      loadCanvasForProject,
      canvasState,
      globalApiConfigs,
      saveGlobalApiConfigs,
      saveGlobalApiConfig,
      deleteGlobalApiConfig,
      history,
      setHistory,
      savedPrompts,
      setSavedPrompts,
      isHistoryLoaded,
      isSavedPromptsLoaded,
      activeCustomApiId,
      setActiveCustomApiId,
      selectedModel,
      setSelectedModel,
      saveSettings
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
