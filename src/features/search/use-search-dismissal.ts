import { useEffect, type RefObject } from 'react';

function editableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function useSearchDismissal(input: { readonly root: RefObject<HTMLFormElement | null>;
  readonly inputRef: RefObject<HTMLInputElement | null>; readonly dismiss: () => void }) {
  const { root, inputRef, dismiss } = input;
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) dismiss();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [root, dismiss]);
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || editableTarget(event.target)) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', focus);
    return () => window.removeEventListener('keydown', focus);
  }, [inputRef]);
}
