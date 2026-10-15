import { fail } from '@/domain/errors';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_FIXED_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 0xffff;
export const ZIP_EOCD_SEARCH_BYTES = EOCD_FIXED_BYTES + MAX_ZIP_COMMENT_BYTES;
const CRC_POLYNOMIAL = 0xedb88320;

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let value = 0; value < table.length; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? CRC_POLYNOMIAL ^ (crc >>> 1) : crc >>> 1;
    table[value] = crc >>> 0;
  }
  return table;
}

const CRC_TABLE = createCrcTable();

export function updateZipCrc(crc: number, bytes: Uint8Array): number {
  let value = crc;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return value >>> 0;
}

export function finishZipCrc(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0;
}

function findEocd(tail: Uint8Array): { readonly offset: number; readonly view: DataView } {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let offset = tail.length - EOCD_FIXED_BYTES; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) !== EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + EOCD_FIXED_BYTES + commentLength === tail.length) return { offset, view };
  }
  fail('ZIP 文件尾部不完整：缺少中央目录结束记录');
}

function parseCentralNames(bytes: Uint8Array, expected: ReadonlyMap<string, number>): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const names = new Set<string>();
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) fail('ZIP 中央目录结构不正确');
    const crc = view.getUint32(offset + 16, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) fail('ZIP 中央目录条目被截断');
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (names.has(name)) fail(`ZIP 中央目录包含重复条目：${name}`);
    names.add(name);
    if (expected.get(name) !== crc) fail(`ZIP CRC 校验失败：${name}`);
    offset = end;
  }
  if (names.size !== expected.size || [...expected.keys()].some((name) => !names.has(name))) fail('ZIP 中央目录与本地条目不一致');
}

export interface ZipEndInput {
  readonly file: File;
  readonly tail: Uint8Array;
  readonly fileSize: number;
  readonly checksums: ReadonlyMap<string, number>;
}

export async function validateZipEnd(input: ZipEndInput): Promise<void> {
  const { file, tail, fileSize, checksums } = input;
  if (tail.length > ZIP_EOCD_SEARCH_BYTES || fileSize !== file.size) fail('ZIP 流长度与文件不一致');
  const eocd = findEocd(tail);
  const tailStart = fileSize - tail.length;
  const disk = eocd.view.getUint16(eocd.offset + 4, true);
  const centralDisk = eocd.view.getUint16(eocd.offset + 6, true);
  const diskEntries = eocd.view.getUint16(eocd.offset + 8, true);
  const entryCount = eocd.view.getUint16(eocd.offset + 10, true);
  const centralSize = eocd.view.getUint32(eocd.offset + 12, true);
  const centralOffset = eocd.view.getUint32(eocd.offset + 16, true);
  const absoluteEocd = tailStart + eocd.offset;
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount || entryCount !== checksums.size) fail('不支持多磁盘或不完整 ZIP');
  if (centralOffset + centralSize !== absoluteEocd) fail('ZIP 中央目录偏移或长度不正确');
  const directory = new Uint8Array(await file.slice(centralOffset, absoluteEocd).arrayBuffer());
  parseCentralNames(directory, checksums);
}
