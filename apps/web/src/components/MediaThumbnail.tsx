import React from 'react';
import { useTempMedia } from '../hooks/useTempMedia';
import { Image, Video, Music } from 'lucide-react';

interface MediaThumbnailProps {
  url: string;
  type: 'image' | 'video' | 'audio';
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export default function MediaThumbnail({ url, type, className = "", onClick }: MediaThumbnailProps) {
  const resolvedUrl = useTempMedia(url);

  if (!resolvedUrl) {
    return (
      <div className={`flex items-center justify-center bg-zinc-900 animate-pulse ${className}`}>
        {type === 'image' && <Image className="w-4 h-4 text-zinc-700" />}
        {type === 'video' && <Video className="w-4 h-4 text-zinc-700" />}
        {type === 'audio' && <Music className="w-4 h-4 text-zinc-700" />}
      </div>
    );
  }

  if (type === 'image') {
    return (
      <img
        src={resolvedUrl}
        className={className}
        onClick={onClick}
        referrerPolicy="no-referrer"
        alt="Thumbnail"
      />
    );
  }

  if (type === 'video') {
    return (
      <video
        src={resolvedUrl}
        className={className}
        onClick={onClick}
        muted
        playsInline
      />
    );
  }

  if (type === 'audio') {
    return (
      <div 
        className={`flex flex-col items-center justify-center bg-cyan-950/20 text-cyan-400 ${className}`}
        onClick={onClick}
      >
        <Music className="w-4 h-4 mb-0.5" />
      </div>
    );
  }

  return null;
}
