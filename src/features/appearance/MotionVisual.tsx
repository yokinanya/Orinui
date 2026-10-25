import { useEffect, useRef } from 'react';

import { useMotionPlayback } from '@/app/MotionPlayback';

export function MotionVisual() {
  const { image, playing, error, fail } = useMotionPlayback();
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element || !image.mediaUrl) return;
    if (!playing) { element.pause(); return; }
    let cancelled = false;
    void element.play().catch((cause: unknown) => {
      if (!cancelled) fail(`动态壁纸播放失败：${cause instanceof Error ? cause.message : String(cause)}`);
    });
    return () => { cancelled = true; element.pause(); };
  }, [image.mediaUrl, playing]);
  if (!image.mediaUrl) return null;
  const className = 'absolute inset-0 size-full object-cover object-center';
  if (image.motionKind === 'animation') {
    if (!playing) return null;
    return <img src={image.mediaUrl} alt="" className={className} onError={() => fail('动态壁纸图片解码失败')} />;
  }
  return <video ref={video} src={image.mediaUrl} poster={image.url ?? undefined} muted loop playsInline
    disablePictureInPicture disableRemotePlayback preload="auto"
    className={className} hidden={error !== null} onError={() => fail('动态壁纸视频读取或解码失败')} />;
}
