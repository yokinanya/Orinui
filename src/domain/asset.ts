/**
 * 本地媒体资源。
 *
 * 媒体二进制与结构化配置分开保存，配置只引用资源标识；新标签页渲染不联网获取媒体。
 * 用户启用同步后，原始媒体逐项端到端加密同步；poster 仅作可再生的本地缓存。
 */
export type MediaAssetKind = 'background' | 'icon';

export interface MediaAssetMotion {
  readonly kind: 'video' | 'animation';
  readonly duration: number | null;
  /** 可重建的本机预览缓存，不进入备份或同步。 */
  readonly poster?: Blob;
}

export interface MediaAsset {
  id: string;
  kind: MediaAssetKind;
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/svg+xml' | 'video/mp4' | 'video/webm';
  width: number;
  height: number;
  blob: Blob;
  /** 外链下载的来源地址；本地上传为 null。不保存许可信息。 */
  sourceUrl: string | null;
  /** 素材库显示名；null 表示使用按格式与尺寸生成的默认名称。 */
  name?: string | null;
  /** 素材加入素材库的时间；用于素材库排序（顺序可被用户调整）。 */
  createdAt?: number;
  /** 有此字段才是动态媒体；WebP 动图通过 animation 标识。 */
  motion?: MediaAssetMotion;
}
