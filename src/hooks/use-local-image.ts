import { useEffect, useState } from 'react';

import { useData } from '@/app/data-context';
import { photoSeed } from '@/platform/images';
import type { ImageAsset } from '@/domain/asset';

interface LocalImageState {
  readonly id: string | null;
  readonly url: string | null;
  readonly mime: string | null;
  readonly seed: string | null;
  readonly seedError: string | null;
  readonly sourceUrl: string | null;
  readonly error: string | null;
}

const EMPTY_IMAGE: LocalImageState = { id: null, url: null, mime: null, seed: null, seedError: null, sourceUrl: null, error: null };

type PhotoAsset = Pick<ImageAsset, 'id' | 'blob' | 'width' | 'height'>;

export function useLocalImage(id: string | null, extractSeed = false): LocalImageState {
  const { readImageAsset } = useData();
  const [state, setState] = useState<LocalImageState>(EMPTY_IMAGE);
  const [asset, setAsset] = useState<PhotoAsset | null>(null);

  useEffect(() => {
    if (!id) { setAsset(null); setState(EMPTY_IMAGE); return; }
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const image = await readImageAsset(id);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(image.blob);
        setAsset({ id, blob: image.blob, width: image.width, height: image.height });
        setState({ id, url: objectUrl, mime: image.mime, seed: null, seedError: null, sourceUrl: image.sourceUrl, error: null });
      } catch (cause) {
        if (cancelled) return;
        setAsset(null);
        setState({ id, url: null, mime: null, seed: null, seedError: null, sourceUrl: null,
          error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, readImageAsset]);

  useEffect(() => {
    if (!id || asset?.id !== id) return;
    if (!extractSeed) {
      setState((current) => current.id === id && current.seedError ? { ...current, seedError: null } : current);
      return;
    }
    let cancelled = false;
    void photoSeed(asset.blob, asset.width, asset.height).then((seed) => {
      if (cancelled) return;
      setState((current) => current.id === id ? { ...current, seed, seedError: null } : current);
    }).catch((cause: unknown) => {
      if (cancelled) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      setState((current) => current.id === id ? { ...current, seedError: message } : current);
    });
    return () => { cancelled = true; };
  }, [id, extractSeed, asset]);
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
