import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, Check, Key, Upload, User, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { PRESET_AVATARS } from './headerConfig';
import { normalizeProfilePhotoUrl } from './photoUrl';

type LocalProfileUser = {
  displayName: string | null;
  photoURL: string | null;
  hasPassword?: boolean;
};

type ProfileModalProps = {
  open: boolean;
  user: LocalProfileUser | null;
  onClose: () => void;
  onSaveProfile: (displayName: string, photoURL: string) => Promise<{ photoURL?: string | null }>;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
};

export function ProfileModal({
  open,
  user,
  onClose,
  onSaveProfile,
  onChangePassword
}: ProfileModalProps) {
  const [profileDisplayName, setProfileDisplayName] = useState('');
  const [profilePhotoUrl, setProfilePhotoUrl] = useState('');
  const [failedProfilePreviewUrl, setFailedProfilePreviewUrl] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileSuccessMsg, setProfileSuccessMsg] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSendingResetEmail, setIsSendingResetEmail] = useState(false);
  const [resetEmailSuccessMsg, setResetEmailSuccessMsg] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isDraggingAvatar, setIsDraggingAvatar] = useState(false);

  const normalizedProfilePhotoUrl = normalizeProfilePhotoUrl(profilePhotoUrl);
  const shouldShowProfilePreview = Boolean(normalizedProfilePhotoUrl && failedProfilePreviewUrl !== normalizedProfilePhotoUrl);
  const hasLocalPassword = Boolean(user?.hasPassword);

  useEffect(() => {
    if (!open) return;
    setProfileDisplayName(user?.displayName || '');
    setProfilePhotoUrl(normalizeProfilePhotoUrl(user?.photoURL));
    setProfileError('');
    setProfileSuccessMsg('');
    setResetEmailSuccessMsg('');
    setFailedProfilePreviewUrl('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setIsDraggingAvatar(false);
  }, [open, user]);

  useEffect(() => {
    setFailedProfilePreviewUrl('');
  }, [normalizedProfilePhotoUrl]);

  const processAvatarFile = (file: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setProfileError('Upload failed. Please choose a valid image file.');
      return;
    }

    setProfileSuccessMsg('正在智能优化压缩头像，请稍候...');
    setProfileError('');

    const reader = new FileReader();
    reader.onload = (event) => {
      if (!event.target?.result) return;
      const rawBase64 = event.target.result as string;
      const img = new window.Image();
      img.src = rawBase64;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 180;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          setProfilePhotoUrl(canvas.toDataURL('image/jpeg', 0.85));
          setProfileError('');
          setProfileSuccessMsg('头像已压缩预览。点击保存后将同步到数据库。');
        } else {
          setProfilePhotoUrl(rawBase64);
          setProfileError('');
          setProfileSuccessMsg('头像已载入预览。点击保存后将同步到数据库。');
        }
      };
      img.onerror = () => {
        setProfileError('Image parsing failed. Please choose another image.');
        setProfileSuccessMsg('');
      };
    };
    reader.onerror = () => {
      setProfileError('File read failed. Please choose another file.');
      setProfileSuccessMsg('');
    };
    reader.readAsDataURL(file);
  };

  const handleProfileUpdate = async (event: FormEvent) => {
    event.preventDefault();
    setProfileError('');
    setProfileSuccessMsg('');
    setIsSavingProfile(true);
    try {
      if (!profileDisplayName.trim()) throw new Error('昵称/别名不能为空');
      const nextUser = await onSaveProfile(profileDisplayName.trim(), profilePhotoUrl.trim());
      setProfilePhotoUrl(nextUser.photoURL || '');
      setProfileSuccessMsg('个人资料已保存，头像已同步到数据库。');
      window.setTimeout(() => {
        onClose();
        setProfileSuccessMsg('');
      }, 500);
    } catch (err: any) {
      setProfileError(err.message || '更新失败，请重试');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handlePasswordResetAuth = async () => {
    setProfileError('');
    setResetEmailSuccessMsg('');
    setIsSendingResetEmail(true);
    try {
      if (hasLocalPassword && !currentPassword) throw new Error('请输入当前密码。');
      if (!newPassword) throw new Error(hasLocalPassword ? '请输入新密码。' : '请输入要设置的本地登录密码。');
      if (newPassword.length < 8) throw new Error('新密码至少需要 8 位。');
      if (newPassword !== confirmNewPassword) throw new Error('两次输入的新密码不一致。');
      await onChangePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setResetEmailSuccessMsg(hasLocalPassword ? '密码已更新。下次登录请使用新密码。' : '本地备用密码已创建。之后也可以使用邮箱和密码登录。');
    } catch (err: any) {
      let errorMsg = err.message || String(err);
      if (errorMsg.includes('auth/too-many-requests')) errorMsg = 'Password reset email rate limit reached. Please try again later.';
      setProfileError(errorMsg);
    } finally {
      setIsSendingResetEmail(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-[#000000]/90 backdrop-blur-lg" />
          <motion.div initial={{ scale: 0.95, opacity: 0, y: 15 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 15 }} className="relative flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-cyan-500/30 bg-[#0a0c10] text-cyan-400 shadow-[0_0_40px_rgba(6,182,212,0.15)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-cyan-950 bg-cyan-950/10 p-5">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 animate-pulse text-cyan-400" />
                <div>
                  <h3 className="text-xs font-mono font-bold uppercase tracking-[0.2em] text-white">修改个人信息 / Edit Profile</h3>
                  <p className="mt-0.5 text-[8px] font-mono uppercase tracking-wider text-cyan-600">Nickname, preset avatar, upload avatar and password</p>
                </div>
              </div>
              <button type="button" onClick={onClose} className="rounded p-1 text-cyan-600 transition-colors hover:bg-cyan-950/30 hover:text-cyan-400"><X className="h-4 w-4" /></button>
            </div>

            <form onSubmit={handleProfileUpdate} className="space-y-5 p-6">
              <div className="space-y-1">
                <label className="block text-[9px] font-mono uppercase tracking-wider text-cyan-500">用户昵称 / DISPLAY NAME</label>
                <input type="text" required value={profileDisplayName} onChange={(event) => setProfileDisplayName(event.target.value)} placeholder="给自己起一个极客代号..." className="w-full rounded border border-cyan-950 bg-[#050608] px-3 py-2 text-xs font-sans text-cyan-300 outline-none transition-colors placeholder:text-cyan-800 hover:border-cyan-800 focus:border-cyan-500" />
              </div>

              <div className="space-y-2">
                <label className="block text-[9px] font-mono uppercase tracking-wider text-cyan-500">选择系统预设头像 / PRESET CYBER AVATARS</label>
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-sm border border-cyan-500/20 bg-cyan-950/20">
                    {shouldShowProfilePreview ? (
                      <img src={normalizedProfilePhotoUrl} alt="当前头像" onError={() => setFailedProfilePreviewUrl(normalizedProfilePhotoUrl)} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] font-mono text-cyan-600">无</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[9px] font-mono uppercase tracking-wider text-cyan-400">当前选择头像</p>
                    <p className="max-w-[220px] truncate text-[10px] text-cyan-700">{normalizedProfilePhotoUrl || '尚未设置'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {PRESET_AVATARS.map((avatar) => {
                    const isSelected = profilePhotoUrl === avatar.url;
                    return (
                      <button key={avatar.name} type="button" onClick={() => setProfilePhotoUrl(avatar.url)} className={`relative aspect-square overflow-hidden rounded border-2 p-0.5 transition-all ${isSelected ? 'scale-105 border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.5)]' : 'border-cyan-950/40 hover:border-cyan-800'}`} title={avatar.name}>
                        <img src={avatar.url} alt={avatar.name} className="h-full w-full rounded-sm object-cover" />
                        {isSelected && <div className="absolute inset-0 flex items-center justify-center bg-cyan-950/50"><Check className="h-4 w-4 font-bold text-cyan-400" /></div>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[9px] font-mono uppercase tracking-wider text-cyan-500">上传自定义头像 / UPLOAD CUSTOM AVATAR</label>
                <div onDragOver={(event) => { event.preventDefault(); setIsDraggingAvatar(true); }} onDragLeave={() => setIsDraggingAvatar(false)} onDrop={(event) => { event.preventDefault(); setIsDraggingAvatar(false); const files = event.dataTransfer.files; if (files?.length) processAvatarFile(files[0]); }} onClick={() => document.getElementById('avatar-file-input')?.click()} className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded border border-dashed p-4 text-center transition-all ${isDraggingAvatar ? 'animate-pulse border-cyan-400 bg-cyan-955/40 shadow-[0_0_15px_rgba(6,182,212,0.2)]' : 'border-cyan-950 bg-[#050608]/50 hover:border-cyan-500/50 hover:bg-cyan-950/10'}`}>
                  <input id="avatar-file-input" type="file" accept="image/*" onChange={(event) => { const files = event.target.files; if (files?.length) processAvatarFile(files[0]); }} className="hidden" />
                  <Upload className="h-5 w-5 text-cyan-600 hover:text-cyan-400" />
                  <p className="text-[9px] font-mono uppercase tracking-wider text-cyan-300">拖拽图像文件至此，或 <span className="text-cyan-400 underline decoration-cyan-700">点击选择本地头像</span></p>
                  <p className="text-[7px] font-mono text-cyan-500">支持 PNG, JPG, GIF, WEBP。保存后将写入数据库并在下次登录继续保留。</p>
                </div>
              </div>

              <div className="space-y-2 border-t border-cyan-950/60 pt-3">
                <label className="block text-[9px] font-mono uppercase tracking-wider text-orange-500">密码与安全验证 / PASSWORD SECURITY</label>
                <div className="rounded border border-orange-900/30 bg-orange-950/10 p-3 text-[9px] leading-relaxed text-orange-300/90">
                  {hasLocalPassword ? '当前账号已启用本地密码。修改时需要先输入当前密码，再设置 8 位以上的新密码。' : '当前账号还没有本地密码。可直接设置一个 8 位以上的备用密码，之后既能用 Google 登录，也能用邮箱密码登录。'}
                </div>
                <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-wider">
                  <span className={`rounded border px-2 py-1 ${hasLocalPassword ? 'border-orange-500/40 bg-orange-950/20 text-orange-300' : 'border-cyan-500/40 bg-cyan-950/20 text-cyan-300'}`}>{hasLocalPassword ? '本地密码已启用' : '当前未设置本地密码'}</span>
                </div>
                <div className="grid gap-2">
                  {hasLocalPassword && <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="当前本地密码 / Current password" className="w-full rounded border border-orange-950/60 bg-[#050608] px-3 py-2 text-xs font-sans text-orange-200 outline-none transition-colors placeholder:text-orange-900 hover:border-orange-800 focus:border-orange-500" />}
                  <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={hasLocalPassword ? '新本地密码，至少 8 位 / New password' : '创建本地备用密码，至少 8 位'} className="w-full rounded border border-orange-950/60 bg-[#050608] px-3 py-2 text-xs font-sans text-orange-200 outline-none transition-colors placeholder:text-orange-900 hover:border-orange-800 focus:border-orange-500" />
                  <input type="password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} placeholder="再次输入新密码 / Confirm new password" className="w-full rounded border border-orange-950/60 bg-[#050608] px-3 py-2 text-xs font-sans text-orange-200 outline-none transition-colors placeholder:text-orange-900 hover:border-orange-800 focus:border-orange-500" />
                </div>
                <button type="button" disabled={isSendingResetEmail} onClick={() => void handlePasswordResetAuth()} className="flex w-full items-center justify-center gap-2 rounded border border-orange-900/40 bg-orange-950/15 p-2 text-[9px] font-mono uppercase tracking-widest text-orange-400 transition-all hover:border-orange-500/50 hover:bg-orange-900/30 hover:text-orange-300 disabled:opacity-50">
                  <Key className="h-3 w-3" />
                  {isSendingResetEmail ? '处理中...' : hasLocalPassword ? '修改本地账号密码 / CHANGE LOCAL PASSWORD' : '创建本地备用密码 / CREATE LOCAL PASSWORD'}
                </button>
                {resetEmailSuccessMsg && <div className="flex items-start gap-2 rounded border border-orange-500/30 bg-orange-950/20 p-3 text-[9px] leading-relaxed text-orange-300"><Check className="mt-0.5 h-3 w-3 shrink-0 text-orange-400" /><p className="flex-1">{resetEmailSuccessMsg}</p></div>}
              </div>

              {profileError && <div className="flex items-start gap-2.5 rounded border border-red-500/30 bg-red-950/20 p-3 text-[10px] leading-relaxed text-red-400"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" /><p className="flex-1">{profileError}</p></div>}
              {profileSuccessMsg && <div className="flex items-start gap-2.5 rounded border border-green-500/30 bg-green-950/20 p-3 text-[10px] leading-relaxed text-green-400"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" /><p className="flex-1">{profileSuccessMsg}</p></div>}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={onClose} className="px-4 py-2 text-[10px] font-mono uppercase text-cyan-700 transition-colors hover:text-cyan-400">取消 Discard</button>
                <button type="submit" disabled={isSavingProfile} className="flex items-center justify-center gap-2 rounded border border-cyan-500/30 bg-cyan-950/40 px-6 py-2 text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-300 transition-all hover:border-cyan-400 hover:bg-cyan-500/20 hover:text-white disabled:opacity-50">
                  {isSavingProfile ? '保存中...' : '保存设置 UPDATE PROFILE'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
