export interface ContentMotionAdapter {
  prefersReducedMotion(): boolean;
  animate(element: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation;
}

export const browserContentMotion: ContentMotionAdapter = {
  prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  },
  animate(element, keyframes, options) {
    return element.animate(keyframes, options);
  },
};
