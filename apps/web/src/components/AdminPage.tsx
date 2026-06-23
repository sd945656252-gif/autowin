import React, { useEffect, useState } from 'react';
import { Shield, Trash2, UserPlus } from 'lucide-react';
import { useAuth } from './AuthContext';

type AdminUser = {
  id: string;
  email: string;
  username?: string;
  displayName?: string;
  role: 'ADMIN' | 'DEVELOPER' | 'USER';
  status: 'ACTIVE' | 'DISABLED';
  lastSeenAt?: string | null;
  online?: boolean;
  lastSeenLabel?: string;
  createdAt: string;
};

type AuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId?: string;
  actor?: { email?: string; displayName?: string } | null;
  createdAt: string;
};

const ACTION_LABELS: Record<string, string> = {
  CREATE: '创建',
  UPDATE: '更新',
  DELETE: '删除',
  EXECUTE: '执行',
  LOGIN: '登录',
  ACCESS: '访问'
};

const ENTITY_LABELS: Record<string, string> = {
  Auth: '认证',
  User: '用户',
  UserRole: '用户角色',
  UserStatus: '用户状态',
  UserAccount: '用户账号',
  UserAccountBulk: '批量用户账号',
  DeveloperMedia: '媒体素材',
  CustomApiConfig: '模型配置',
  Workflow: '工作流',
  WorkflowRun: '工作流运行',
  WorkflowTask: '工作流任务',
  ShowcaseWork: '精选作品',
  MediaAsset: '素材资产',
  NewsItem: '新闻资讯'
};

function translateAuditLog(log: AuditLog) {
  return {
    action: ACTION_LABELS[log.action] || '未知操作',
    entity: ENTITY_LABELS[log.entityType] || '未知资源',
    raw: `${log.action} / ${log.entityType}`
  };
}

function roleLabel(role: AdminUser['role']) {
  if (role === 'ADMIN') return '管理员';
  if (role === 'DEVELOPER') return '经理';
  return '成员';
}

function statusLabel(status: AdminUser['status']) {
  return status === 'ACTIVE' ? '启用' : '停用';
}

export default function AdminPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'DEVELOPER' | 'USER'>('USER');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

  const load = async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setError('');
    try {
      const [usersResponse, logsResponse] = await Promise.all([
        fetch('/api/users', { credentials: 'same-origin' }),
        fetch('/api/audit-logs', { credentials: 'same-origin' })
      ]);
      const usersData = await usersResponse.json().catch(() => ({}));
      const logsData = await logsResponse.json().catch(() => ({}));
      if (!usersResponse.ok || !usersData.success) throw new Error(usersData.error || '无法读取用户。');
      if (!logsResponse.ok || !logsData.success) throw new Error(logsData.error || '无法读取审计日志。');
      setUsers(usersData.users || []);
      setLogs(logsData.logs || []);
      setSelectedUserIds((prev) => prev.filter((id) => (usersData.users || []).some((item: AdminUser) => item.id === id)));
    } catch (err: any) {
      if (!options.silent) setError(err.message || String(err));
    }
  };

  const readDeleteResult = (data: any) => {
    if (data.summary) {
      return `删除完成：成功 ${data.summary.succeeded} 个，已跳过 ${data.summary.skipped} 个，失败 ${data.summary.failed} 个。已删除账号会从列表移除。`;
    }
    if (data.result?.success) return '账号已删除，登录权限和历史痕迹已清理。';
    return '删除操作已完成。';
  };

  const deleteUsers = async (ids: string[]) => {
    const targets = Array.from(new Set(ids)).filter(Boolean);
    if (targets.length === 0) return;
    if (targets.includes(currentUser?.id || currentUser?.uid || '')) {
      setError('不能删除当前登录账号。');
      return;
    }

    const confirmed = window.confirm(
      `确认删除 ${targets.length} 个账号？\n\n该操作会从列表中移除账号，清理登录会话、工作流、素材、提示词、剪辑项目等历史痕迹，并不再对该账号开放访问。删除后不可恢复，但同一邮箱可以重新注册为全新账号。`
    );
    if (!confirmed) return;

    setDeleting(true);
    setError('');
    setMessage('');
    try {
      const response = targets.length === 1
        ? await fetch(`/api/users/${targets[0]}`, { method: 'DELETE', credentials: 'same-origin' })
        : await fetch('/api/users/bulk-delete', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds: targets })
        });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '删除账号失败。');
      if (data.partial) setError(readDeleteResult(data));
      else setMessage(readDeleteResult(data));
      setSelectedUserIds([]);
      await load();
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setDeleting(false);
    }
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedUserIds((prev) => checked ? Array.from(new Set([...prev, id])) : prev.filter((item) => item !== id));
  };

  const selectableUsers = users.filter((item) => item.id !== (currentUser?.id || currentUser?.uid));
  const allSelected = selectableUsers.length > 0 && selectableUsers.every((item) => selectedUserIds.includes(item.id));

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load({ silent: true }), 45_000);
    return () => window.clearInterval(interval);
  }, []);

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, role })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || '创建用户失败。');
      setEmail('');
      setPassword('');
      setRole('USER');
      await load();
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  const patchUser = async (id: string, patchType: 'role' | 'status', value: string) => {
    setError('');
    try {
      const response = await fetch(`/api/users/${id}/${patchType}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [patchType]: value })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || '更新失败。');
      await load();
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  return (
    <main className="flex-grow pt-24 pb-12 px-6 max-w-7xl mx-auto w-full">
      <div className="mb-8">
        <p className="text-xs font-mono text-cyan-400 tracking-widest uppercase">Admin Console</p>
        <h1 className="text-3xl font-bold text-white mt-2">用户管理与审计日志</h1>
      </div>

      {error && <div className="mb-6 border border-red-500/30 bg-red-950/20 text-red-200 rounded p-3 text-sm">{error}</div>}
      {message && <div className="mb-6 border border-emerald-500/30 bg-emerald-950/20 text-emerald-200 rounded p-3 text-sm">{message}</div>}

      <form onSubmit={createUser} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_180px_auto] gap-3 border border-white/10 bg-white/[0.03] rounded-lg p-4 mb-8">
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" className="bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white outline-none" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="初始密码" type="password" className="bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white outline-none" />
        <select value={role} onChange={(e) => setRole(e.target.value as any)} className="bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white outline-none">
          <option value="USER">成员</option>
          <option value="DEVELOPER">经理</option>
          <option value="ADMIN">管理员</option>
        </select>
        <button className="flex items-center justify-center gap-2 bg-cyan-500/20 border border-cyan-400/30 text-cyan-100 rounded px-4 py-2 text-sm font-semibold">
          <UserPlus className="w-4 h-4" /> 创建
        </button>
      </form>

      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-6">
        <section className="border border-white/10 bg-white/[0.03] rounded-lg overflow-hidden">
          <div className="p-4 border-b border-white/10 font-semibold text-white flex items-center justify-between gap-3">
            <span>用户</span>
            <button
              type="button"
              disabled={selectedUserIds.length === 0 || deleting}
              onClick={() => deleteUsers(selectedUserIds)}
              className="flex items-center gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" /> 批量删除 {selectedUserIds.length > 0 ? `(${selectedUserIds.length})` : ''}
            </button>
          </div>
          <div className="px-4 py-2 border-b border-white/10 text-xs text-zinc-500 flex items-center gap-3">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(event) => setSelectedUserIds(event.target.checked ? selectableUsers.map((item) => item.id) : [])}
              className="accent-cyan-400"
            />
            <span>选择当前可删除账号。删除会清理账号、会话和历史痕迹；同邮箱后续可重新注册为新账号。</span>
          </div>
          <div className="divide-y divide-white/10">
            {users.map((user) => {
              const isCurrentUser = user.id === (currentUser?.id || currentUser?.uid);
              const online = isCurrentUser || Boolean(user.online);
              const statusText = isCurrentUser ? '在线' : (user.lastSeenLabel || '无活跃记录');
              return (
                <div key={user.id} className="p-4 grid grid-cols-1 md:grid-cols-[32px_minmax(180px,1fr)_130px_130px_150px_112px] gap-3 items-center">
                  <input
                    type="checkbox"
                    checked={selectedUserIds.includes(user.id)}
                    disabled={isCurrentUser}
                    onChange={(event) => toggleSelected(user.id, event.target.checked)}
                    className="accent-cyan-400 disabled:opacity-40"
                  />
                  <div className="min-w-0">
                    <div className="text-white text-sm font-medium truncate">{user.displayName || user.email}</div>
                    <div className="text-xs text-gray-500 truncate">{user.email}{isCurrentUser ? ' · 当前账号' : ''}</div>
                  </div>
                  <select value={user.role} onChange={(e) => patchUser(user.id, 'role', e.target.value)} className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white outline-none" title={roleLabel(user.role)}>
                    <option value="USER">成员</option>
                    <option value="DEVELOPER">经理</option>
                    <option value="ADMIN">管理员</option>
                  </select>
                  <select value={user.status} onChange={(e) => patchUser(user.id, 'status', e.target.value)} className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-white outline-none" title={statusLabel(user.status)}>
                    <option value="ACTIVE">启用</option>
                    <option value="DISABLED">停用</option>
                  </select>
                  <div className="flex items-center gap-2 text-xs" title={user.lastSeenAt ? `最近活跃：${new Date(user.lastSeenAt).toLocaleString()}` : '无活跃记录'}>
                    <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]' : 'bg-red-500'}`} />
                    <span className={online ? 'text-emerald-200' : 'text-red-200'}>{statusText}</span>
                  </div>
                  <button
                    type="button"
                    disabled={isCurrentUser || deleting}
                    onClick={() => deleteUsers([user.id])}
                    className="flex items-center justify-center gap-1.5 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> 删除账号
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="border border-white/10 bg-white/[0.03] rounded-lg overflow-hidden">
          <div className="p-4 border-b border-white/10 font-semibold text-white flex items-center gap-2"><Shield className="w-4 h-4" />审计日志</div>
          <div className="divide-y divide-white/10 max-h-[560px] overflow-auto">
            {logs.map((log) => {
              const display = translateAuditLog(log);
              const isHighValue = ['UPDATE', 'DELETE', 'EXECUTE'].includes(log.action) || ['UserRole', 'UserStatus', 'CustomApiConfig'].includes(log.entityType);
              return (
                <div key={log.id} className={`p-4 text-xs ${isHighValue ? 'bg-cyan-500/[0.03]' : ''}`} title={display.raw}>
                  <div className="text-white font-semibold">{display.action} / {display.entity}</div>
                  <div className="text-gray-500 mt-1">{log.actor?.email || 'system'} · {new Date(log.createdAt).toLocaleString()}</div>
                  <div className="text-[11px] text-zinc-600 mt-1 font-mono">原始值：{display.raw}{log.entityId ? ` · ${log.entityId}` : ''}</div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
