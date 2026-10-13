import { useEffect, useRef, useState } from 'react';

export function useImageSource(initialSourceUrl?: string | null) {
  const initialSource = initialSourceUrl ?? '';
  const [source, setSource] = useState(initialSource);
  const [hasUnsavedSource, setHasUnsavedSource] = useState(false);
  const dirty = useRef(false);
  const previousSavedSource = useRef(initialSource);

  useEffect(() => {
    const next = initialSourceUrl ?? '';
    const previous = previousSavedSource.current;
    previousSavedSource.current = next;
    if (previous === next) return;
    if (next === '') {
      dirty.current = false;
      setHasUnsavedSource(false);
      setSource('');
    } else if (!dirty.current) {
      setHasUnsavedSource(false);
      setSource(next);
    }
  }, [initialSourceUrl]);

  const changeSource = (next: string) => {
    dirty.current = true;
    setHasUnsavedSource(true);
    setSource(next);
  };
  const acceptSource = (next: string) => {
    dirty.current = false;
    setHasUnsavedSource(false);
    setSource(next);
  };
  return { source, hasUnsavedSource, changeSource, acceptSource };
}
