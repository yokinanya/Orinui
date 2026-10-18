import type { KeyboardEvent } from 'react';

/** ContextMenuTrigger handles pointer contextmenu, so route menu keys through the same event. */
export function openContextMenuFromKeyboard(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  event.preventDefault();
  const bounds = event.currentTarget.getBoundingClientRect();
  event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: bounds.left, clientY: bounds.bottom,
  }));
}
