import { PauseIcon, PlayIcon } from 'lucide-react';

import { useMotionPlayback } from '@/app/MotionPlayback';
import { Button } from '@/components/ui/button';

export function MotionPlaybackButton({ compact = false }: { readonly compact?: boolean }) {
  const { active, requested, toggle } = useMotionPlayback();
  if (!active) return null;
  const label = requested ? '暂停动态壁纸' : '播放动态壁纸';
  return <Button type="button" variant="ghost" size={compact ? 'icon' : 'default'} aria-label={label}
    title={label} onClick={toggle} className={compact ? 'home-readable-control home-readable-focus rounded-full' : undefined}>
    {requested ? <PauseIcon /> : <PlayIcon />}{!compact && label}
  </Button>;
}
