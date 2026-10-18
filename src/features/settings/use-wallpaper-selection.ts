import { useEffect, useRef, useState } from 'react';

export function useWallpaperSelection() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const restoreFocus = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedId) {
      detailRef.current?.focus({ preventScroll: true });
      return;
    }
    const id = restoreFocus.current;
    if (!id) return;
    restoreFocus.current = null;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-asset-id="${id}"] button`)?.focus();
  }, [selectedId]);

  const select = (id: string) => {
    restoreFocus.current = null;
    setSelectedId(id);
  };
  const close = () => {
    restoreFocus.current = selectedId;
    setSelectedId(null);
  };
  const clear = () => {
    restoreFocus.current = null;
    setSelectedId(null);
  };
  return { selectedId, gridRef, detailRef, select, close, clear };
}
