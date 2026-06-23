import { useEffect, useState } from 'react';
import { Clock3, Cpu, LogIn, Users, User } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import type { LocalAuthUser } from '../auth/authTypes';
import { NotificationCenter } from './NotificationCenter';
import { normalizeProfilePhotoUrl } from './photoUrl';

type TopNavProps = {
  user: LocalAuthUser | null;
  role: 'ADMIN' | 'DEVELOPER' | 'USER';
  currentView?: string;
  activeNode?: string;
  isAuthLoading: boolean;
  isDropdownOpen: boolean;
  currentPhotoUrl: string;
  onNavigateHome?: () => void;
  onNavigateNews?: () => void;
  onNavigateDashboard?: () => void;
  onNavigateDeveloper?: () => void;
  onNavigateTeam?: () => void;
  onNavigateHistory?: () => void;
  onNavigateAdmin?: () => void;
  onOpenApiSettings: () => void;
  onOpenLogin: () => void;
  onToggleDropdown: () => void;
  onCloseDropdown: () => void;
  onOpenProfile: () => void;
  onLogout: () => Promise<void>;
};

type NavItem = {
  key: string;
  label: string;
  active: boolean;
  visible: boolean;
  onClick?: () => void;
};

function navClass(isActive: boolean) {
  return `font-mono text-lg tracking-wider uppercase transition-all duration-500 outline-none cursor-pointer ${isActive
    ? 'bg-gradient-to-r from-cyan-400 to-blue-500 text-transparent bg-clip-text font-bold'
    : 'text-gray-400 hover:text-transparent hover:bg-clip-text hover:bg-gradient-to-r hover:from-cyan-400 hover:to-blue-600'}`;
}

function displayNameFor(user: LocalAuthUser | null) {
  return user?.displayName || user?.email?.split('@')[0] || 'Operator';
}

function roleMeta(role: TopNavProps['role']) {
  if (role === 'ADMIN') {
    return {
      label: '管理员',
      detail: '可访问配置与监控、后台管理',
      className: 'border-amber-500/40 text-amber-300 bg-amber-950/20'
    };
  }
  if (role === 'DEVELOPER') {
    return {
      label: '经理',
      detail: '可访问配置与监控',
      className: 'border-cyan-500/40 text-cyan-300 bg-cyan-950/20'
    };
  }
  return {
    label: '普通用户',
    detail: '可访问智能出片与个人资料',
    className: 'border-zinc-600/50 text-zinc-300 bg-zinc-900/40'
  };
}

export function TopNav({
  user,
  role,
  currentView,
  activeNode,
  isAuthLoading,
  isDropdownOpen,
  currentPhotoUrl,
  onNavigateHome,
  onNavigateNews,
  onNavigateDashboard,
  onNavigateDeveloper,
  onNavigateTeam,
  onNavigateHistory,
  onNavigateAdmin,
  onOpenApiSettings,
  onOpenLogin,
  onToggleDropdown,
  onCloseDropdown,
  onOpenProfile,
  onLogout
}: TopNavProps) {
  const canOpenDeveloper = role === 'ADMIN' || role === 'DEVELOPER';
  const canOpenAdmin = role === 'ADMIN';
  const shouldShowModelCenterShortcut = !!user && canOpenDeveloper && ['02', '04', '05', '06'].includes(activeNode || '');
  const photoUrl = normalizeProfilePhotoUrl(currentPhotoUrl) || normalizeProfilePhotoUrl(user?.photoURL);
  const [failedPhotoUrl, setFailedPhotoUrl] = useState('');
  const shouldShowPhoto = Boolean(photoUrl && failedPhotoUrl !== photoUrl);
  const currentRoleMeta = roleMeta(role);
  const navItems: NavItem[] = [
    { key: 'news', label: '行业资讯', active: currentView === 'news', visible: true, onClick: onNavigateNews },
    { key: 'dashboard', label: '智能出片', active: currentView === 'dashboard' || currentView === 'pipeline', visible: true, onClick: onNavigateDashboard },
    { key: 'developer', label: '配置与监控', active: currentView === 'developer', visible: !!user && canOpenDeveloper, onClick: onNavigateDeveloper },
    { key: 'admin', label: '管理', active: currentView === 'admin', visible: !!user && canOpenAdmin, onClick: onNavigateAdmin }
  ];

  useEffect(() => {
    setFailedPhotoUrl('');
  }, [photoUrl]);

  const closeDropdownAndRun = (action?: () => void) => {
    onCloseDropdown();
    action?.();
  };

  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-[#030303]/80 backdrop-blur-md border-b border-cyan-950/40 z-[80] flex items-center justify-between px-6 pointer-events-auto">
      <div className="flex items-center gap-8">
        <button type="button" onClick={onNavigateHome} className="flex items-center gap-2 cursor-pointer group active:scale-95 transition-transform outline-none">
          <span className="font-mono text-2xl tracking-[0.25em] font-bold uppercase text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-500 hover:from-blue-400 hover:to-cyan-600">
            极影 JIYING
          </span>
        </button>

        {navItems.filter((item) => item.visible).map((item) => (
          <button key={item.key} type="button" onClick={item.onClick} className={navClass(item.active)}>
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-4">
        <AnimatePresence mode="wait">
          {isAuthLoading ? (
            <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
          ) : user ? (
            <div className="flex items-center gap-3 relative">
              {shouldShowModelCenterShortcut && (
                <button
                  type="button"
                  onClick={onOpenApiSettings}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-700/20 to-cyan-500/15 hover:from-amber-600/30 hover:to-cyan-500/25 border border-amber-500/40 hover:border-cyan-400 text-amber-300 hover:text-white rounded transition-all cursor-pointer shadow-[0_0_15px_rgba(245,158,11,0.08)] font-mono text-[10px] uppercase font-bold shrink-0 animate-in fade-in zoom-in duration-300"
                  title="进入配置与监控的模型中心"
                >
                  <Cpu className="w-3.5 h-3.5 text-amber-400" />
                  <span>模型中心</span>
                </button>
              )}

              <NotificationCenter enabled={!!user} />

              <button type="button" className="hidden md:flex flex-col items-end cursor-pointer outline-none" onClick={onToggleDropdown}>
                <span className="text-sm font-mono text-cyan-200 capitalize">{displayNameFor(user)}</span>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="text-[10px] font-mono text-cyan-500 hover:text-cyan-300 uppercase tracking-tighter transition-colors">
                    ONLINE / SETTINGS
                  </span>
                  <span className={`px-1.5 py-0.5 rounded border text-[8px] font-mono uppercase tracking-wider ${currentRoleMeta.className}`}>
                    {currentRoleMeta.label}
                  </span>
                </div>
              </button>

              <div className="relative">
                <button type="button" onClick={onToggleDropdown} title="账号与设置" className="relative cursor-pointer select-none active:scale-95 transition-transform flex items-center outline-none">
                  {shouldShowPhoto ? (
                    <img
                      src={photoUrl}
                      alt="User"
                      onError={() => setFailedPhotoUrl(photoUrl)}
                      className="w-8 h-8 rounded-sm border border-cyan-500/30 hover:border-cyan-400 transition-colors object-cover"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-sm bg-gradient-to-br from-cyan-500 to-blue-600 border border-cyan-400/50 flex items-center justify-center text-[10px] font-bold text-white font-mono uppercase shadow-[0_0_8px_rgba(6,182,212,0.4)]">
                      {(user.displayName || user.email || 'U').slice(0, 2)}
                    </div>
                  )}
                  <div className="absolute top-0 right-0 w-2 h-2 bg-green-500 rounded-full border border-[#030303] animate-pulse" />
                </button>

                {isDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-[90] cursor-default" onClick={onCloseDropdown} />
                    <div className="absolute top-10 right-0 w-64 bg-[#07080b]/95 border border-cyan-500/30 rounded-lg shadow-[0_4px_30px_rgba(0,0,0,0.85)] p-4 z-[100] flex flex-col gap-3 font-sans">
                      <div className="border-b border-cyan-950 pb-2.5">
                        <span className="text-[10px] text-gray-400 block font-mono">当前登录席位:</span>
                        <span className="text-xs font-mono font-bold text-white block capitalize truncate">{displayNameFor(user)}</span>
                        <span className="text-[8px] text-cyan-600 block truncate mt-0.5">{user.email}</span>
                      </div>

                      <div className="rounded border border-cyan-950/70 bg-black/20 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[9px] font-mono text-cyan-600 uppercase tracking-wider">当前身份</span>
                          <span className={`px-2 py-0.5 rounded border text-[9px] font-mono uppercase tracking-wider ${currentRoleMeta.className}`}>
                            {currentRoleMeta.label}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[9px] leading-relaxed text-cyan-500/80">{currentRoleMeta.detail}</p>
                      </div>

                      <button type="button" onClick={onOpenProfile} className="flex items-center gap-2 text-left w-full hover:bg-cyan-950/20 text-xs text-cyan-300 hover:text-cyan-200 py-1.5 px-2 rounded transition-colors cursor-pointer outline-none">
                        <User className="w-3.5 h-3.5 text-cyan-400" />
                        <span>个人资料 Profile settings</span>
                      </button>

                      <button type="button" onClick={() => closeDropdownAndRun(onNavigateTeam)} className="flex items-center gap-2 text-left w-full hover:bg-cyan-950/20 text-xs text-cyan-300 hover:text-cyan-200 py-1.5 px-2 rounded transition-colors cursor-pointer outline-none">
                        <Users className="w-3.5 h-3.5 text-cyan-400" />
                        <span>团队管理 Team projects</span>
                      </button>

                      <button type="button" onClick={() => closeDropdownAndRun(onNavigateHistory)} className="flex items-center gap-2 text-left w-full hover:bg-cyan-950/20 text-xs text-cyan-300 hover:text-cyan-200 py-1.5 px-2 rounded transition-colors cursor-pointer outline-none">
                        <Clock3 className="w-3.5 h-3.5 text-cyan-400" />
                        <span>历史记录 History</span>
                      </button>

                      <div className="border-t border-cyan-950 pt-2.5 flex justify-between items-center">
                        <span className="text-[9px] font-mono text-cyan-600 truncate max-w-[145px]">{currentRoleMeta.detail}</span>
                        <button type="button" onClick={onLogout} className="text-[10px] font-mono font-bold text-red-400 hover:text-red-300 px-2 py-1 bg-red-950/20 hover:bg-red-950/45 border border-red-900/40 rounded transition-all cursor-pointer outline-none">
                          退出 LogOut
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="relative group flex items-center">
              <button type="button" onClick={onOpenLogin} className="flex items-center gap-2 bg-cyan-900/40 hover:bg-cyan-800/60 text-cyan-300 text-[10px] font-mono uppercase px-4 py-1.5 rounded-sm border border-cyan-500/30 transition-all shadow-[0_0_15px_rgba(6,182,212,0.1)] group-hover:shadow-[0_0_20px_rgba(6,182,212,0.3)] group-hover:border-cyan-400/60 cursor-pointer">
                <LogIn className="w-3 h-3" />
                <span>系统登录</span>
              </button>
              <div className="absolute top-10 right-0 w-52 text-[9px] bg-black/90 backdrop-blur-md text-orange-400 font-mono p-2.5 rounded border border-orange-900/50 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-[100] pointer-events-none">
                <strong className="block mb-1 text-orange-300">访客模式</strong>
                当前为访客模式。登录后可同步历史记录并访问对应权限的控制台。
              </div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
