import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { ContentMotionAdapter } from '@/platform/content-motion';

const GROUP_SWITCH_DURATION_MS = 180;
const REDUCED_FADE_DURATION_MS = 150;
const CONTENT_ENTER_OFFSET_PX = 5;
const CONTENT_ENTER_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

interface GroupContentMotionOptions {
  readonly activeGroupId: string | null;
  readonly loadedGroupId: string | null;
  readonly motion: ContentMotionAdapter;
  readonly shortcutCount: number;
}

export function useGroupContentMotion({ activeGroupId, loadedGroupId, motion, shortcutCount }: GroupContentMotionOptions) {
  const contentRef = useRef<HTMLDivElement>(null);
  const previousGroupId = useRef(activeGroupId);
  const initialGroupObserved = useRef(activeGroupId !== null);
  const pendingGroupId = useRef<string | null>(null);
  const [transitionVersion, setTransitionVersion] = useState(0);
  const isLoaded = activeGroupId === null
    ? loadedGroupId === null && shortcutCount === 0
    : loadedGroupId === activeGroupId;

  useLayoutEffect(() => {
    const groupChanged = previousGroupId.current !== activeGroupId;
    if (groupChanged) {
      const next = nextGroupChange({
        previous: previousGroupId.current,
        current: activeGroupId,
        initialObserved: initialGroupObserved.current,
        pending: pendingGroupId.current,
      });
      previousGroupId.current = next.previous;
      initialGroupObserved.current = next.initialObserved;
      pendingGroupId.current = next.pending;
    }
    if (pendingGroupId.current === null || pendingGroupId.current !== activeGroupId || !isLoaded) return;
    pendingGroupId.current = null;
    setTransitionVersion((version) => version + 1);
  }, [activeGroupId, isLoaded]);

  useEffect(() => {
    if (transitionVersion === 0 || !contentRef.current) return;
    const animation = createGroupEnterAnimation(contentRef.current, motion);
    return () => animation.cancel();
  }, [motion, transitionVersion]);

  return { contentRef, isWaiting: !isLoaded };
}

interface GroupChangeState {
  readonly previous: string | null;
  readonly initialObserved: boolean;
  readonly pending: string | null;
}

interface GroupChangeInput extends GroupChangeState {
  readonly current: string | null;
}

function nextGroupChange({ previous, current, initialObserved, pending }: GroupChangeInput): GroupChangeState {
  if (current === null) return { previous: current, initialObserved, pending: null };
  if (!initialObserved) return { previous: current, initialObserved: true, pending };
  return { previous: current, initialObserved, pending: previous === null ? pending : current };
}

function createGroupEnterAnimation(element: HTMLElement, motion: ContentMotionAdapter) {
  const reduceMotion = motion.prefersReducedMotion();
  const keyframes: Keyframe[] = reduceMotion
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [{ opacity: 0, transform: `translateY(${CONTENT_ENTER_OFFSET_PX}px)` }, { opacity: 1, transform: 'translateY(0)' }];
  return motion.animate(element, keyframes, {
    duration: reduceMotion ? REDUCED_FADE_DURATION_MS : GROUP_SWITCH_DURATION_MS,
    easing: CONTENT_ENTER_EASING,
  });
}
