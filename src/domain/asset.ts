/**
 * 本地图片资源。
 *
 * 数据契约 §1.4 与 §5：图片二进制与结构化配置分开保存，
 * 配置只引用资源标识；图片从不上传，也不会在打开新标签页时联网获取。
 */
export type ImageAssetKind = 'background' | 'icon';

export interface ImageAsset {
  id: string;
  kind: ImageAssetKind;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  blob: Blob;
  /** 外链下载的来源地址；本地上传为 null。不保存许可信息。 */
  sourceUrl: string | null;
}
