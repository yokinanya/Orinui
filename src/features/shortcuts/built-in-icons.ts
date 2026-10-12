import { BookOpenIcon, BriefcaseBusinessIcon, CodeXmlIcon, CompassIcon, HeartIcon, SparklesIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BuiltInIconId } from '@/domain/shortcut';

export const BUILT_IN_ICONS = {
  compass: { label: '罗盘', Icon: CompassIcon },
  book: { label: '书本', Icon: BookOpenIcon },
  briefcase: { label: '公文包', Icon: BriefcaseBusinessIcon },
  code: { label: '代码', Icon: CodeXmlIcon },
  heart: { label: '爱心', Icon: HeartIcon },
  sparkles: { label: '星光', Icon: SparklesIcon },
} as const satisfies Readonly<Record<BuiltInIconId, { readonly label: string; readonly Icon: LucideIcon }>>;
