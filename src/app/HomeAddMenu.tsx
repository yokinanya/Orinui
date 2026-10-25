import { FolderPlusIcon, GlobeIcon, ListTodoIcon, PlusIcon, SquarePenIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { HomeWidget } from '@/domain/home';

export function HomeAddMenu({ onWebsite, onFolder, onWidget }: {
  readonly onWebsite: () => void;
  readonly onFolder: () => void;
  readonly onWidget: (kind: HomeWidget['kind']) => void;
}) {
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" aria-label="添加"
      title="添加" className="home-readable-control home-readable-focus rounded-full" />}><PlusIcon /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" side="top" className="w-40">
      <DropdownMenuGroup>
        <DropdownMenuItem onClick={onWebsite}><GlobeIcon />添加网站</DropdownMenuItem>
        <DropdownMenuItem onClick={onFolder}><FolderPlusIcon />新建文件夹</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onWidget('note')}><SquarePenIcon />添加便签</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onWidget('todo')}><ListTodoIcon />添加待办</DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
