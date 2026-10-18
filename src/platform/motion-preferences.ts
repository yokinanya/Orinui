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

export function readWindowFocused(): boolean {
  return document.hasFocus();
}

export function subscribeWindowFocus(listener: () => void): () => void {
  window.addEventListener('focus', listener);
  window.addEventListener('blur', listener);
  return () => {
    window.removeEventListener('focus', listener);
    window.removeEventListener('blur', listener);
  };
}
