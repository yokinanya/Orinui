import type { LayoutConfig } from '@/domain/layout';
import type { SearchPreferences } from '@/domain/settings';

export const PAGE_WIDTH_CLASSES: Record<LayoutConfig['pageWidth'], string> = {
  compact: 'max-w-[40rem]', standard: 'max-w-3xl', wide: 'max-w-5xl',
};

export const REGION_SPACING_CLASSES: Record<LayoutConfig['regionSpacing'], string> = {
  compact: 'gap-6', standard: 'gap-10', relaxed: 'gap-14',
};

export const SEARCH_WIDTH_CLASSES: Record<SearchPreferences['width'], string> = {
  narrow: 'max-w-md', standard: 'max-w-xl', wide: 'max-w-[44rem]',
};
