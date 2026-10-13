import type { CSSProperties } from 'react';
import { SHORTCUT_ICON_OCCUPANCY } from '@/domain/shortcut-icon';

export const HOME_ICON_FRAME_SIZE = 48;
export const ICON_PREVIEW_FRAME_SIZE = 64;
export const HOME_ICON_INSET = 0;
// 仅留出 1px 边框；预览与主页的内容占比以各自外框为基准。
export const ICON_PREVIEW_INSET = 1;
const LETTER_FONT_RATIO = 0.5;

export function iconFrameStyle(): CSSProperties {
  return { width: HOME_ICON_FRAME_SIZE, height: HOME_ICON_FRAME_SIZE, fontSize: HOME_ICON_FRAME_SIZE * LETTER_FONT_RATIO };
}

function contentEdge(input: { readonly frameSize: number; readonly occupancy: number; readonly inset: number }): number {
  return (input.frameSize - input.inset * 2) * input.occupancy / SHORTCUT_ICON_OCCUPANCY.maximum;
}

export function iconGraphicStyle(input: { readonly frameSize: number; readonly occupancy: number; readonly inset: number }): CSSProperties {
  const edge = contentEdge(input);
  return { width: edge, height: edge };
}

export function iconLetterStyle(input: { readonly frameSize: number; readonly occupancy: number; readonly inset: number }): CSSProperties {
  return { fontSize: contentEdge(input) * LETTER_FONT_RATIO };
}
