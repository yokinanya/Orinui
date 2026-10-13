const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const STRONG_ETAG = /^"[\x21\x23-\x7e\x80-\xff]*"$/;

export interface WebDavCredentials {
  readonly url: string;
  readonly username: string;
  readonly password: string;
}

export interface WebDavVaultManifest {
  readonly schemaVersion: 1;
  readonly vaultId: string;
  readonly ciphertext: string;
}

function credentialsRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('WebDAV 凭据格式不正确');
  return value as Record<string, unknown>;
}

function credentialTextFields(input: Record<string, unknown>): { url: string; username: string; password: string } {
  const { url, username, password } = input;
  if (typeof url !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
    throw new Error('WebDAV 地址、用户名和密码必须是文本');
  }
  return { url, username, password };
}

function rejectUrlCredentials(raw: string, url: URL): void {
  const authority = raw.match(/^https:\/\/([^/?#]*)/i)?.[1] ?? '';
  if (url.username || url.password || authority.includes('@')) {
    throw new Error('WebDAV 根地址必须是无凭据、查询参数或片段的 HTTPS collection URL');
  }
}

function rejectUrlSuffix(raw: string, url: URL): void {
  if (/[\u0000-\u0020\u007f-\u009f]/.test(raw) || url.search || url.hash || raw.includes('?') || raw.includes('#')) {
    throw new Error('WebDAV 根地址必须是无凭据、查询参数或片段的 HTTPS collection URL');
  }
}

function normalizedRoot(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !url.hostname) {
    throw new Error('WebDAV 根地址必须是无凭据、查询参数或片段的 HTTPS collection URL');
  }
  rejectUrlCredentials(raw, url);
  rejectUrlSuffix(raw, url);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url.href;
}

function validateAuth(username: string, password: string): void {
  if (!username || username.includes(':') || CONTROL_CHARACTERS.test(username)) {
    throw new Error('WebDAV 用户名和密码必须非空且不含控制字符');
  }
  if (!password || CONTROL_CHARACTERS.test(password)) throw new Error('WebDAV 用户名和密码必须非空且不含控制字符');
}

export function parseWebDavCredentials(value: unknown): WebDavCredentials {
  const input = credentialTextFields(credentialsRecord(value));
  validateAuth(input.username, input.password);
  return { url: normalizedRoot(input.url.trim()), username: input.username, password: input.password };
}

export function validateWebDavIdentity(value: string, label: string): string {
  if (!value || value.trim() !== value || CONTROL_CHARACTERS.test(value)
    || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || value.includes('%')) {
    throw new Error(`${label}标识不能安全用作 WebDAV 路径段`);
  }
  return value;
}

export function validateStrongEtag(value: string | null, label: string): string {
  if (!value || !STRONG_ETAG.test(value)) throw new Error(`${label}缺少有效的强 ETag`);
  return value;
}

export function parseWebDavVaultManifest(value: unknown): WebDavVaultManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('WebDAV 同步库描述格式不正确');
  const manifest = value as Record<string, unknown>;
  const keys = Object.keys(manifest).toSorted();
  if (keys.join(',') !== 'ciphertext,schemaVersion,vaultId' || manifest.schemaVersion !== 1
    || typeof manifest.vaultId !== 'string' || typeof manifest.ciphertext !== 'string'
    || !manifest.ciphertext || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(manifest.ciphertext)) {
    throw new Error('WebDAV 同步库描述版本、字段或密文格式无效');
  }
  validateWebDavIdentity(manifest.vaultId, '同步库');
  return { schemaVersion: 1, vaultId: manifest.vaultId, ciphertext: manifest.ciphertext };
}
