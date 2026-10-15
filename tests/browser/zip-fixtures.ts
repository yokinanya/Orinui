import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { readFile } from 'node:fs/promises';

interface ZipFixtureManifest extends Record<string, unknown> {
  readonly formatVersion: number;
  readonly groups: Array<{ readonly name: string; readonly isDefault: boolean }>;
  readonly assets: Array<{ readonly id: string; readonly mime: string; readonly kind: string; readonly sourceUrl: string | null }>;
  readonly shortcuts: Array<{ readonly id: string; readonly iconSourceUrl: string | null; readonly icon: { readonly color?: string } }>;
  readonly settings: { readonly appearance: { readonly background: Record<string, unknown> }; readonly clock: Record<string, unknown> };
}

export function createZipFixture(manifest: Record<string, unknown>, assets: Record<string, Uint8Array> = {}): Buffer {
  const entries = { 'manifest.json': strToU8(JSON.stringify(manifest)), ...assets };
  return Buffer.from(zipSync(entries, { level: 0 }));
}

export async function readZipFixture(path: string): Promise<{ readonly manifest: ZipFixtureManifest; readonly assets: Record<string, Uint8Array> }> {
  const archive = unzipSync(new Uint8Array(await readFile(path)));
  const manifestBytes = archive['manifest.json'];
  if (!manifestBytes) throw new Error('ZIP 未包含 manifest.json');
  return { manifest: JSON.parse(strFromU8(manifestBytes)) as ZipFixtureManifest, assets: archive };
}
