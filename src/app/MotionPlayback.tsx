import { createContext, use, useState, useSyncExternalStore, type ReactNode } from 'react';

import { useData } from '@/app/data-context';
import { useLocalImage } from '@/hooks/use-local-image';
import { readPageVisible, readReducedMotion, subscribePageVisible, subscribeReducedMotion } from '@/platform/motion-preferences';

interface PlaybackState {
  readonly id: string | null;
  readonly requested: boolean | null;
  readonly error: string | null;
}

interface MotionPlaybackValue {
  readonly image: ReturnType<typeof useLocalImage>;
  readonly active: boolean;
  readonly playing: boolean;
  readonly requested: boolean;
  readonly reducedMotion: boolean;
  readonly error: string | null;
  readonly toggle: () => void;
  readonly fail: (message: string) => void;
}

const MotionContext = createContext<MotionPlaybackValue | null>(null);

export function MotionPlaybackProvider({ children }: { readonly children: ReactNode }) {
  const { settings } = useData();
  const background = settings.appearance.background;
  const id = background.kind === 'motion' ? background.assetId : null;
  const image = useLocalImage(id, settings.appearance.dynamicColor.enabled);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion);
  const visible = useSyncExternalStore(subscribePageVisible, readPageVisible);
  const [state, setState] = useState<PlaybackState>({ id: null, requested: null, error: null });
  const current = state.id === id ? state : { id, requested: null, error: null };
  const requested = current.requested ?? !reducedMotion;
  const toggle = () => setState({ id, requested: !requested, error: null });
  const fail = (error: string) => setState({ id, requested: false, error });
  return <MotionContext value={{ image, active: id !== null, requested, reducedMotion,
    playing: requested && visible && current.error === null, error: current.error, toggle, fail }}>{children}</MotionContext>;
}

export function useMotionPlayback(): MotionPlaybackValue {
  const value = use(MotionContext);
  if (!value) throw new Error('动态壁纸播放控制未初始化');
  return value;
}
