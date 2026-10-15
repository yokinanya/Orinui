import { CheckIcon, PencilIcon, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { MotionPlaybackButton } from '@/features/appearance/MotionPlaybackButton';

interface HomeActionsProps {
  readonly editing: boolean;
  readonly canEdit: boolean;
  readonly onEditingChange: (editing: boolean) => void;
}

export function HomeActions({ editing, canEdit, onEditingChange }: HomeActionsProps) {
  const editButton = (
    <Button type="button" variant="ghost" size="icon"
      aria-label={editing ? '完成编辑' : '编辑分组与网站'} aria-pressed={editing}
      onClick={() => onEditingChange(!editing)} className="home-readable-control home-readable-focus rounded-full">
      {editing ? <CheckIcon /> : <PencilIcon />}
    </Button>
  );

  return (
    <div className="fixed right-4 bottom-4 z-40 flex flex-col items-center gap-2 md:right-6 md:bottom-6">
      <MotionPlaybackButton compact />
      {canEdit && (
        <Tooltip>
          <TooltipTrigger render={editButton} />
          <TooltipContent>{editing ? '完成编辑' : '编辑分组与网站'}</TooltipContent>
        </Tooltip>
      )}
      <SettingsPanel trigger={
        <Button variant="ghost" size="icon" aria-label="设置" className="home-readable-control home-readable-focus rounded-full">
          <Settings />
        </Button>
      } />
    </div>
  );
}
