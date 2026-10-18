import { useEffect, useState } from 'react';

import { useData } from '@/app/data-context';
import { photoReadabilityColor, photoSeed } from '@/platform/images';
import type { MediaAsset } from '@/domain/asset';

interface LocalImageState {
  readonly id: string | null;
  readonly url: string | null;
  readonly mediaUrl: string | null;
  readonly motionKind: 'video' | 'animation' | null;
  readonly mime: string | null;
  readonly seed: string | null;
  readonly seedError: string | null;
  readonly readabilityColor: string | null;
  readonly readabilityColorError: string | null;
  readonly sourceUrl: string | null;
  readonly error: string | null;
}

const EMPTY_IMAGE: LocalImageState = { id: null, url: null, mediaUrl: null, motionKind: null, mime: null,
  seed: null, seedError: null, readabilityColor: null, readabilityColorError: null, sourceUrl: null, error: null };

type PhotoAsset = Pick<MediaAsset, 'id' | 'blob' | 'width' | 'height'>;

function useImageResource(id: string | null, readMediaAsset: (id: string) => Promise<MediaAsset>) {
  const [state, setState] = useState<LocalImageState>(EMPTY_IMAGE);
  const [asset, setAsset] = useState<PhotoAsset | null>(null);

  useEffect(() => {
    if (!id) { setAsset(null); setState(EMPTY_IMAGE); return; }
    let cancelled = false;
    let objectUrl: string | null = null;
    let mediaUrl: string | null = null;
    void (async () => {
      try {
        const image = await readMediaAsset(id);
        if (cancelled) return;
        const poster = image.motion ? image.motion.poster : image.blob;
        if (!poster) throw new Error('动态壁纸封面缺失，请重新上传此素材');
        objectUrl = URL.createObjectURL(poster);
        if (image.motion) mediaUrl = URL.createObjectURL(image.blob);
        setAsset({ id, blob: poster, width: image.width, height: image.height });
        setState({ id, url: objectUrl, mediaUrl, motionKind: image.motion?.kind ?? null, mime: image.mime,
          seed: null, seedError: null, readabilityColor: null, readabilityColorError: null,
          sourceUrl: image.sourceUrl, error: null });
      } catch (cause) {
        if (cancelled) return;
        setAsset(null);
        setState({ ...EMPTY_IMAGE, id,
          error: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    };
  }, [id, readMediaAsset]);
  return { state, setState, asset };
}

export function useLocalImage(id: string | null, extractSeed = false, extractReadabilityColor = false): LocalImageState {
  const { readMediaAsset } = useData();
  const { state, setState, asset } = useImageResource(id, readMediaAsset);
  useEffect(() => {
    if (!id || asset?.id !== id) return;
    if (!extractSeed) {
      setState((current) => current.id === id && current.seedError ? { ...current, seedError: null } : current);
    }
    if (!extractSeed && !extractReadabilityColor) {
      return;
    }
    let cancelled = false;
    if (extractSeed) void photoSeed(asset.blob, asset.width, asset.height).then((seed) => {
      if (!cancelled) setState((current) => current.id === id ? { ...current, seed, seedError: null } : current);
    }).catch((cause: unknown) => {
      if (!cancelled) setState((current) => current.id === id
        ? { ...current, seedError: cause instanceof Error ? cause.message : String(cause) } : current);
    });
    if (extractReadabilityColor) void photoReadabilityColor(asset.blob, asset.width, asset.height).then((readabilityColor) => {
      if (!cancelled) setState((current) => current.id === id
        ? { ...current, readabilityColor, readabilityColorError: null } : current);
    }).catch((cause: unknown) => {
      if (!cancelled) setState((current) => current.id === id
        ? { ...current, readabilityColorError: cause instanceof Error ? cause.message : String(cause) } : current);
    });
    return () => { cancelled = true; };
  }, [id, extractSeed, extractReadabilityColor, asset]);
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
