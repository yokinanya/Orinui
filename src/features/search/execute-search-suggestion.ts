import type { OpenTarget } from '@/domain/settings';
import type { SearchSuggestion } from '@/features/search/search-model';

/**
 * 动作执行端口。
 *
 * 书签无法在页面内直接导航：`openBookmark` / `openBookmarkFolder` 按节点 ID 委托给
 * 书签上下文，由其调用平台层的浏览器导航 API；这里不使用 `href`、`window.open`、
 * `eval` 或任何网络请求。端口可选，缺失时明确报错，不伪造成功。
 */
export interface ExecutionPorts {
  readonly copy: (value: string) => Promise<void>;
  readonly open: (url: string, target: OpenTarget) => void;
  readonly openFolder: (id: string) => void;
  readonly fill: (query: string) => void;
  readonly dismiss: () => void;
  readonly copied: () => void;
  /** 打开当前投影内的浏览器书签节点（按节点 ID 定位，保留原始地址与全协议）。 */
  readonly openBookmark?: (nodeId: string) => void;
  /** 定位到浏览器文件夹；由书签区域/文件夹视图消费。 */
  readonly openBookmarkFolder?: (nodeId: string) => void;
}

const BOOKMARK_PORT_MISSING = '浏览器书签打开端口未接入';
const BOOKMARK_FOLDER_PORT_MISSING = '浏览器文件夹定位端口未接入';
const BOOKMARK_NODE_MISSING = '书签已不在当前列表';
const UNAVAILABLE_BOOKMARK = '此书签没有可用地址，无法打开';

export async function executeSearchSuggestion(input: { readonly item: SearchSuggestion;
  readonly targets: { readonly search: OpenTarget; readonly shortcut: OpenTarget }; readonly ports: ExecutionPorts }): Promise<void> {
  const { item, targets, ports } = input;
  if (item.kind === 'error') throw new Error(item.detail);
  if (item.kind === 'status') return;
  if (item.kind === 'fill') { ports.fill(item.value); return; }
  if (item.kind === 'copy') {
    await ports.copy(item.value);
    ports.copied();
    return;
  }
  if (item.kind === 'bookmark') {
    if (item.unavailable === true || item.value.length === 0) {
      throw new Error(item.activationError ?? UNAVAILABLE_BOOKMARK);
    }
    if (!ports.openBookmark) throw new Error(BOOKMARK_PORT_MISSING);
    if (!item.bookmarkNodeId) throw new Error(BOOKMARK_NODE_MISSING);
    ports.dismiss();
    ports.openBookmark(item.bookmarkNodeId);
    return;
  }
  if (item.kind === 'bookmark-folder') {
    if (!ports.openBookmarkFolder) throw new Error(BOOKMARK_FOLDER_PORT_MISSING);
    ports.dismiss();
    ports.openBookmarkFolder(item.bookmarkNodeId ?? item.value);
    return;
  }
  ports.dismiss();
  if (item.kind === 'folder') { ports.openFolder(item.value); return; }
  ports.open(item.value, item.section === 'site' ? targets.shortcut : targets.search);
}
