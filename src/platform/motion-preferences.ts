const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

export function readReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION).matches;
}

export function subscribeReducedMotion(listener: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

export function readPageVisible(): boolean {
  return document.visibilityState === 'visible';
}

export function subscribePageVisible(listener: () => void): () => void {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}
