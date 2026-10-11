import type { Shortcut } from '@/domain/shortcut';
import { BookOpenIcon, BriefcaseBusinessIcon, CodeXmlIcon, CompassIcon, HeartIcon, SparklesIcon } from 'lucide-react';
import { useLocalImage } from '@/hooks/use-local-image';

function initial(title: string): string {
  const first = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(title)[Symbol.iterator]().next();
  return first.done ? '?' : first.value.segment.toLocaleUpperCase();
}

export function ShortcutIcon({ shortcut }: { readonly shortcut: Shortcut }) {
  const image = useLocalImage(shortcut.icon.kind === 'asset' ? shortcut.icon.assetId : null);
  if (shortcut.icon.kind === 'letter') return initial(shortcut.title);
  if (shortcut.icon.kind === 'built-in') {
    const Icon = {
      compass: CompassIcon,
      book: BookOpenIcon,
      briefcase: BriefcaseBusinessIcon,
      code: CodeXmlIcon,
      heart: HeartIcon,
      sparkles: SparklesIcon,
    }[shortcut.icon.iconId];
    return <Icon aria-hidden="true" className="size-7" />;
  }
  if (image.error) return <span title={image.error}>图标读取失败</span>;
  return image.url ? <img src={image.url} alt="" className="size-full rounded-2xl object-contain" /> : null;
}
