import { POSTER_EDGE } from '@/domain/motion';

interface DecodedFrame {
  readonly image: VideoFrame;
}

interface NativeImageDecoder {
  readonly tracks: { readonly ready: Promise<void>; readonly selectedTrack: { readonly frameCount: number } | null };
  decode(options: { readonly frameIndex: number }): Promise<DecodedFrame>;
  close(): void;
}

type ImageDecoderConstructor = new (options: { readonly data: ArrayBuffer; readonly type: string }) => NativeImageDecoder;

export interface MediaFrame {
  readonly width: number;
  readonly height: number;
  readonly duration: number | null;
  readonly poster: Blob;
}

export async function encodePoster(source: CanvasImageSource, size: { readonly width: number; readonly height: number }): Promise<Blob> {
  const scale = Math.min(1, POSTER_EDGE / Math.max(size.width, size.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(size.width * scale));
  canvas.height = Math.max(1, Math.round(size.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法生成壁纸封面');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (!blob) { reject(new Error('壁纸封面编码失败')); return; }
    resolve(blob);
  }, 'image/png'));
}

export async function decodeAnimation(blob: Blob): Promise<MediaFrame> {
  const runtime = globalThis as typeof globalThis & { readonly ImageDecoder?: ImageDecoderConstructor };
  if (!runtime.ImageDecoder) throw new Error('当前浏览器不支持动图解码');
  const decoder = new runtime.ImageDecoder({ data: await blob.arrayBuffer(), type: blob.type });
  try {
    await decoder.tracks.ready;
    if (!decoder.tracks.selectedTrack || decoder.tracks.selectedTrack.frameCount <= 1) {
      throw new Error('请选择包含多帧内容的 GIF 或动态 WebP');
    }
    const { image } = await decoder.decode({ frameIndex: 0 });
    try {
      const size = { width: image.displayWidth, height: image.displayHeight };
      return { ...size, duration: null, poster: await encodePoster(image, size) };
    } finally { image.close(); }
  } finally { decoder.close(); }
}

function waitForVideoFrame(video: HTMLVideoElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const clear = () => { video.onloadeddata = null; video.onerror = null; };
    video.onloadeddata = () => { clear(); resolve(); };
    video.onerror = () => { clear(); reject(new Error('浏览器无法解码此视频，请使用受支持的 MP4 或 WebM 编码')); };
    video.src = url;
    video.load();
  });
}

export async function decodeVideo(blob: Blob): Promise<MediaFrame> {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  const url = URL.createObjectURL(blob);
  try {
    await waitForVideoFrame(video, url);
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
      throw new Error('视频缺少有效画面或时长');
    }
    const size = { width: video.videoWidth, height: video.videoHeight };
    return { ...size, duration: video.duration, poster: await encodePoster(video, size) };
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
