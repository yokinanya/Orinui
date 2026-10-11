import { describe, expect, it } from 'vitest';
import { validateRemoteImageUrl } from '@/domain/remote-image-url';

describe('validateRemoteImageUrl', () => {
  it('accepts public HTTPS and keeps query parameters', () => {
    const result = validateRemoteImageUrl('https://cdn.example.org/icon.svg?variant=dark');
    expect(result.url.search).toBe('?variant=dark');
    expect(result.originPattern).toBe('https://cdn.example.org/*');
  });
  it('only permits HTTP on exact localhost', () => {
    expect(validateRemoteImageUrl('http://localhost:8000/icon.png').originPattern).toBe('http://localhost/*');
    expect(() => validateRemoteImageUrl('http://127.0.0.1/icon.png')).toThrow(/localhost/);
    expect(() => validateRemoteImageUrl('http://localhost.attacker.example/icon.png')).toThrow(/localhost/);
  });
  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'https://user:pass@example.com/icon.png',
    'https://127.0.0.1/icon.png', 'https://10.1.2.3/icon.png', 'https://172.16.0.1/icon.png',
    'https://192.168.1.8/icon.png', 'https://[::1]/icon.png', 'https://[fd00::1]/icon.png',
    'https://printer.local/icon.png', 'https://router.home.arpa/icon.png'])('rejects unsafe URL %s', (url) => {
    expect(() => validateRemoteImageUrl(url)).toThrow();
  });
  it('rejects malformed IPv6 text', () => {
    expect(() => validateRemoteImageUrl('https://[1:2:3:4:5:6:7:8:9]/icon.png')).toThrow();
  });
  it('rejects noncanonical integer-encoded IPv4 loopback and accepts public IPv6', () => {
    expect(() => validateRemoteImageUrl('https://2130706433/icon.png')).toThrow(/本机或内网/);
    expect(validateRemoteImageUrl('https://[2606:4700:4700::1111]/icon.png').url.hostname).toContain('2606');
  });
});
