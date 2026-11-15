import { CircleAlertIcon, InfoIcon, LockIcon, RotateCwIcon, ShieldAlertIcon, TriangleAlertIcon } from 'lucide-react';

import { useBookmarks } from '@/app/bookmark-context';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldError, FieldGroup } from '@/components/ui/field';
import { SettingsChoiceField, type ChoiceOption } from '@/features/settings/SettingsChoiceField';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { SettingsSwitchField } from '@/features/settings/SettingsSwitchField';
import { bookmarkReadAtLabel, type BookmarkContextValue, type BookmarkViewStatus } from '@/features/bookmarks/bookmark-view';
import { BookmarkTreeManager } from '@/features/bookmarks/BookmarkTreeManager';
import { BookmarkManagerGuidance } from '@/features/bookmarks/BookmarkManagerGuidance';
import { cn } from '@/lib/utils';

const MODE_OPTIONS: readonly ChoiceOption<'region' | 'folder'>[] = [
  { value: 'region', label: '区域' },
  { value: 'folder', label: '文件夹' },
];

function statusLine(input: {
  readonly status: BookmarkViewStatus;
  readonly permission: 'granted' | 'denied' | 'unknown';
  readonly enabled: boolean;
  readonly readAt: number | null;
  readonly busy: boolean;
}): { readonly text: string; readonly tone: 'default' | 'warning' | 'error' } {
  if (input.busy) return { text: '正在处理…', tone: 'default' };
  switch (input.status) {
    case 'disabled':
      // 首次拒绝授权时功能并未启用：主状态写「未授权」，不伪装成用户主动关闭。
      return input.permission === 'denied'
        ? { text: '本机未授权 · 不会读取收藏夹', tone: 'warning' }
        : { text: '未启用 · 本机不会读取收藏夹', tone: 'default' };
    case 'unsupported': return { text: '此浏览器不提供书签接口', tone: 'warning' };
    case 'permission-missing': return { text: '此设备需要授权', tone: 'warning' };
    case 'loading': return { text: '正在读取…', tone: 'default' };
    case 'ready': return { text: `本机已授权 · 读取成功 · 上次读取 ${bookmarkReadAtLabel(input.readAt)}`, tone: 'default' };
    case 'stale': return { text: `权限有效，但本次读取失败 · 使用上次读取 ${bookmarkReadAtLabel(input.readAt)}`, tone: 'warning' };
    case 'importing': return { text: '浏览器正在导入收藏夹，完成后一次性更新', tone: 'default' };
    case 'error': return { text: '读取失败 · 没有可用结果', tone: 'error' };
  }
}

/** 启用前说明：必须先于权限请求与开关可见，且描述 Chrome 实际会显示的只读警告。 */
function PermissionExplanation() {
  return (
    <div aria-label="权限与隐私说明" className="flex flex-col gap-1.5 rounded-xl border border-border/50 bg-background/40 p-3 text-xs text-muted-foreground">
      <p className="m-0 flex items-start gap-1.5">
        <LockIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        点击启用时，浏览器会显示「读取和更改您的书签」。Orinui 只用它读取标题、地址与层级，不会新增、修改、移动或删除任何书签。
      </p>
      <p className="m-0">只在本机展示；不上传、不写日志，书签内容不进入 ZIP 备份或同步快照，也不计入 Orinui 统计。</p>
      <p className="m-0">不抓取 favicon，不产生额外的网络请求。</p>
      <p className="m-0">可随时在浏览器扩展页撤销权限；关闭功能或撤销后，本机缓存会立即清除。</p>
      <p className="m-0">隐藏规则（浏览器节点 ID 与标题路径）只随同步传输，不进入 ZIP 与日志。</p>
    </div>
  );
}

/**
 * 书签设置分区。
 *
 * 需要应用提供方接线；缺失时明确说明未接线，不展示开关、模式或任何书签内容，
 * 也不用空列表伪装成「没有书签」。
 */
export function BookmarkSettingsPanel() {
  const bookmarks = useBookmarks();
  if (!bookmarks) return <UnconnectedBookmarkSettings />;
  return <BookmarkSettingsPanelBody bookmarks={bookmarks} />;
}

function UnconnectedBookmarkSettings() {
  return (
    <div className="settings-columns grid items-start gap-4 pb-2">
      <SettingsSection title="浏览器收藏夹" description="当前页面没有接入书签提供方。">
        <p role="status" className="m-0 text-xs text-muted-foreground">
          收藏夹设置需要应用提供方提供状态与动作；未接线时这里不显示开关、模式或任何书签内容，
          也不会请求权限。
        </p>
      </SettingsSection>
    </div>
  );
}

function BookmarkSettingsPanelBody({ bookmarks }: { readonly bookmarks: BookmarkContextValue }) {
  const { snapshot } = bookmarks;
  const status = statusLine({
    status: snapshot.status,
    permission: snapshot.permission,
    enabled: snapshot.enabled,
    readAt: snapshot.readAt,
    busy: snapshot.busy,
  });
  const supported = snapshot.status !== 'unsupported';

  return (
    <div className="settings-columns grid items-start gap-4 pb-2">
      <div className="flex min-w-0 flex-col gap-4">
        <SettingsSection title="启用浏览器收藏夹" description="默认关闭；只在用户主动开启时请求 bookmarks 权限。">
          <FieldGroup className="gap-3">
            {/* 说明必须在开关与权限请求之前可见。 */}
            <PermissionExplanation />
            <SettingsSwitchField label="启用浏览器收藏夹" checked={snapshot.enabled && snapshot.permission === 'granted'}
              onChange={(next) => { if (next) bookmarks.requestEnable(); else bookmarks.disable(); }} />
            <FieldDescription>
              开关表示「本机已启用且已授权」。启用意图可跨设备同步；本机撤权后开关显示为关闭，
              但意图会保留，可直接用下面的按钮重新授权，无需先关再开。
            </FieldDescription>
            <p role="status" aria-live="polite"
              className={cn('m-0 flex items-start gap-1.5 text-xs',
                status.tone === 'error' ? 'text-destructive'
                  : status.tone === 'warning' ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground')}>
              <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              {status.text}
            </p>
            {snapshot.error && snapshot.status !== 'stale' && snapshot.status !== 'error' && (
              <FieldError role="alert">{snapshot.error}</FieldError>
            )}
            {snapshot.actionError && <FieldError role="alert">{snapshot.actionError}</FieldError>}
            {!supported && (
              <p role="alert" className="m-0 flex items-start gap-1.5 text-xs text-muted-foreground">
                <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                当前浏览器没有提供书签接口；这不是空收藏夹，也没有可重试的读取操作。没有读取、没有缓存，也没有可显示的内容。
              </p>
            )}
            {supported && snapshot.status === 'error' && (
              <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-destructive/30 p-3">
                <p className="m-0 flex items-center gap-1.5 text-xs font-medium text-destructive">
                  <TriangleAlertIcon aria-hidden="true" className="size-3.5" />
                  暂时读不到浏览器收藏夹
                </p>
                <p className="m-0 text-xs text-muted-foreground">{snapshot.error ?? '本机没有可用的上次读取结果。'}</p>
                <Button type="button" size="sm" variant="outline" onClick={() => bookmarks.retry()}>
                  <RotateCwIcon aria-hidden="true" />
                  重新读取
                </Button>
              </div>
            )}
            {supported && snapshot.status === 'stale' && (
              <div role="status" className="flex flex-col items-start gap-2 rounded-lg border border-amber-600/30 bg-amber-500/10 p-3">
                <p className="m-0 flex items-center gap-1.5 text-xs font-medium">
                  <ShieldAlertIcon aria-hidden="true" className="size-3.5" />
                  上次读取可用，但本次读取失败
                </p>
                <p className="m-0 text-xs text-muted-foreground">{snapshot.error ?? '内容可能已过期，界面会逐项标注「上次读取」。'}</p>
                <Button type="button" size="sm" variant="outline" onClick={() => bookmarks.retry()}>
                  <RotateCwIcon aria-hidden="true" />
                  重试
                </Button>
              </div>
            )}
            {(snapshot.permission === 'denied' || snapshot.status === 'permission-missing') && (
              <div className="flex flex-col items-start gap-2 rounded-lg border border-amber-600/30 bg-amber-500/10 p-3">
                <p className="m-0 text-xs font-medium">本机尚未授权读取收藏夹</p>
                <p className="m-0 text-xs text-muted-foreground">
                  {snapshot.enabled
                    ? '启用意图已保留（可跨设备同步），但本机没有权限，因此不读取也不显示任何标题。重新授权无需先关闭再开启。'
                    : '授权后才会读取；拒绝则保持关闭。'}
                </p>
                <Button type="button" size="sm" onClick={() => bookmarks.requestEnable()}>
                  <LockIcon aria-hidden="true" />
                  重新允许读取收藏夹
                </Button>
              </div>
            )}
          </FieldGroup>
        </SettingsSection>

        <SettingsSection title="显示方式" description="两种模式都从整棵浏览器收藏夹树派生；没有来源选择。">
          <FieldGroup className="gap-3">
            <SettingsChoiceField responsive label="主页模式" value={snapshot.mode} options={MODE_OPTIONS}
              onChange={(mode) => bookmarks.updateMode(mode)} />
            <p className="m-0 text-xs text-muted-foreground">
              {snapshot.mode === 'region'
                ? '区域：固定标题「浏览器收藏夹」，按全部浏览器根与完整路径分组，根直属链接归入「未分类」。'
                : '文件夹：主页显示全部浏览器根的直接子项，点击后逐层浏览，含面包屑与返回。'}
            </p>
            <FieldDescription>
              区域顺序与显隐只在「布局」分区调整；这里不重复提供区域开关。布局隐藏只影响主页显示，
              收藏夹仍会出现在搜索中（需开启下面的搜索开关）。
            </FieldDescription>
            <SettingsSwitchField label="在搜索中显示浏览器收藏夹" checked={snapshot.showInSearch}
              onChange={(show) => bookmarks.updateSearch(show)} />
            <FieldDescription>搜索结果会带完整路径；权限有效但读取失败时，每条结果都会标注「上次读取」。</FieldDescription>
          </FieldGroup>
        </SettingsSection>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <SettingsSection title="完整收藏夹树与隐藏规则" description="隐藏或恢复浏览器根与文件夹；单个书签不可隐藏。">
          <BookmarkTreeManager bookmarks={bookmarks} />
        </SettingsSection>

        <SettingsSection title="本机缓存" description="仅用于权限仍有效但读取失败时的降级显示。">
          <FieldGroup className="gap-3">
            <p className="m-0 text-xs text-muted-foreground">上次读取：{bookmarkReadAtLabel(snapshot.readAt)}</p>
            <p className="m-0 text-xs text-muted-foreground">
              关闭功能或撤销权限会立即清除本机缓存；没有额外的清除或「重置书签」入口。
              缓存只用于读取失败时显示「上次读取」，不会上传，也不影响浏览器里的书签。
            </p>
            {snapshot.status === 'stale' && (
              <p role="status" className="m-0 text-xs text-amber-800 dark:text-amber-300">
                当前显示的是上次读取结果，可能已过期；可在「启用浏览器收藏夹」分区重试读取。
              </p>
            )}
          </FieldGroup>
        </SettingsSection>

        <SettingsSection title="在浏览器中管理书签" description="Orinui 严格只读；管理入口尚未经过真实扩展验证，因此只给手动步骤。">
          <BookmarkManagerGuidance />
        </SettingsSection>
      </div>
    </div>
  );
}
