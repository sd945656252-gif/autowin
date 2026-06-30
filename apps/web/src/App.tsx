/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { lazy, Suspense, useCallback, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, Trash2, Upload, X } from 'lucide-react';
import Header from './components/Header';
import { useAuth } from './components/AuthContext';
import { ShowcaseGrid } from './components/showcase/ShowcaseGrid';
import {
  DEFAULT_SHOWCASE_METADATA,
  DEFAULT_SHOWCASE_VIDEOS,
  type ShowcaseMetadata,
  type ShowcasePreview
} from './data/showcase';

const FuwaApp = lazy(() => import('./components/FuwaApp'));
const AdminPage = lazy(() => import('./components/AdminPage'));
const DeveloperPage = lazy(() => import('./components/DeveloperPage'));
const TeamManagementPage = lazy(() => import('./components/TeamManagementPage'));
const HistoryPage = lazy(() => import('./components/HistoryPage'));
const NewsPage = lazy(() => import('./components/NewsPage'));
const DashboardPage = lazy(() => import('./components/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const Scene3DNodePreviewPage = lazy(() => import('./components/Scene3DNodePreviewPage'));
const MAX_SHOWCASE_VIDEO_BYTES = 1024 * 1024 * 1024;

type AppView = 'home' | 'dashboard' | 'pipeline' | 'scene3dPreview' | 'news' | 'developer' | 'team' | 'history' | 'admin';

const VIEW_PATHS: Record<AppView, string> = {
  home: '/',
  dashboard: '/dashboard',
  pipeline: '/pipeline',
  scene3dPreview: '/dev/scene3d-node-preview',
  news: '/news',
  developer: '/developer',
  team: '/team',
  history: '/history',
  admin: '/admin'
};

const ACTIVE_PIPELINE_PROJECT_STORAGE_KEY = 'jiying-active-pipeline-project-id';

function viewFromPath(pathname: string): AppView {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const match = (Object.entries(VIEW_PATHS) as Array<[AppView, string]>).find(([, path]) => path === normalized);
  return match?.[0] || 'home';
}

function readPipelineProjectIdFromUrl(search = window.location.search) {
  const value = new URLSearchParams(search).get('projectId');
  return value?.trim() || null;
}

function readStoredPipelineProjectId() {
  return sessionStorage.getItem(ACTIVE_PIPELINE_PROJECT_STORAGE_KEY)?.trim() || null;
}

function pipelineUrl(projectId?: string | null) {
  const trimmed = projectId?.trim();
  return trimmed ? `/pipeline?projectId=${encodeURIComponent(trimmed)}` : '/pipeline';
}

function RouteLoading({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center justify-center ${compact ? 'min-h-[280px]' : 'min-h-screen'} text-[10px] font-mono uppercase tracking-widest text-zinc-500`}>
      Loading view...
    </div>
  );
}

function formatNewsDateGroup(value?: string) {
  if (!value) return '';
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

type ShowcaseRegistryResponse = {
  videos?: Record<string, string | null>;
  metadata?: Record<string, ShowcaseMetadata>;
};

async function fetchShowcaseRegistry(): Promise<ShowcaseRegistryResponse> {
  const response = await fetch('/api/videos', { credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to load showcase works.');
  return data;
}

function applyRegistryToShowcase(data: ShowcaseRegistryResponse) {
  const videos = { ...DEFAULT_SHOWCASE_VIDEOS, ...(data.videos || {}) };
  const metadata = { ...DEFAULT_SHOWCASE_METADATA, ...(data.metadata || {}) };
  return { videos, metadata };
}



export default function App() {
  const { user, role: currentUserRole, loading: isAuthLoading } = useAuth();
  const queryClient = useQueryClient();
  const [currentView, setCurrentViewState] = useState<AppView>(() => viewFromPath(window.location.pathname));
  const [activePipelineProjectId, setActivePipelineProjectId] = useState<string | null>(() => (
    viewFromPath(window.location.pathname) === 'pipeline'
      ? readPipelineProjectIdFromUrl() || readStoredPipelineProjectId()
      : null
  ));
  const setCurrentView = useCallback((view: AppView) => {
    setCurrentViewState(view);
  }, []);
  const [news, setNews] = useState<any[]>([]);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const canOpenDeveloperArea = currentUserRole === 'ADMIN' || currentUserRole === 'DEVELOPER';

  useEffect(() => {
    const handlePopState = () => {
      const nextView = viewFromPath(window.location.pathname);
      setCurrentViewState(nextView);
      if (nextView === 'pipeline') {
        setActivePipelineProjectId(readPipelineProjectIdFromUrl() || readStoredPipelineProjectId());
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if ((import.meta as any).env?.DEV !== true) return;
    let stopped = false;
    let lastBootId = sessionStorage.getItem('jiying-dev-boot-id') || '';

    const checkServerBoot = async () => {
      try {
        const response = await fetch('/api/dev/boot', { cache: 'no-store', credentials: 'same-origin' });
        if (!response.ok) return;
        const data = await response.json().catch(() => null);
        const bootId = typeof data?.bootId === 'string' ? data.bootId : '';
        if (!bootId) return;
        if (!lastBootId) {
          lastBootId = bootId;
          sessionStorage.setItem('jiying-dev-boot-id', bootId);
          return;
        }
        if (bootId !== lastBootId) {
          sessionStorage.setItem('jiying-dev-boot-id', bootId);
          window.location.reload();
        }
      } catch {
        // The API server may be between tsx watch restarts; the next poll will refresh once it is back.
      }
    };

    void checkServerBoot();
    const timer = window.setInterval(() => {
      if (!stopped) void checkServerBoot();
    }, 1500);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const nextPath = currentView === 'pipeline'
      ? pipelineUrl(activePipelineProjectId)
      : currentView === 'scene3dPreview'
        ? `${VIEW_PATHS[currentView]}${window.location.search}`
        : VIEW_PATHS[currentView];
    const nextHash = currentView === 'developer' && window.location.hash === '#developer-models' ? window.location.hash : '';
    const nextUrl = `${nextPath}${nextHash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentUrl !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  }, [activePipelineProjectId, currentView]);

  useEffect(() => {
    if (currentView !== 'pipeline') return;
    const projectId = activePipelineProjectId?.trim();
    if (projectId) {
      sessionStorage.setItem(ACTIVE_PIPELINE_PROJECT_STORAGE_KEY, projectId);
      return;
    }
    const restoredProjectId = readPipelineProjectIdFromUrl() || readStoredPipelineProjectId();
    if (restoredProjectId) {
      setActivePipelineProjectId(restoredProjectId);
    }
  }, [activePipelineProjectId, currentView]);

  const effectivePipelineProjectId = currentView === 'pipeline'
    ? activePipelineProjectId || readPipelineProjectIdFromUrl() || readStoredPipelineProjectId()
    : activePipelineProjectId;

  useEffect(() => {
    if (isAuthLoading) return;

    if (currentView === 'developer') {
      if (!user) {
        setShowLoginModal(true);
        setCurrentView('dashboard');
        return;
      }
      if (!canOpenDeveloperArea) {
        setCurrentView('dashboard');
      }
    }

    if (currentView === 'team') {
      if (!user) {
        setShowLoginModal(true);
        setCurrentView('dashboard');
      }
    }

    if (currentView === 'history') {
      if (!user) {
        setShowLoginModal(true);
        setCurrentView('dashboard');
      }
    }

    if (currentView === 'admin') {
      if (!user) {
        setShowLoginModal(true);
        setCurrentView('dashboard');
        return;
      }
      if (currentUserRole !== 'ADMIN') {
        setCurrentView('dashboard');
      }
    }
  }, [canOpenDeveloperArea, currentView, currentUserRole, isAuthLoading, setCurrentView, user]);

  useEffect(() => {
    fetch('/api/news/broadcast')
      .then(res => res.json())
      .then(data => {
        const headlines = (data.groups || [])
          .map((group: any) => {
            const headliner = group.items?.[0];
            if (!headliner) return null;
            return {
              ...headliner,
              dateGroup: group.dateGroup,
              publishedAt: `${group.dateGroup}T00:00:00+08:00`,
              url: headliner.sourceUrl
            };
          })
          .filter(Boolean);
        setNews(headlines);
      })
      .catch(console.error);
  }, []);

  const getLatestHeadlines = () => {
    const dates = (Array.from(new Set(news.map(n => n.dateGroup || formatNewsDateGroup(n.publishedAt)))) as string[])
                        .sort((a, b) => b.localeCompare(a)).slice(0, 3).reverse();
    return dates.map(date => {
        const filtered = news.filter(n => (n.dateGroup || formatNewsDateGroup(n.publishedAt)) === date);
        return filtered[0];
    }).filter(Boolean);
  };
  
  const latestHeadlines = getLatestHeadlines();

  const canEditShowcase = currentUserRole === 'ADMIN' || currentUserRole === 'DEVELOPER';

  const [previewWork, setPreviewWork] = useState<ShowcasePreview | null>(null);

  // 9 Total Showcase Slots (3 Main + 6 Extras) with default cinematic trailers
  const [curatedVideos, setCuratedVideos] = useState<Record<string, string | null>>({ ...DEFAULT_SHOWCASE_VIDEOS });

  // Showcase metadata with corresponding titles and categories
  const [curatedMetadata, setCuratedMetadata] = useState<Record<string, ShowcaseMetadata>>({ ...DEFAULT_SHOWCASE_METADATA });

  const showcaseQuery = useQuery({
    queryKey: ['showcase-works'],
    queryFn: fetchShowcaseRegistry,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true
  });

  // Zooming/Maximize video states
  const [maximizedVideoUrl, setMaximizedVideoUrl] = useState<string | null>(null);
  const [maximizedVideoTitle, setMaximizedVideoTitle] = useState<string>('');
  
  // Showcase slot management states (triggered ONLY after 3 rapid clicks)
  const [editingSlotKey, setEditingSlotKey] = useState<string | null>(null);
  const [uploadingKeys, setUploadingKeys] = useState<Record<string, boolean>>({});
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [showcaseMessage, setShowcaseMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Track counts and times for rapid clicks (to accurately isolate triple-click)
  const [clickTracker, setClickTracker] = useState<Record<string, { count: number; lastTime: number; timerId: any | null }>>({});

  // Unified Intelligent Client-Side Video Caching & Streaming Acceleration Engine
  useEffect(() => {
    if (!showcaseQuery.data) return;
    const next = applyRegistryToShowcase(showcaseQuery.data);
    setCuratedVideos(next.videos);
    setCuratedMetadata(next.metadata);
  }, [showcaseQuery.data]);

  useEffect(() => {
    const events = new EventSource('/api/videos/events', { withCredentials: true });
    events.addEventListener('showcase-updated', () => {
      void queryClient.invalidateQueries({ queryKey: ['showcase-works'] });
    });
    return () => events.close();
  }, [queryClient]);


  const handleVideoUpload = async (key: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && canEditShowcase) {
      if (uploadingKeys[key]) return;
      setShowcaseMessage(null);
      if (file.size > MAX_SHOWCASE_VIDEO_BYTES) {
        setShowcaseMessage({ type: 'error', text: '精选作品视频需控制在 1GB 以内。' });
        e.target.value = '';
        return;
      }
      setUploadingKeys(prev => ({ ...prev, [key]: true }));
      setUploadProgress(prev => ({ ...prev, [key]: 0 }));

      try {
        const formData = new FormData();
        formData.append("key", key);
        formData.append("file", file);
        formData.append("title", curatedMetadata[key]?.title || 'Untitled Motion Asset');
        formData.append("category", curatedMetadata[key]?.category || 'JiYing Concept');

        const responseData = await new Promise<any>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const targetUrl = `/api/videos/upload?key=${encodeURIComponent(key)}`;
          xhr.open("POST", targetUrl, true);
          xhr.withCredentials = true;
          xhr.timeout = 30 * 60 * 1000;

          xhr.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) {
              const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
              setUploadProgress(prev => ({ ...prev, [key]: percent }));
            }
          });

          xhr.onload = () => {
            const payload = (() => {
              try {
                return JSON.parse(xhr.responseText || '{}');
              } catch {
                return {};
              }
            })();
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(payload);
            } else {
              reject(new Error(payload.error || `Server responded with code ${xhr.status}`));
            }
          };

          xhr.onerror = () => reject(new Error("上传连接中断，请检查网络后重试。"));
          xhr.ontimeout = () => reject(new Error("上传超时，请检查网络后重试，或使用更小的视频。"));
          xhr.send(formData);
        });

        if (!responseData?.success) {
          throw new Error(responseData?.error || 'Upload failed.');
        }
        setUploadProgress(prev => ({ ...prev, [key]: 100 }));
        await queryClient.invalidateQueries({ queryKey: ['showcase-works'] });
        setShowcaseMessage({ type: 'success', text: '精选作品已上传并发布，所有用户将实时看到更新。' });
      } catch (err) {
        console.error("[Uploader] Upload failed:", err);
        setShowcaseMessage({ type: 'error', text: err instanceof Error ? err.message : '上传作品失败。' });
      } finally {
        setUploadingKeys(prev => ({ ...prev, [key]: false }));
        setUploadProgress(prev => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    }
  };

  const removeVideo = async (key: string) => {
    if (!canEditShowcase) return;
    setShowcaseMessage(null);
    try {
      const response = await fetch("/api/videos/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'same-origin',
        body: JSON.stringify({ key })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.error || '删除精选作品失败。');
    } catch (err) {
      console.error("Local Node server file removal connection issue:", err);
      setShowcaseMessage({ type: 'error', text: err instanceof Error ? err.message : '删除精选作品失败。' });
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ['showcase-works'] });
    setShowcaseMessage({ type: 'success', text: '精选作品已下架。' });
  };

  const handleUpdateMetadata = async (key: string, field: 'title' | 'category', value: string) => {
    if (!canEditShowcase) return;
    const current = curatedMetadata[key] || { title: '', category: '' };
    const updatedMeta = {
      ...current,
      [field]: value
    };
    
    setCuratedMetadata(prev => ({
      ...prev,
      [key]: updatedMeta
    }));

    // 1. Save metadata through the backend registry API.
    try {
      const response = await fetch("/api/videos/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: 'same-origin',
        body: JSON.stringify({ key, ...updatedMeta })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.error || '保存精选作品信息失败。');
      void queryClient.invalidateQueries({ queryKey: ['showcase-works'] });
    } catch (err) {
      console.error("Cloud Node server metadata update failed - fallback active:", err);
      setShowcaseMessage({ type: 'error', text: err instanceof Error ? err.message : '保存精选作品信息失败。' });
    }
  };

  const handleVideoTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (video.currentTime >= 3.0) {
      video.currentTime = 0;
      video.play().catch(() => {});
    }
  };

  // Robust dispatcher distinguishing between 1 click (zoom) vs 3 clicks (edit/upload)
  const handleCardClick = (key: string, title: string) => {
    const tracker = clickTracker[key] || { count: 0, lastTime: 0, timerId: null };
    const now = Date.now();
    let nextCount = 1;

    // Click threshold 450ms
    if (now - tracker.lastTime < 450) {
      nextCount = tracker.count + 1;
    }

    if (tracker.timerId) {
      clearTimeout(tracker.timerId);
    }

    if (nextCount >= 3) {
      if (!canEditShowcase) return;
      // TRIPLE CLICK! Immediately trigger editing slot configuration modal
      setEditingSlotKey(key);
      
      // Reset tracker state
      setClickTracker(prev => ({
        ...prev,
        [key]: { count: 0, lastTime: 0, timerId: null }
      }));
    } else {
      // Set a deferred single-click timeout
      const timer = setTimeout(() => {
        const videoUrl = curatedVideos[key];
        if (videoUrl) {
          // Normal Single Click: Perfectly Zoom / Maximize the video content itself!
          setMaximizedVideoUrl(videoUrl);
          setMaximizedVideoTitle(title);
        } else if (canEditShowcase) {
          // No video loaded yet, open the slot manager immediately instead of requiring triple click!
          setEditingSlotKey(key);
        }

        // Clean up
        setClickTracker(prev => ({
          ...prev,
          [key]: { count: 0, lastTime: 0, timerId: null }
        }));
      }, 250); // 250ms is perfect for distinguishing click sequence without causing sluggish UI feedback

      setClickTracker(prev => ({
        ...prev,
        [key]: { count: nextCount, lastTime: now, timerId: timer }
      }));
    }
  };

  const checkAuthAndGoToDashboard = () => {
    setCurrentView('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const checkAuthAndGoToDeveloper = () => {
    if (!user) {
      setShowLoginModal(true);
      return;
    }
    if (!canOpenDeveloperArea) {
      setCurrentView('dashboard');
      return;
    }
    setCurrentView('developer');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const checkAuthAndGoToTeam = () => {
    if (!user) {
      setShowLoginModal(true);
      return;
    }
    setCurrentView('team');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const checkAuthAndGoToHistory = () => {
    if (!user) {
      setShowLoginModal(true);
      return;
    }
    setCurrentView('history');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const checkAuthAndGoToAdmin = () => {
    if (!user) {
      setShowLoginModal(true);
      return;
    }
    if (currentUserRole !== 'ADMIN') {
      setCurrentView('dashboard');
      return;
    }
    setCurrentView('admin');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToPipeline = (projId: string) => {
    const projectId = projId.trim();
    sessionStorage.setItem(ACTIVE_PIPELINE_PROJECT_STORAGE_KEY, projectId);
    setActivePipelineProjectId(projectId);
    setCurrentView('pipeline');
  };

  // Action executed for planned non-visual workflows such as game and UI design.
  const handleWorkflowClick = (title: string) => {
    setShowcaseMessage({ type: 'success', text: `即将进入 ${title} 工作台。` });
  };

  const goToNewsBroadcastItem = (item: any) => {
    const dateGroup = formatNewsDateGroup(item?.publishedAt || item?.dateGroup || item?.date);
    const params = new URLSearchParams();
    if (dateGroup) params.set('date', dateGroup);
    if (item?.id) params.set('itemId', String(item.id));
    if (item?.title) params.set('title', String(item.title));
    const nextUrl = `/news${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.pushState(null, '', nextUrl);
    setCurrentView('news');
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  const selectCuratedWork = (workKey: string) => {
    if (workKey === 'mv') {
      setPreviewWork({
        title: "《生》MV",
        category: "音乐视频",
        synopsis: "一位舞者在废弃重工业厂区中，用肢体语言与机械空间形成对话，呈现生命力与工业质感的碰撞。",
        promptUsed: "重金属、民族管乐、机械臂动态背景、120 帧动作捕捉、灰尘粒子与高反差灯光。",
        directorNotes: "用于展示从策划、角色设定、镜头设计到调色的一体化 AI 制片流程。"
      });
    } else if (workKey === 'sword') {
      setPreviewWork({
        title: "雪刀 Snow Sword",
        category: "游戏概念预演",
        synopsis: "两位剑客在大雪覆盖的悬崖湖畔对峙，强调动作捕捉、环境粒子和硬派武侠镜头语言。",
        promptUsed: "极简雪景、快速拔刀、空气波动、雪花切割粒子、长焦镜头压缩。",
        directorNotes: "重点验证动画预演、动态机位转换和特效合成节点。"
      });
    } else {
      setPreviewWork({
        title: "三体 - 衍生短片",
        category: "科幻微电影",
        synopsis: "以雷达峰发射信号的夜晚为核心场景，展示科幻短片的剧本、镜头和音效预演。",
        promptUsed: "红光监控室、雷雨夜、天线巨塔、黑白反差轮廓、低频弦乐和雷达回音。",
        directorNotes: "用于验证剧本、分镜、配乐和合成节点的协同效果。"
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-[#e5e7eb] flex flex-col relative selection:bg-white/20 selection:text-white font-sans antialiased">
      
      {/* Symmetrical Cosmic Particles Glow */}
      <div className="fixed inset-0 z-[-1] pointer-events-none" style={{ background: "radial-gradient(circle at 50% 0%, rgba(40,50,70,0.4) 0%, transparent 50%)" }}></div>
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none"></div>

      {/* FIXED NAV - Integrated with the new Header component on top of homepage workbench */}
      {currentView !== 'pipeline' && (
        <div className="fixed top-0 left-0 right-0 z-40">
          <Header 
            onNavigateHome={() => {
              setCurrentView('home');
              requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
            }}
            onNavigateNews={() => {
              setCurrentView('news');
              requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
            }}
            onNavigateDashboard={() => {
              checkAuthAndGoToDashboard();
              requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
            }}
          onNavigateDeveloper={checkAuthAndGoToDeveloper}
          onNavigateTeam={checkAuthAndGoToTeam}
          onNavigateHistory={checkAuthAndGoToHistory}
          onNavigateAdmin={checkAuthAndGoToAdmin}
            currentView={currentView}
            triggerLoginOpen={showLoginModal}
            onTriggerLoginOpenChange={setShowLoginModal}
          />
        </div>
      )}

      {/* VIEW ENGINE SWITCH WITH ANIMATION */}
      <AnimatePresence mode="wait">
        
        {/* ============================================================== */}
        {/* 1. VIEW HOME (Exactly matching provided head & layout)        */}
        {/* ============================================================== */}
        {currentView === 'home' && (
          <motion.main 
            key="home"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.3 }}
            id="view-home" 
            className="flex-grow pt-24 pb-12 px-6 max-w-7xl mx-auto w-full transition-opacity duration-300"
          >
            <header className="text-center mb-20 mt-16 flex flex-col items-center">
                <h1 className="text-6xl font-bold mb-4 neon-text tracking-wider">极影 JIYING</h1>
                <p className="text-xl text-gray-400 mb-10 tracking-widest">你按下按钮，其余的交给我们。</p>
                
                <button 
                  onClick={checkAuthAndGoToDashboard} 
                  className="core-action-btn px-16 py-5 rounded-full text-xl font-bold tracking-widest text-white cursor-pointer"
                >
                  进入工作台
                </button>
            </header>

            <ShowcaseGrid
              videos={curatedVideos}
              metadata={curatedMetadata}
              uploadingKeys={uploadingKeys}
              uploadProgress={uploadProgress}
              canEdit={canEditShowcase}
              onAddSlot={setEditingSlotKey}
              onEditSlot={setEditingSlotKey}
              onCardClick={handleCardClick}
              onSelectWork={selectCuratedWork}
              onVideoTimeUpdate={handleVideoTimeUpdate}
            />

            {showcaseMessage && (
              <div className={`fixed right-6 top-24 z-[120] max-w-sm rounded-lg border px-4 py-3 text-sm shadow-2xl backdrop-blur ${
                showcaseMessage.type === 'error'
                  ? 'border-red-500/40 bg-red-950/80 text-red-100'
                  : 'border-emerald-500/40 bg-emerald-950/80 text-emerald-100'
              }`}>
                <div className="flex items-start gap-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-current" />
                  <p className="leading-5">{showcaseMessage.text}</p>
                  <button type="button" onClick={() => setShowcaseMessage(null)} className="ml-2 text-white/70 hover:text-white">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* Industrial News Section inside Home View */}
            <section id="news-section" className="border-t border-white/5 pt-16">
              <h2 className="text-xl font-bold mb-8 border-l-4 border-white pl-3">行业资讯</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {latestHeadlines.slice(0, 3).map((news) => (
                  <article
                    key={news.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => goToNewsBroadcastItem(news)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        goToNewsBroadcastItem(news);
                      }
                    }}
                    className="glass-panel p-6 rounded-xl hover:bg-white/[0.05] hover:border-blue-400/40 transition-all cursor-pointer flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-4">
                        <span className="text-[10px] uppercase font-mono tracking-widest text-blue-300 font-bold bg-blue-500/10 px-2.5 py-0.5 rounded">
                          {news.category}
                        </span>
                        <span className="text-xs text-gray-500 font-mono">{news.dateGroup || formatNewsDateGroup(news.publishedAt)}</span>
                      </div>
                      <h3 className="font-semibold text-gray-100 mb-3 hover:text-white">
                        {news.title}
                      </h3>
                      <p className="text-xs text-sidebar-gray text-gray-400 line-clamp-3 leading-relaxed mb-4">
                        {news.summary}
                      </p>
                    </div>
                    <span className="text-[11px] text-blue-400 font-semibold flex items-center gap-1 mt-auto">
                      查看详情 <ChevronRight className="w-3" />
                    </span>
                  </article>
                ))}
              </div>
            </section>
          </motion.main>
        )}

        {/* ============================================================== */}
        {/* 2. VIEW DASHBOARD (Exact 1:1 match of user dashboard panels)   */}
        {/* ============================================================== */}
        {currentView === 'dashboard' && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.3 }}
          >
            <Suspense fallback={<RouteLoading compact />}>
              <DashboardPage onOpenPipeline={goToPipeline} onPlaceholderWorkflow={handleWorkflowClick} />
            </Suspense>
          </motion.div>
        )}

        {/* ============================================================== */}
        {/* 3. WORKING WORKSPACE PIPELINE (Rich, highly interactive system) */}
        {/* ============================================================== */}
        {currentView === 'pipeline' && (
          <div className="fixed inset-0 z-40 bg-[#030303] overflow-hidden flex flex-col">
            <Suspense fallback={<RouteLoading />}>
              <FuwaApp 
                currentProjectId={effectivePipelineProjectId}
                onBack={() => setCurrentView('dashboard')} 
                onNavigateHome={() => {
                  setCurrentView('home');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onNavigateNews={() => {
                  setCurrentView('news');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onNavigateDeveloper={checkAuthAndGoToDeveloper}
                onNavigateTeam={checkAuthAndGoToTeam}
                onNavigateHistory={checkAuthAndGoToHistory}
                onNavigateAdmin={checkAuthAndGoToAdmin}
              />
            </Suspense>
          </div>
        )}

        {currentView === 'scene3dPreview' && (
          <div className="fixed inset-0 z-40 bg-[#030303] overflow-hidden">
            <Suspense fallback={<RouteLoading />}>
              <Scene3DNodePreviewPage />
            </Suspense>
          </div>
        )}

        {currentView === 'news' && (
          <Suspense fallback={<RouteLoading compact />}>
            <NewsPage />
          </Suspense>
        )}

        {currentView === 'developer' && (
          canOpenDeveloperArea ? (
            <Suspense fallback={<RouteLoading compact />}>
              <DeveloperPage />
            </Suspense>
          ) : null
        )}

        {currentView === 'team' && (
          user ? (
            <Suspense fallback={<RouteLoading compact />}>
              <TeamManagementPage />
            </Suspense>
          ) : null
        )}

        {currentView === 'history' && (
          user ? (
            <Suspense fallback={<RouteLoading compact />}>
              <HistoryPage />
            </Suspense>
          ) : null
        )}

        {currentView === 'admin' && (
          currentUserRole === 'ADMIN' ? (
            <Suspense fallback={<RouteLoading compact />}>
              <AdminPage />
            </Suspense>
          ) : null
        )}

      </AnimatePresence>

      {/* FOOTER section */}
      <footer className="bg-[#0a0a0c] border-t border-white/5 mt-auto py-10 px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-6 select-none">
          <div className="flex flex-col gap-1 items-center sm:items-start text-center sm:text-left">
            <span className="text-sm font-bold tracking-widest text-white">极影 JIYING</span>
            <span className="text-[11px] text-gray-500">本地优先的画布式 AI 工作流平台</span>
          </div>
          
          <div className="flex gap-6 text-xs text-gray-500">
            <button className="hover:text-white transition-colors cursor-pointer" onClick={() => {
              setCurrentView('home');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}>极影首页</button>
            <button className="hover:text-white transition-colors cursor-pointer" onClick={() => {
              setCurrentView('news');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}>行业资讯</button>
            <button className="hover:text-white transition-colors cursor-pointer" onClick={checkAuthAndGoToDashboard}>工作台</button>
          </div>
        </div>
      </footer>

      {/* ============================================================== */}
      {/* 4. MODALS & POPUPS                                            */}
      {/* ============================================================== */}

      {/* Showcase Detail Dialog */}
      {previewWork && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="glass-panel w-full max-w-2xl p-6 sm:p-8 rounded-2xl relative shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-white/20">
            <button 
              onClick={() => setPreviewWork(null)} 
              className="absolute top-4 right-4 text-gray-400 hover:text-white cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            
            <span className="text-[10px] uppercase font-mono tracking-widest text-blue-400 font-bold bg-blue-500/10 px-2.5 py-1 rounded">
              {previewWork.category}
            </span>
            <h3 className="text-2xl font-bold mt-3 mb-4 text-white">{previewWork.title}</h3>
            
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">项目背景 / 概念概要</h4>
                <p className="text-xs text-gray-300 leading-relaxed bg-white/[0.01] p-3 rounded-lg border border-white/5">{previewWork.synopsis}</p>
              </div>

              <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">智能制片底卡大模型参数段</h4>
                <p className="text-xs font-mono text-gray-300 leading-relaxed bg-black/60 p-3 rounded-lg border border-white/10">
                  {previewWork.promptUsed}
                </p>
              </div>

              <div>
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">主创工业录入日志</h4>
                <p className="text-xs text-gray-300 leading-relaxed bg-white/[0.01] p-3 rounded-lg border border-white/5 italic">
                  {previewWork.directorNotes}
                </p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-white/5 flex justify-end gap-3">
              <button 
                onClick={() => setPreviewWork(null)}
                className="bg-white/5 hover:bg-white/10 text-xs font-bold tracking-wider px-5 py-2.5 rounded-lg cursor-pointer"
              >
                关闭预览
              </button>
              <button 
                onClick={() => {
                  setPreviewWork(null);
                  checkAuthAndGoToDashboard();
                }}
                className="bg-white text-black hover:bg-gray-200 text-xs font-bold tracking-wider px-5 py-2.5 rounded-lg cursor-pointer"
              >
                进入工作流深度演算
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cinematic Fullscreen Zoom Modal (Single Click Output) */}
      {maximizedVideoUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#050508]/95 backdrop-blur-xl p-4 sm:p-8">
          <div className="w-full max-w-4xl relative flex flex-col gap-4">
            
            {/* Header branding */}
            <div className="flex items-center justify-between pb-2 border-b border-white/10 select-none">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse"></span>
                <span className="text-xs font-mono tracking-wider text-gray-400 uppercase">极影高精度制片 / 完整播放器</span>
              </div>
              <h3 className="text-sm font-bold tracking-wider text-white truncate max-w-sm">{maximizedVideoTitle}</h3>
              <button 
                onClick={() => setMaximizedVideoUrl(null)} 
                className="text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 p-2 rounded-full cursor-pointer transition-colors"
                title="关闭播放"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Video Canvas wrapper */}
            <div className="glass-panel overflow-hidden rounded-2xl aspect-video border border-white/10 relative shadow-[0_24px_60px_rgba(0,0,0,0.8)] bg-black flex items-center justify-center">
              <video
                key={maximizedVideoUrl}
                src={maximizedVideoUrl}
                autoPlay
                controls
                playsInline
                preload="auto"
                className="w-full h-full object-contain"
              />
            </div>

            {/* Hint overlay */}
            <div className="flex justify-between items-center text-[10px] text-gray-500 font-mono tracking-widest uppercase select-none">
              <span>完整视频播放，使用控制条暂停、拖动进度或全屏。</span>
              <button
                onClick={() => setMaximizedVideoUrl(null)}
                className="text-gray-400 hover:text-white underline underline-offset-4 cursor-pointer transition-colors"
              >
                返回主页
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Showcase Video Manager Modal (Triple Click Workspace Setup) */}
      {editingSlotKey && canEditShowcase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4">
          <div className="glass-panel w-full max-w-md p-6 sm:p-8 rounded-2xl relative shadow-[0_0_50px_rgba(0,0,0,0.9)] border border-white/20">
            
            {/* Header info */}
            <button 
              onClick={() => setEditingSlotKey(null)} 
              className="absolute top-4 right-4 text-gray-400 hover:text-white cursor-pointer transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="mb-6">
              <span className="text-[10px] uppercase font-mono tracking-widest text-indigo-400 font-bold bg-indigo-500/10 px-2.5 py-1 rounded">
                SLOT MANAGER CONTROL
              </span>
              <h3 className="text-xl font-bold mt-3 text-white tracking-wide">
                配置精选作品槽位
              </h3>
              <p className="text-xs text-gray-400 mt-1">
                当前修改对象: <span className="text-gray-200 font-bold">
                  {editingSlotKey === 'mv' && "《生》MV"}
                  {editingSlotKey === 'sword' && "雪刀 Snow Sword"}
                  {editingSlotKey === 'santi' && "三体 - 衍生短片"}
                </span>
              </p>
            </div>

            {/* Controls panel */}
            <div className="space-y-4">
              <div className="bg-white/[0.01] p-4 rounded-xl border border-white/5 flex flex-col gap-1.5 text-center">
                <p className="text-xs text-gray-400 font-medium">当前槽位媒体状态</p>
                <div className="text-sm font-mono font-bold mt-1">
                  {curatedVideos[editingSlotKey] ? (
                    <span className="text-emerald-400">视频已导入 (ACTIVE)</span>
                  ) : (
                    <span className="text-zinc-500">暂未导入媒体 (EMPTY)</span>
                  )}
                </div>
              </div>

              {/* Editable Card Text Metadata Input Elements (Requested by user) */}
              <div className="bg-white/[0.01] p-4 rounded-xl border border-white/5 space-y-3.5">
                <p className="text-xs text-gray-300 font-bold border-l-2 border-indigo-400 pl-2">
                  编辑卡片文字内容 (TEXT LABELS)
                </p>
                
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-mono tracking-wider text-gray-500 block">作品标题 / Description Line 2</label>
                  <input
                    type="text"
                    value={curatedMetadata[editingSlotKey]?.title || ''}
                    onChange={(e) => handleUpdateMetadata(editingSlotKey, 'title', e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    placeholder="输入本槽位作品名称"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase font-mono tracking-wider text-gray-500 block">分类标识 / Description Line 1</label>
                  <input
                    type="text"
                    value={curatedMetadata[editingSlotKey]?.category || ''}
                    onChange={(e) => handleUpdateMetadata(editingSlotKey, 'category', e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    placeholder="输入本槽位分类描述"
                  />
                </div>
              </div>

              {/* Action Operations */}
              <div className="flex flex-col gap-3 pt-2">
                
                {/* Real File Input Trigger */}
                <input
                  id={`uploader-${editingSlotKey}`}
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-matroska,video/webm,video/*"
                  className="hidden"
                  onChange={(e) => {
                    handleVideoUpload(editingSlotKey, e);
                    e.currentTarget.value = '';
                    setEditingSlotKey(null); // auto-close on upload
                  }}
                />
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => {
                      document.getElementById(`uploader-${editingSlotKey}`)?.click();
                    }}
                    className="w-full flex items-center justify-center gap-2.5 bg-white text-black hover:bg-gray-200 py-3 rounded-lg text-xs font-bold tracking-wider cursor-pointer transition-all duration-200 h-11"
                  >
                    <Upload className="w-4 h-4" />
                    开始导入作品 (.mp4, .mov, .webm)
                  </button>
                  <p className="text-[10px] text-gray-500 text-center leading-normal">
                    支持 mp4、mov、webm 等常见视频格式，单个视频需控制在 1GB 以内。上传后视频通过后端受控播放接口展示，不暴露真实存储地址。
                  </p>
                </div>

                {curatedVideos[editingSlotKey] && (
                  <button
                    onClick={() => {
                      removeVideo(editingSlotKey);
                      setEditingSlotKey(null); // auto-close on remove
                    }}
                    className="w-full flex items-center justify-center gap-2.5 bg-red-600/10 hover:bg-red-600 text-red-500 hover:text-white border border-red-600/35 hover:border-transparent py-3 rounded-lg text-xs font-bold tracking-wider cursor-pointer transition-all duration-200 h-11"
                  >
                    <Trash2 className="w-4 h-4" />
                    删除已导入视频
                  </button>
                )}

              </div>
            </div>

            {/* Footer buttons */}
            <div className="mt-8 pt-4 border-t border-white/5 flex justify-end">
              <button 
                onClick={() => setEditingSlotKey(null)}
                className="bg-white/5 hover:bg-white/10 text-xs font-semibold px-5 py-2.5 rounded-lg cursor-pointer transition-colors"
              >
                确定
              </button>
            </div>


          </div>
        </div>
      )}

    </div>
  );
}
