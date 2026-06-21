import { FileText, X } from 'lucide-react';
import { uploadNotificationAttachment } from '../../lib/db';

export function fileSizeLabel(file: File) {
  if (file.size < 1024) return `${file.size} B`;
  if (file.size < 1024 * 1024) return `${(file.size / 1024).toFixed(1)} KB`;
  return `${(file.size / 1024 / 1024).toFixed(1)} MB`;
}

export async function uploadAttachments(files: File[]) {
  const uploaded = [];
  for (const file of files) {
    uploaded.push(await uploadNotificationAttachment(file));
  }
  return uploaded.map((item) => item.assetId);
}

type AttachmentListProps = {
  files: File[];
  onRemove: (index: number) => void;
};

export function AttachmentList({ files, onRemove }: AttachmentListProps) {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {files.map((file, index) => (
        <span key={`${file.name}-${index}`} className="inline-flex max-w-[240px] items-center gap-2 rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-zinc-300">
          <FileText className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
          <span className="truncate">{file.name}</span>
          <span className="shrink-0 text-zinc-600">{fileSizeLabel(file)}</span>
          <button type="button" onClick={() => onRemove(index)} className="text-zinc-500 hover:text-red-300" title="移除附件">
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
    </div>
  );
}
