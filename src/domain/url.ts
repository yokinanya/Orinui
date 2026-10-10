import { fail } from '@/domain/errors';
import { LIMITS } from '@/domain/limits';

/** scheme 形如 `https:`、`mailto:`，用于判断用户是否已写明协议。 */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * 规范化快捷方式地址。
 *
 * 数据契约 §2.1：仅接受 http/https，缺少协议时补 https，
 * 拒绝凭据与非 http(s) 协议，保留用户输入的路径、查询与片段。
 */
export function normalizeShortcutUrl(input: string): string {
  const trimmed = input.trim();

  if (trimmed === '') {
    fail('网址不能为空');
  }
  if (trimmed.length > LIMITS.urlChars) {
    fail(`网址最多 ${LIMITS.urlChars} 个字符`);
  }

  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    fail('网址格式不正确');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail('只支持 http 或 https 网址');
  }
  if (parsed.hostname === '') {
    fail('网址缺少主机名');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    fail('网址不能包含用户名或密码');
  }
  if (candidate.length > LIMITS.urlChars) {
    fail(`网址最多 ${LIMITS.urlChars} 个字符`);
  }

  return candidate;
}
