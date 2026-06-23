import { useEffect, useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { sendProjectBroadcast, sendProjectNotice } from '../../lib/db';
import type { TeamProjectMember } from '../../types';
import { uploadAttachments } from './MessageComposerShared';
import { MessageComposerFrame } from './MessageComposerFrame';

function userLabel(user?: { displayName?: string | null; username?: string | null; email?: string | null } | null) {
  return user?.displayName || user?.username || user?.email || '未知账号';
}

function userSubLabel(user?: { displayName?: string | null; username?: string | null; email?: string | null } | null) {
  return user?.email || user?.username || '';
}

type ProjectMessageComposerProps = {
  projectId: string;
  members: TeamProjectMember[];
  disabled?: boolean;
};

export function ProjectMessageComposer({ projectId, members, disabled }: ProjectMessageComposerProps) {
  const [mode, setMode] = useState<'NOTICE' | 'BROADCAST'>('NOTICE');
  const [receiverId, setReceiverId] = useState('');
  const [receiverSearch, setReceiverSearch] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const selectableMembers = useMemo(() => members.filter((member) => member.user), [members]);
  const filteredMembers = useMemo(() => {
    const keyword = receiverSearch.trim().toLowerCase();
    if (!keyword) return selectableMembers;
    return selectableMembers.filter((member) => {
      const values = [
        member.user?.displayName,
        member.user?.username,
        member.user?.email
      ].filter(Boolean).join(' ').toLowerCase();
      return values.includes(keyword);
    });
  }, [receiverSearch, selectableMembers]);
  const selectedMember = useMemo(
    () => selectableMembers.find((member) => member.userId === receiverId) || null,
    [receiverId, selectableMembers]
  );

  useEffect(() => {
    if (mode !== 'NOTICE') return;
    if (!selectableMembers.length) {
      setReceiverId('');
      return;
    }
    if (!receiverId || !selectableMembers.some((member) => member.userId === receiverId)) {
      setReceiverId(selectableMembers[0].userId);
    }
  }, [mode, receiverId, selectableMembers]);

  const reset = () => {
    setTitle('');
    setContent('');
    setFiles([]);
  };

  const submit = async () => {
    setError('');
    setStatus('');
    if (!projectId) {
      setError('请先选择项目。');
      return;
    }
    if (!title.trim() || !content.trim()) {
      setError('标题和正文不能为空。');
      return;
    }
    if (mode === 'NOTICE' && !receiverId) {
      setError('请选择通知接收人。');
      return;
    }
    setBusy(true);
    try {
      const attachmentMediaAssetIds = await uploadAttachments(files);
      if (mode === 'NOTICE') {
        await sendProjectNotice({ projectId, receiverId, title: title.trim(), content: content.trim(), attachmentMediaAssetIds });
        setStatus('通知已发送给指定成员。');
      } else {
        await sendProjectBroadcast({ projectId, title: title.trim(), content: content.trim(), attachmentMediaAssetIds });
        setStatus('播报已发送给项目所有成员。');
      }
      reset();
    } catch (err: any) {
      setError(err.message || '消息发送失败。');
    } finally {
      setBusy(false);
    }
  };

  if (disabled) return null;

  return (
    <div className="border-b border-white/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">项目消息发布</h3>
          <p className="mt-1 text-xs text-zinc-500">制片可向单个成员发通知，或向项目全员发播报。</p>
        </div>
        <div className="flex rounded border border-white/10 bg-black/30 p-1">
          <button type="button" onClick={() => setMode('NOTICE')} className={`rounded px-3 py-1.5 text-xs ${mode === 'NOTICE' ? 'bg-emerald-400/15 text-emerald-100' : 'text-zinc-500 hover:text-white'}`}>通知</button>
          <button type="button" onClick={() => setMode('BROADCAST')} className={`rounded px-3 py-1.5 text-xs ${mode === 'BROADCAST' ? 'bg-cyan-400/15 text-cyan-100' : 'text-zinc-500 hover:text-white'}`}>播报</button>
        </div>
      </div>

      <MessageComposerFrame
        title={mode === 'NOTICE' ? '项目通知' : '项目播报'}
        subtitle={mode === 'NOTICE' ? '向单个项目成员发送通知。' : `向当前项目内全部 ${selectableMembers.length} 名成员发送播报。`}
        sendLabel="发送"
        submitTone="cyan"
        busy={busy}
        status={status}
        error={error}
        files={files}
        onRemoveFile={(index) => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
        onAttach={(event) => {
          const next = Array.from(event.target.files || []);
          setFiles((current) => [...current, ...next].slice(0, 10));
          event.currentTarget.value = '';
        }}
        onSubmit={() => void submit()}
      >
        {mode === 'NOTICE' ? (
          <div className="mt-3 rounded border border-emerald-400/20 bg-emerald-400/[0.04] p-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold text-emerald-100">通知接收人</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  当前选择：{selectedMember ? `${userLabel(selectedMember.user)}${userSubLabel(selectedMember.user) ? ` / ${userSubLabel(selectedMember.user)}` : ''}` : '未选择'}
                </p>
              </div>
              <label className="flex min-w-[260px] items-center gap-2 rounded border border-white/10 bg-black/40 px-3 py-2 focus-within:border-emerald-400/50">
                <Search className="h-4 w-4 shrink-0 text-zinc-500" />
                <input
                  value={receiverSearch}
                  onChange={(event) => setReceiverSearch(event.target.value)}
                  disabled={busy}
                  placeholder="搜索成员昵称、用户名或邮箱"
                  className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600 disabled:opacity-50"
                />
              </label>
            </div>

            <div className="mt-3 grid max-h-44 grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
              {filteredMembers.length === 0 ? (
                <div className="rounded border border-white/10 bg-black/20 px-3 py-2 text-xs text-zinc-500">没有匹配的项目成员。</div>
              ) : filteredMembers.map((member) => {
                const active = receiverId === member.userId;
                return (
                  <button
                    key={member.userId}
                    type="button"
                    disabled={busy}
                    onClick={() => setReceiverId(member.userId)}
                    className={`min-w-0 rounded border px-3 py-2 text-left transition disabled:opacity-50 ${active ? 'border-emerald-400/50 bg-emerald-400/15 text-emerald-50' : 'border-white/10 bg-black/20 text-zinc-300 hover:border-emerald-400/30 hover:bg-white/[0.04]'}`}
                    title={userSubLabel(member.user) || userLabel(member.user)}
                  >
                    <span className="block truncate text-xs font-semibold">{userLabel(member.user)}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-zinc-500">{userSubLabel(member.user) || member.userId}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded border border-cyan-400/20 bg-cyan-400/[0.04] px-3 py-2 text-xs text-cyan-100">
            <Users className="h-4 w-4" />
            播报将发送给当前项目内全部 {selectableMembers.length} 名成员。
          </div>
        )}

        <div className="mt-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={busy}
            placeholder={mode === 'NOTICE' ? '通知标题' : '播报标题'}
            className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600"
          />
        </div>

        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          disabled={busy}
          rows={3}
          placeholder="编辑消息正文"
          className="mt-3 w-full resize-none rounded border border-white/10 bg-black/40 px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-zinc-600"
        />
      </MessageComposerFrame>
    </div>
  );
}
