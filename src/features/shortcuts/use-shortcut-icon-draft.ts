import { useState } from 'react';
import type { Shortcut, ShortcutIcon } from '@/domain/shortcut';
import { parseShortcutIcon, shortcutIconOccupancy } from '@/domain/shortcut-icon';
import type { NewImageAsset } from '@/storage/assets';

export function useShortcutIconDraft(shortcut: Shortcut | undefined) {
  const [icon, setIcon] = useState<ShortcutIcon>(shortcut?.icon ?? { kind: 'letter' });
  const [svgColor, setSvgColor] = useState<string | null>(() => readSvgColor(shortcut?.icon));
  const [iconSourceUrl, setIconSourceUrl] = useState(shortcut?.iconSourceUrl ?? null);
  const [image, setImage] = useState<NewImageAsset | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const initializeIcon = (current: Shortcut | undefined) => {
    setIcon(current?.icon ?? { kind: 'letter' });
    setSvgColor(readSvgColor(current?.icon));
    setIconSourceUrl(current?.iconSourceUrl ?? null);
    setImage(null);
    setImageBusy(false);
  };
  const chooseIcon = (next: ShortcutIcon) => {
    setImage(null);
    setSvgColor(null);
    setIconSourceUrl(null);
    setIcon((current) => parseShortcutIcon({ ...next, occupancy: shortcutIconOccupancy(current) }));
  };
  const selectLocalImage = (next: NewImageAsset) => {
    setImage(next);
    setIconSourceUrl(null);
    if (next.mime !== 'image/svg+xml') setSvgColor(null);
  };
  const selectRemoteImage = (next: NewImageAsset) => {
    setImage(next);
    setIconSourceUrl(next.sourceUrl ?? null);
    if (next.mime !== 'image/svg+xml') setSvgColor(null);
  };
  const setIconOccupancy = (occupancy: number) => setIcon((current) => parseShortcutIcon({ ...current, occupancy }));
  return { icon, iconOccupancy: shortcutIconOccupancy(icon), setIconOccupancy, svgColor, setSvgColor, iconSourceUrl, setIconSourceUrl,
    image, imageBusy, setImageBusy, setImage: selectLocalImage, initializeIcon, chooseIcon,
    resetIcon: () => chooseIcon({ kind: 'letter' }), selectRemoteImage };
}

function readSvgColor(icon: ShortcutIcon | undefined): string | null {
  return icon && 'color' in icon ? icon.color ?? null : null;
}
