export function shortcutInitial(title: string): string {
  const first = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(title)[Symbol.iterator]().next();
  return first.done ? '?' : first.value.segment.toLocaleUpperCase();
}
