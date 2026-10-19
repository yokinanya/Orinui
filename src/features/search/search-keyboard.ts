import type { KeyboardEvent, MutableRefObject } from 'react';

const IME_PROCESSING_KEY = 229;

export interface SearchKeyboardInput {
  readonly event: KeyboardEvent<HTMLInputElement>;
  readonly query: string;
  readonly showing: boolean;
  readonly activeIndex: number;
  readonly itemIds: readonly string[];
  readonly composing: MutableRefObject<boolean>;
  readonly suppressSubmit: MutableRefObject<boolean>;
  readonly select: (id: string | null) => void;
  readonly change: (value: string) => void;
  readonly dismiss: () => void;
  readonly execute: () => void;
}

function moveSelection(input: SearchKeyboardInput): boolean {
  const { event, showing, itemIds, activeIndex } = input;
  if (!showing || !itemIds.length || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return false;
  event.preventDefault();
  const direction = event.key === 'ArrowDown' ? 1 : -1;
  const index = (activeIndex + direction + itemIds.length) % itemIds.length;
  input.select(itemIds[index]!);
  document.getElementById(`search-option-${itemIds[index]}`)?.scrollIntoView({ block: 'nearest' });
  return true;
}

function escapeSearch(input: SearchKeyboardInput): boolean {
  if (input.event.key !== 'Escape') return false;
  if (!input.showing && !input.query.trim()) return false;
  input.event.preventDefault();
  input.event.stopPropagation();
  if (input.showing) { input.dismiss(); input.select(null); }
  else { input.change(''); input.select(null); }
  return true;
}

export function handleSearchKeyboard(input: SearchKeyboardInput): void {
  const { event } = input;
  if (input.composing.current || event.nativeEvent.isComposing || event.keyCode === IME_PROCESSING_KEY) {
    input.suppressSubmit.current = true;
    return;
  }
  input.suppressSubmit.current = false;
  if (moveSelection(input) || escapeSearch(input)) return;
  if (event.key === 'Enter' && input.query.trim()) {
    event.preventDefault();
    if (input.showing) input.execute();
    else input.change(input.query);
  }
}
