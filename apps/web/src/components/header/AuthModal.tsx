import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, HelpCircle, Lock, Mail, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

type AuthModalProps = {
  open: boolean;
  onClose: () => void;
  onLoginWithGoogle: () => Promise<void>;
  onLoginWithEmail: (email: string, password: string) => Promise<void>;
  onSignUpWithEmail: (email: string, password: string, name?: string) => Promise<void>;
};

function mapAuthErrorMessage(error: any): string {
  const rawMessage = error?.message || String(error);
  const code = error?.code || rawMessage;

  if (code.includes('auth/invalid-credential')) return '邮箱或密码不正确。';
  if (code.includes('auth/email-already-in-use')) return '该邮箱已经注册，请直接登录。';
  if (code.includes('auth/invalid-email')) return '邮箱格式不正确。';
  if (code.includes('auth/weak-password')) return '密码强度太弱，请至少使用 8 位字符。';
  if (code.includes('Google OAuth is not configured')) return 'Google OAuth 尚未配置，请先在 .env 设置 GOOGLE_OAUTH_CLIENT_ID 和 GOOGLE_OAUTH_CLIENT_SECRET。';
  if (code.includes('邮箱或密码不正确')) return '邮箱或密码不正确。';
  if (code.includes('该邮箱已经注册')) return '该邮箱已经注册，请直接登录。';
  return rawMessage;
}

export function AuthModal({
  open,
  onClose,
  onLoginWithGoogle,
  onLoginWithEmail,
  onSignUpWithEmail
}: AuthModalProps) {
  const [authMail, setAuthMail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [localError, setLocalError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setAuthMail('');
      setAuthPassword('');
      setAuthDisplayName('');
      setIsSignUpMode(false);
      setLocalError('');
      setIsSubmitting(false);
      setIsGoogleSubmitting(false);
    }
  }, [open]);

  const handleGoogleAuthSubmit = async () => {
    setLocalError('');
    setIsGoogleSubmitting(true);
    try {
      await onLoginWithGoogle();
      onClose();
    } catch (error) {
      setLocalError(mapAuthErrorMessage(error));
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  const handleEmailAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError('');
    setIsSubmitting(true);
    try {
      if (!authMail || !authPassword) throw new Error('请输入邮箱和密码。');
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(authMail)) throw new Error('请输入格式正确的邮箱地址，如 hello@qq.com');
      if (isSignUpMode) {
        if (authPassword.length < 8) throw new Error('密码至少需要 8 位字符。');
        await onSignUpWithEmail(authMail, authPassword, authDisplayName || undefined);
      } else {
        await onLoginWithEmail(authMail, authPassword);
      }
      onClose();
    } catch (err: any) {
      setLocalError(mapAuthErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-[#000000]/90 backdrop-blur-lg" />
          <motion.div initial={{ scale: 0.95, opacity: 0, y: 15 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 15 }} className="relative w-full max-w-md overflow-hidden rounded-lg border border-cyan-500/30 bg-[#0a0c10] text-cyan-400 shadow-[0_0_40px_rgba(6,182,212,0.15)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-cyan-950 bg-cyan-950/10 p-5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 animate-pulse text-cyan-400" />
                <div>
                  <h3 className="text-xs font-mono font-bold tracking-[0.18em] text-white">{isSignUpMode ? '账号注册' : '账号登录'}</h3>
                  <p className="mt-0.5 text-[8px] font-mono tracking-wider text-cyan-600">支持 QQ、163、Gmail 邮箱和本地账号体系</p>
                </div>
              </div>
              <button type="button" onClick={onClose} className="rounded p-1 text-cyan-600 transition-colors hover:bg-cyan-950/30 hover:text-cyan-400"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-4 p-6">
              <div className="space-y-2">
                <span className="mb-1 block text-[8px] font-mono tracking-widest text-cyan-600">方式一：Google 快速登录</span>
                <button type="button" disabled={isGoogleSubmitting} onClick={handleGoogleAuthSubmit} className="flex w-full items-center justify-center gap-2.5 rounded border border-cyan-900/60 bg-cyan-950/20 p-2.5 text-[10px] font-mono tracking-widest text-cyan-300 shadow-[inset_0_0_8px_rgba(6,182,212,0.05)] transition-all hover:border-cyan-400/50 hover:bg-cyan-900/30">
                  {isGoogleSubmitting ? '正在连接 Google...' : '使用 Google 登录'}
                </button>
              </div>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-cyan-950" />
                <span className="mx-3 flex-shrink text-[8px] font-mono tracking-widest text-cyan-700/80">或</span>
                <div className="flex-grow border-t border-cyan-950" />
              </div>

              <form onSubmit={handleEmailAuthSubmit} className="space-y-3">
                <span className="mb-1 block text-[8px] font-mono tracking-widest text-cyan-600">方式二：邮箱账号登录</span>
                {isSignUpMode && (
                  <div className="space-y-1">
                    <label className="block text-[9px] font-mono tracking-wider text-cyan-500">用户昵称（选填）</label>
                    <input value={authDisplayName} onChange={(event) => setAuthDisplayName(event.target.value)} placeholder="给自己起一个昵称" className="w-full rounded border border-cyan-950 bg-[#050608] px-3 py-2 text-xs font-sans text-cyan-300 outline-none transition-colors placeholder:text-cyan-800 hover:border-cyan-800 focus:border-cyan-500" />
                  </div>
                )}
                <div className="space-y-1">
                  <label className="block text-[9px] font-mono tracking-wider text-cyan-500">邮箱地址</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-3.5 w-3.5 text-cyan-700" />
                    <input type="text" required value={authMail} onChange={(event) => setAuthMail(event.target.value)} placeholder="例如：youraccount@qq.com" className="w-full rounded border border-cyan-950 bg-[#050608] py-2 pl-9 pr-3 text-xs font-mono text-cyan-300 outline-none transition-colors placeholder:text-cyan-800 hover:border-cyan-800 focus:border-cyan-500" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="block text-[9px] font-mono tracking-wider text-cyan-500">登录密码</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-3.5 w-3.5 text-cyan-700" />
                    <input type="password" required value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder={isSignUpMode ? '设置 8 位以上密码' : '请输入密码'} className="w-full rounded border border-cyan-950 bg-[#050608] py-2 pl-9 pr-3 text-xs font-mono text-cyan-300 outline-none transition-colors placeholder:text-cyan-800 hover:border-cyan-800 focus:border-cyan-500" />
                  </div>
                </div>
                {localError && <div className="flex items-start gap-2.5 rounded border border-red-500/30 bg-red-950/20 p-3 text-[10px] leading-relaxed text-red-400"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" /><p className="flex-1">{localError}</p></div>}
                <button type="submit" disabled={isSubmitting} className="flex w-full items-center justify-center gap-2 rounded border border-cyan-500/30 bg-cyan-950/40 p-2.5 text-[10px] font-mono tracking-[0.2em] text-cyan-300 transition-all hover:border-cyan-400 hover:bg-cyan-500/20 hover:text-white disabled:opacity-50">
                  {isSubmitting ? '处理中...' : isSignUpMode ? '注册账号' : '登录'}
                </button>
              </form>

              <div className="pt-2 text-center text-[9px] font-mono tracking-widest text-cyan-600">
                {isSignUpMode ? (
                  <button type="button" onClick={() => { setIsSignUpMode(false); setLocalError(''); }} className="cursor-pointer underline transition-colors hover:text-cyan-400">已有账号？切换到登录</button>
                ) : (
                  <button type="button" onClick={() => { setIsSignUpMode(true); setLocalError(''); }} className="cursor-pointer underline transition-colors hover:text-cyan-400">没有账号？创建新账号</button>
                )}
              </div>
            </div>

            <div className="flex gap-2 border-t border-cyan-950/50 bg-cyan-950/10 p-4 text-[8px] font-mono leading-normal text-cyan-700">
              <HelpCircle className="h-4 w-4 shrink-0 text-cyan-800" />
              <div>
                <strong className="mb-0.5 block text-cyan-600">本地账号说明：</strong>
                邮箱注册和登录使用本地 PostgreSQL 账号体系。Google 登录走后端 OAuth，需要先配置 Google OAuth Client。
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
