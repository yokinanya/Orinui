import type { Folder } from '@/domain/folder';
import { shortcutDisplayName, type Shortcut } from '@/domain/shortcut';

export interface SearchSpelling { readonly full: string; readonly initials: string }
export type TransliterateSearchText = (text: string) => SearchSpelling;
interface IndexedText extends SearchSpelling { readonly text: string }
export interface LocalSearchItem {
  readonly id: string;
  readonly kind: 'site' | 'folder';
  readonly label: string;
  readonly detail: string;
  readonly value: string;
  readonly fields: readonly IndexedText[];
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
const MATCH_SCORES = { exact: 0, prefix: 1, includes: 2, pinyin: 3, initials: 4 } as const;

function indexText(value: string, spell: TransliterateSearchText): IndexedText {
  const spelling = spell(value);
  return { text: normalize(value), full: normalize(spelling.full), initials: normalize(spelling.initials) };
}

function siteItem(input: { readonly site: Shortcut; readonly folder?: Folder; readonly spell: TransliterateSearchText }): LocalSearchItem {
  const { site, folder, spell } = input;
  const name = shortcutDisplayName(site);
  return { id: site.id, kind: 'site', label: name, detail: `${folder?.name ?? '主页'} · ${site.url}`,
    value: site.url,
    fields: [name, site.url, ...(folder ? [folder.name] : [])].map((value) => indexText(value, spell)) };
}

export function buildLocalSearchIndex(input: { readonly shortcuts: readonly Shortcut[];
  readonly folders: readonly Folder[]; readonly transliterate: TransliterateSearchText }): readonly LocalSearchItem[] {
  const byId = new Map(input.folders.map((folder) => [folder.id, folder]));
  const sites = input.shortcuts.flatMap((site) => {
    const folder = site.folderId === null ? undefined : byId.get(site.folderId);
    return site.folderId !== null && !folder ? [] : [siteItem({ site, folder, spell: input.transliterate })];
  });
  const folders = input.folders.map((folder): LocalSearchItem => ({ id: folder.id, kind: 'folder',
    label: `打开文件夹「${folder.name}」`, detail: '本地文件夹', value: folder.id,
    fields: [indexText(folder.name, input.transliterate)] }));
  return [...sites, ...folders];
}

function fieldScore(field: IndexedText, needle: string): number | null {
  if (field.text === needle) return MATCH_SCORES.exact;
  if (field.text.startsWith(needle)) return MATCH_SCORES.prefix;
  if (field.text.includes(needle)) return MATCH_SCORES.includes;
  const compact = needle.replace(/\s+/gu, '');
  if (field.full.includes(compact)) return MATCH_SCORES.pinyin;
  return field.initials.includes(compact) ? MATCH_SCORES.initials : null;
}

export function searchLocalIndex(input: { readonly index: readonly LocalSearchItem[]; readonly query: string;
  readonly sources: { readonly showSites: boolean; readonly showFolders: boolean } }): readonly LocalSearchItem[] {
  const needle = normalize(input.query.trim());
  if (!needle) return [];
  return input.index.flatMap((item) => {
    if (item.kind === 'site' ? !input.sources.showSites : !input.sources.showFolders) return [];
    const scores = item.fields.map((field) => fieldScore(field, needle)).filter((value): value is number => value !== null);
    return scores.length ? [{ item, score: Math.min(...scores) }] : [];
  }).toSorted((a, b) => a.score - b.score).map(({ item }) => item);
}
