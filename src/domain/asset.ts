/**
 * 本地图片资源。
 *
 * 数据契约 §1.4 与 §5：图片二进制与结构化配置分开保存，
 * 当前实现仅本地保存，配置只引用资源标识；新标签页渲染不联网获取图片。
 * 未来用户启用的加密同步按 SYNC-DESIGN.md 实施，当前尚无上传实现。
 */
export type ImageAssetKind = 'background' | 'icon';

export interface ImageAsset {
  id: string;
  kind: ImageAssetKind;
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  width: number;
  height: number;
  blob: Blob;
  /** 外链下载的来源地址；本地上传为 null。不保存许可信息。 */
  sourceUrl: string | null;
}
