import { useEffect, useState } from 'react';

import { useData } from '@/app/data-context';
import { photoSeed } from '@/platform/images';

interface LocalImageState {
  readonly id: string | null;
  readonly url: string | null;
  readonly mime: string | null;
  readonly seed: string | null;
  readonly sourceUrl: string | null;
  readonly error: string | null;
}

const EMPTY_IMAGE: LocalImageState = { id: null, url: null, mime: null, seed: null, sourceUrl: null, error: null };

export function useLocalImage(id: string | null, extractSeed = false): LocalImageState {
  const { readImageAsset } = useData();
  const [state, setState] = useState<LocalImageState>(EMPTY_IMAGE);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const asset = await readImageAsset(id);
        const seed = extractSeed ? await photoSeed(asset.blob) : null;
        if (cancelled) return;
        objectUrl = URL.createObjectURL(asset.blob);
        setState({ id, url: objectUrl, mime: asset.mime, seed, sourceUrl: asset.sourceUrl, error: null });
      } catch (cause) {
        if (!cancelled) setState({ id, url: null, mime: null, seed: null, sourceUrl: null, error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, extractSeed, readImageAsset]);
  return state.id === id ? state : EMPTY_IMAGE;
}

export function useBlobUrl(blob: Blob | null): string | null {
  const [state, setState] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setState({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return state?.blob === blob ? state.url : null;
}
