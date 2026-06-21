import { useState } from 'react';
import { sendAnnouncement } from '../../lib/db';
import { MessageComposerFrame } from '../header/MessageComposerFrame';
import { uploadAttachments } from '../header/MessageComposerShared';

export function AnnouncementComposer() {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    setStatus('');
    if (!title.trim() || !content.trim()) {
      setError('标题和正文不能为空。');
      return;
    }
    setBusy(true);
    try {
      const attachmentMediaAssetIds = await uploadAttachments(files);
      await sendAnnouncement({
        scope: 'GLOBAL',
        title: title.trim(),
        content: content.trim(),
        attachmentMediaAssetIds
      });
      setTitle('');
      setContent('');
      setFiles([]);
      setStatus('全站公告已发布。');
    } catch (err: any) {
      setError(err.message || '公告发布失败。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <MessageComposerFrame
      title="公告发布"
      subtitle="管理员和经理可向所有注册并启用的账号发布全站公告。"
      sendLabel="发布公告"
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
      <div className="mt-4">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          disabled={busy}
          placeholder="公告标题"
          className="w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600"
        />
      </div>

      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        disabled={busy}
        rows={4}
        placeholder="编辑公告正文"
        className="mt-3 w-full resize-none rounded border border-white/10 bg-black/40 px-3 py-2 text-sm leading-6 text-white outline-none placeholder:text-zinc-600"
      />
    </MessageComposerFrame>
  );
}
