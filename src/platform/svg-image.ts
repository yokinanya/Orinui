import type { MediaAsset } from '@/domain/asset';
import { fail } from '@/domain/errors';
import { SVG_EDGE_LIMIT } from '@/domain/image';
import { validateSvg } from '@/platform/svg';

const VIEW_BOX_COMPONENTS = 4;
const WIDTH_COMPONENT = 2;
const HEIGHT_COMPONENT = 3;

function readViewBox(root: SVGSVGElement): readonly number[] | undefined {
  const source = root.getAttribute('viewBox');
  if (source === null) return undefined;
  const values = source.trim().split(/[\s,]+/).map(Number);
  if (values.length !== VIEW_BOX_COMPONENTS || !values.every(Number.isFinite)
    || values[WIDTH_COMPONENT]! <= 0 || values[HEIGHT_COMPONENT]! <= 0) fail('SVG viewBox 不正确');
  return values;
}

function requireDimension(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    fail('SVG 需要有效的尺寸或 viewBox，请改用 PNG/WebP');
  }
  return value;
}

function readDimension(source: string | null, viewBoxDimension: number | undefined): number {
  if (source === null) return requireDimension(viewBoxDimension);
  if (/^(?:\d+(?:\.\d+)?|\.\d+)(?:em|rem|%)$/.test(source) && Number.parseFloat(source) > 0) {
    return requireDimension(viewBoxDimension);
  }
  return requireDimension(Number(source.replace(/px$/, '')));
}

function svgDimensions(root: SVGSVGElement): { readonly width: number; readonly height: number } {
  const box = readViewBox(root);
  const rawWidth = root.getAttribute('width');
  const rawHeight = root.getAttribute('height');
  return { width: readDimension(rawWidth, box?.[WIDTH_COMPONENT]), height: readDimension(rawHeight, box?.[HEIGHT_COMPONENT]) };
}

/** 保留已验证的几何内容，统一尺寸，使上传、下载、备份与同步使用相同的静态 SVG。 */
export async function prepareSvgImage(blob: Blob): Promise<{ readonly blob: Blob; readonly width: number; readonly height: number }> {
  const root = validateSvg(await blob.text());
  const original = svgDimensions(root);
  const ratio = Math.min(1, SVG_EDGE_LIMIT / Math.max(original.width, original.height));
  const width = Math.max(1, Math.round(original.width * ratio));
  const height = Math.max(1, Math.round(original.height * ratio));
  if (!root.hasAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${original.width} ${original.height}`);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  return { width, height, blob: new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }) };
}

export async function validateSvgImageAsset(asset: MediaAsset): Promise<void> {
  if (asset.kind !== 'icon' || asset.mime !== 'image/svg+xml') fail('SVG 资源只能用作网站图标');
  const root = validateSvg(await asset.blob.text());
  const size = svgDimensions(root);
  if (size.width !== asset.width || size.height !== asset.height || Math.max(size.width, size.height) > SVG_EDGE_LIMIT) {
    fail('SVG 实际尺寸与图片记录不一致');
  }
}
