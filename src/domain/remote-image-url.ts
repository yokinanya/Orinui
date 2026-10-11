import { fail } from '@/domain/errors';

const NON_PUBLIC_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home.arpa', '.test', '.invalid', '.example'];

function privateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const first = parts[0] ?? -1;
  const second = parts[1] ?? -1;
  return privateIpv4ClassA(first, second) || privateIpv4ClassB(first, second) || privateIpv4ClassC(first, second);
}

function privateIpv4ClassA(first: number, second: number): boolean {
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254);
}

function privateIpv4ClassB(first: number, second: number): boolean {
  return (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

function privateIpv4ClassC(first: number, second: number): boolean {
  return (first === 100 && second >= 64 && second <= 127) || first >= 224;
}

function ipv6Words(host: string): number[] | null {
  const value = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!value.includes(':')) return null;
  const halves = value.split('::');
  if (halves.length > 2) return [];
  const expand = (half: string) => half === '' ? [] : half.split(':').map((word) => Number.parseInt(word, 16));
  const before = expand(halves[0] ?? '');
  const after = expand(halves[1] ?? '');
  const missing = 8 - before.length - after.length;
  if (missing < 0 || halves.length === 1 && missing !== 0) return [];
  return [...before, ...Array.from({ length: missing }, () => 0), ...after];
}

function nonPublicIpv6(host: string): boolean {
  const words = ipv6Words(host);
  if (!words) return false;
  if (isMalformedOrUnspecifiedIpv6(words)) return true;
  if (isIpv6Loopback(words)) return true;
  if (isIpv6PrivateRange(words[0] ?? 0)) return true;
  if (words[0] === 0xff00) return true;
  const firstWord = words[0] ?? 0;
  if (firstWord < 0x2000 || firstWord > 0x3fff) return true;
  return isPrivateIpv4MappedIpv6(words);
}

function isMalformedOrUnspecifiedIpv6(words: readonly number[]): boolean {
  return words.length !== 8 || words.every((word) => word === 0);
}

function isIpv6Loopback(words: readonly number[]): boolean {
  const zeroPrefix = words[0] === 0 && words.slice(1, 7).every((word) => word === 0);
  const loopbackTail = words[7] === 1 || words[7] === 0;
  return zeroPrefix && loopbackTail;
}

function isIpv6PrivateRange(firstWord: number): boolean {
  return (firstWord & 0xfe00) === 0xfc00 || (firstWord & 0xffc0) === 0xfe80;
}

function isPrivateIpv4MappedIpv6(words: readonly number[]): boolean {
  const ipv4Mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (!ipv4Mapped) return false;
  const host4 = `${words[6]! >> 8}.${words[6]! & 255}.${words[7]! >> 8}.${words[7]! & 255}`;
  return privateIpv4(host4);
}

export interface RemoteImageLocation {
  readonly url: URL;
  readonly originPattern: string;
}

function parseImageUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value.trim()); }
  catch { return fail('图片地址格式不正确'); }
  return url;
}

function validateCredentials(url: URL): void {
  if (url.username || url.password) fail('图片地址不能包含用户名或密码');
}

function validateProtocol(url: URL, host: string): void {
  if (url.protocol === 'http:') {
    if (host !== 'localhost') fail('HTTP 图片只允许 localhost');
  } else if (url.protocol !== 'https:') {
    fail('图片地址必须使用 HTTPS');
  }
}

function isNonPublicSuffix(host: string): boolean {
  const suffixHost = host.endsWith('.') ? host.slice(0, -1) : host;
  return suffixHost === 'localhost' || NON_PUBLIC_SUFFIXES.some((suffix) => suffixHost.endsWith(suffix));
}

function validatePublicHttpsHost(url: URL, host: string): void {
  if (url.protocol !== 'https:') return;
  if (isNonPublicSuffix(host) || privateIpv4(host) || nonPublicIpv6(host)) fail('图片地址不能指向本机或内网');
}

function validateIpv6Syntax(url: URL, host: string): void {
  if (url.protocol === 'https:' && ipv6Words(host)?.length === 0) fail('IPv6 图片地址格式不正确');
}

function validateHostname(url: URL): void {
  if (url.hostname === '' || url.origin === 'null') fail('图片地址缺少有效主机名');
}

/** 接受公网 HTTPS 图片地址；HTTP 只允许精确的 localhost 主机。 */
export function validateRemoteImageUrl(value: string): RemoteImageLocation {
  const url = parseImageUrl(value);
  validateCredentials(url);
  const host = url.hostname.toLowerCase();
  validateProtocol(url, host);
  validatePublicHttpsHost(url, host);
  validateIpv6Syntax(url, host);
  validateHostname(url);
  const hostnamePattern = `${url.protocol}//${host}/*`;
  return { url, originPattern: hostnamePattern };
}
