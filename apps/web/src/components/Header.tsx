import { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { AuthModal } from './header/AuthModal';
import { ProfileModal } from './header/ProfileModal';
import { normalizeProfilePhotoUrl } from './header/photoUrl';
import { TopNav } from './header/TopNav';

interface HeaderProps {
  onNavigateHome?: () => void;
  onNavigateNews?: () => void;
  onNavigateDashboard?: () => void;
  onNavigateDeveloper?: () => void;
  onNavigateTeam?: () => void;
  onNavigateHistory?: () => void;
  onNavigateAdmin?: () => void;
  currentView?: string;
  triggerLoginOpen?: boolean;
  onTriggerLoginOpenChange?: (open: boolean) => void;
  activeNode?: string;
}

export default function Header({
  onNavigateHome,
  onNavigateNews,
  onNavigateDashboard,
  onNavigateDeveloper,
  onNavigateTeam,
  onNavigateHistory,
  onNavigateAdmin,
  currentView,
  triggerLoginOpen,
  onTriggerLoginOpenChange,
  activeNode
}: HeaderProps) {
  const {
    user,
    loginByEmail,
    signUpByEmail,
    login,
    logout,
    updateProfile,
    changePassword,
    role: currentUserRole,
    loading: isAuthLoading
  } = useAuth();

  const canManageApiConfigs = currentUserRole === 'ADMIN' || currentUserRole === 'DEVELOPER';
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const currentPhotoUrl = normalizeProfilePhotoUrl(user?.photoURL);

  useEffect(() => {
    if (!triggerLoginOpen) return;
    setIsLoginModalOpen(true);
    onTriggerLoginOpenChange?.(false);
  }, [triggerLoginOpen, onTriggerLoginOpenChange]);

  return (
    <>
      <TopNav
        user={user}
        role={currentUserRole}
        currentView={currentView}
        activeNode={activeNode}
        isAuthLoading={isAuthLoading}
        isDropdownOpen={isDropdownOpen}
        currentPhotoUrl={currentPhotoUrl}
        onNavigateHome={onNavigateHome}
        onNavigateNews={onNavigateNews}
        onNavigateDashboard={onNavigateDashboard}
        onNavigateDeveloper={onNavigateDeveloper}
        onNavigateTeam={onNavigateTeam}
        onNavigateHistory={onNavigateHistory}
        onNavigateAdmin={onNavigateAdmin}
        onOpenApiSettings={() => {
          if (!canManageApiConfigs) return;
          window.location.hash = 'developer-models';
          onNavigateDeveloper?.();
        }}
        onOpenLogin={() => setIsLoginModalOpen(true)}
        onToggleDropdown={() => setIsDropdownOpen((current) => !current)}
        onCloseDropdown={() => setIsDropdownOpen(false)}
        onOpenProfile={() => {
          setIsProfileModalOpen(true);
          setIsDropdownOpen(false);
        }}
        onLogout={async () => {
          try {
            await logout();
            setIsDropdownOpen(false);
          } catch (error) {
            console.error(error);
          }
        }}
      />

      <AuthModal
        open={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLoginWithGoogle={login}
        onLoginWithEmail={loginByEmail}
        onSignUpWithEmail={signUpByEmail}
      />

      <ProfileModal
        open={isProfileModalOpen}
        user={user}
        onClose={() => setIsProfileModalOpen(false)}
        onSaveProfile={updateProfile}
        onChangePassword={changePassword}
      />
    </>
  );
}
