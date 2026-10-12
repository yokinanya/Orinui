import { useEffect, useRef, useState } from 'react';

export function useImageSource(initialSourceUrl?: string | null) {
  const initialSource = initialSourceUrl ?? '';
  const [source, setSource] = useState(initialSource);
  const dirty = useRef(false);
  const previousSavedSource = useRef(initialSource);

  useEffect(() => {
    const next = initialSourceUrl ?? '';
    const previous = previousSavedSource.current;
    previousSavedSource.current = next;
    if (previous === next) return;
    if (next === '') {
      dirty.current = false;
      setSource('');
    } else if (!dirty.current) setSource(next);
  }, [initialSourceUrl]);

  const changeSource = (next: string) => {
    dirty.current = true;
    setSource(next);
  };
  const acceptSource = (next: string) => {
    dirty.current = false;
    setSource(next);
  };
  return { source, changeSource, acceptSource };
}
