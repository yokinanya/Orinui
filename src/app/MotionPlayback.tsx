import { createContext, use, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { useData } from '@/app/data-context';
import { useLocalImage } from '@/hooks/use-local-image';
import { readPageVisible, readReducedMotion, readWindowFocused, subscribePageVisible, subscribeReducedMotion,
  subscribeWindowFocus } from '@/platform/motion-preferences';
import { readMotionPaused, writeMotionPaused } from '@/platform/motion-pause-storage';

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
  readonly preferenceError: string | null;
  readonly toggle: () => void;
  readonly fail: (message: string) => void;
}

const MotionContext = createContext<MotionPlaybackValue | null>(null);

interface PausePreference { readonly id: string | null; readonly paused: boolean; readonly loaded: boolean }

interface TogglePlaybackInput {
  readonly id: string | null;
  readonly requested: boolean;
  readonly state: PlaybackState;
  readonly setState: (state: PlaybackState) => void;
  readonly pause: PausePreference;
  readonly setPause: (state: PausePreference) => void;
  readonly request: { current: number };
  readonly setPreferenceError: (message: string | null) => void;
}

function togglePlayback(input: TogglePlaybackInput): void {
  input.request.current += 1;
  const next = !input.requested;
  input.setState({ id: input.id, requested: next, error: null });
  input.setPreferenceError(null);
  if (input.id) void writeMotionPaused(input.id, !next).catch((cause: unknown) =>
    input.setPreferenceError(cause instanceof Error ? cause.message : String(cause)));
  if (input.pause.id === input.id) input.setPause({ ...input.pause, paused: !next, loaded: true });
}

function currentPlaybackState(id: string | null, state: PlaybackState): PlaybackState {
  return state.id === id ? state : { id, requested: null, error: null };
}

function requestedPlayback(input: { readonly id: string | null; readonly current: PlaybackState;
  readonly pause: PausePreference; readonly reducedMotion: boolean }): boolean {
  const ready = input.id === null || input.pause.id === input.id && input.pause.loaded;
  if (!ready) return false;
  if (input.current.requested !== null) return input.current.requested;
  return !input.pause.paused && !input.reducedMotion;
}

function playingPlayback(input: { readonly requested: boolean; readonly visible: boolean; readonly focused: boolean;
  readonly pause: PausePreference; readonly current: PlaybackState }): boolean {
  return input.requested && input.visible && input.focused && input.pause.loaded && input.current.error === null;
}

function resolvePlayback(input: { readonly id: string | null; readonly state: PlaybackState; readonly pause: PausePreference;
  readonly reducedMotion: boolean; readonly visible: boolean; readonly focused: boolean }) {
  const current = currentPlaybackState(input.id, input.state);
  const requested = requestedPlayback({ ...input, current });
  return { current, requested, playing: playingPlayback({ ...input, current, requested }) };
}

function usePausePreference(id: string | null, onError: (message: string) => void) {
  const [pause, setPause] = useState<PausePreference>({ id: null, paused: false, loaded: false });
  const request = useRef(0);
  useEffect(() => {
    const version = ++request.current;
    onError('');
    if (!id) { setPause({ id: null, paused: false, loaded: true }); return; }
    setPause({ id, paused: false, loaded: false });
    void readMotionPaused(id).then((paused) => {
      if (request.current === version) setPause({ id, paused, loaded: true });
    }).catch((cause: unknown) => {
      if (request.current === version) {
        onError(cause instanceof Error ? cause.message : String(cause));
        setPause({ id, paused: false, loaded: true });
      }
    });
    return () => { request.current += 1; };
  }, [id, onError]);
  return { pause, setPause, request };
}

export function MotionPlaybackProvider({ children }: { readonly children: ReactNode }) {
  const { settings } = useData();
  const background = settings.appearance.background;
  const id = background.kind === 'motion' ? background.assetId : null;
  const image = useLocalImage(id, settings.appearance.dynamicColor.enabled, id !== null);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion);
  const visible = useSyncExternalStore(subscribePageVisible, readPageVisible);
  const focused = useSyncExternalStore(subscribeWindowFocus, readWindowFocused);
  const [state, setState] = useState<PlaybackState>({ id: null, requested: null, error: null });
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const setPreferenceMessage = useCallback((message: string) => setPreferenceError(message || null), []);
  const { pause, setPause, request } = usePausePreference(id, setPreferenceMessage);
  const playback = resolvePlayback({ id, state, pause, reducedMotion, visible, focused });
  const toggle = () => togglePlayback({ id, requested: playback.requested, state, setState, pause, setPause, request, setPreferenceError });
  const fail = (error: string) => setState({ id, requested: false, error });
  return <MotionContext value={{ image, active: id !== null, requested: playback.requested, reducedMotion,
    playing: playback.playing, error: playback.current.error, preferenceError, toggle, fail }}>{children}</MotionContext>;
}

export function useMotionPlayback(): MotionPlaybackValue {
  const value = use(MotionContext);
  if (!value) throw new Error('动态壁纸播放控制未初始化');
  return value;
}
