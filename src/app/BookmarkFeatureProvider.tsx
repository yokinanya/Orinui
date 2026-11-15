import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { BookmarkContextProvider } from '@/app/bookmark-context';
import { connectBookmarkPreferences, type BookmarkPreferenceBridge } from '@/app/bookmark-preference-bridge';
import {
  createBookmarkSource,
  type BookmarkPlatformPort,
  type BookmarkSource,
  type BookmarkSourceSnapshot,
} from '@/app/bookmark-source';
import { useData } from '@/app/data-context';
import {
  createBookmarkTreeIndex,
  normalizeBookmarkTree,
  resolveHiddenRules,
  type BookmarkHiddenRuleInput,
  type BrowserBookmarkNode,
  type NormalizedBookmarkTree,
} from '@/domain/browser-bookmarks';
import type { BookmarkHiddenRule, BookmarkPreferences } from '@/domain/bookmark-preferences';
import { newId } from '@/domain/id';
import type { SlotId } from '@/domain/layout';
import { notifyError } from '@/lib/notify';
import { createBookmarkCache, type BookmarkCache } from '@/platform/bookmark-cache';
import {
  hasBookmarkApi,
  hasBookmarkPermission,
  openBookmark,
  readBookmarkTree,
  requestBookmarkPermission,
  subscribeBookmarkChanges,
  subscribeBookmarkPermissionChanges,
  type BookmarkOpenTarget,
} from '@/platform/bookmarks';
import {
  bookmarkAddressState,
  findBookmarkNode,
  type BookmarkContextValue,
  type BookmarkFolderRequest,
  type BookmarkNodeView,
  type BookmarkRootView,
  type BookmarkRuleCandidate,
  type BookmarkRuleMatch,
  type BookmarkViewSnapshot,
  type BookmarkViewStatus,
} from '@/features/bookmarks/bookmark-view';

/**
 * 浏览器收藏夹的运行时装配。
 *
 * 边界：
 * - 浏览器 API 只经 `src/platform/bookmarks.ts` 与 `bookmark-cache.ts` 端口调用；本文件不直接使用扩展 API。
 * - 偏好与隐藏规则只经 `DataContext` 的现有命令写入；书签内容不写入 folders/shortcuts/assets/settings.home。
 * - 首次授权只在用户点击 `requestEnable` 的同一调用链内同步发起；启动阶段只查权限，不弹窗。
 * - 每个页面会话只创建一个数据源：首帧偏好作为稳定初值，后续本页与跨页提交经同一门控只应用一次。
 * - 关闭功能或撤销权限后，内存投影与缓存由数据源清空；这里同时拒绝迟到的树写回。
 * - 布局隐藏只影响主页区域是否渲染，不影响 `BookmarkContextValue` 本身，因此搜索仍可用。
 */

const NOOP = () => {};

/** 快照允许读取内容的状态；其余状态不展示任何树。 */
const READABLE_STATUSES: ReadonlySet<BookmarkViewStatus> = new Set(['ready', 'stale', 'importing']);

/** 数据尚未就绪时的安全上下文：功能按关闭处理，不伪造书签内容。 */
const INACTIVE_CONTEXT: BookmarkContextValue = {
  snapshot: {
    status: 'disabled',
    permission: 'unknown',
    enabled: false,
    mode: 'region',
    showInSearch: false,
    regionVisible: true,
    roots: [],
    hiddenRules: [],
    hiddenNodeIds: [],
    ruleMatches: [],
    error: null,
    actionError: null,
    readAt: null,
    busy: false,
    folderRequest: null,
  },
  requestEnable: NOOP,
  disable: NOOP,
  retry: NOOP,
  updateMode: NOOP,
  updateSearch: NOOP,
  setRegionVisible: NOOP,
  setHidden: NOOP,
  bindRule: NOOP,
  deleteRule: NOOP,
  clearCache: NOOP,
  openBookmark: NOOP,
  openFolder: NOOP,
};

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function toRuleInput(preferences: BookmarkPreferences): BookmarkHiddenRuleInput[] {
  return preferences.hiddenRules.map((rule) => ({
    ruleId: rule.ruleId,
    targetId: rule.targetId,
    path: [...rule.path],
    kind: rule.kind,
    hidden: rule.hidden,
    updatedAt: rule.updatedAt,
  }));
}

/** 迭代构建中间结构：`children` 需要可变才能逐层回填，最终对外仍是只读视图。 */
interface NodeViewDraft {
  readonly nodeId: string;
  readonly kind: BookmarkNodeView['kind'];
  readonly title: string;
  readonly url: string | null;
  readonly path: string[];
  readonly children: BookmarkNodeView[];
}

/**
 * 把规范化树转成界面视图，使用显式栈而不是递归。
 *
 * 浏览器允许合法深层嵌套，递归转换在几千层时会 `RangeError`，并会丢失整棵树。
 * 这里不设任何内容或深度上限：每个节点按原始顺序进入对应层级的 `children`，
 * 空文件夹、分隔符、原始标题与原始地址全部原样保留。
 */
function toNodeViews(nodes: readonly BrowserBookmarkNode[]): BookmarkNodeView[] {
  interface Frame {
    readonly source: readonly BrowserBookmarkNode[];
    readonly sink: BookmarkNodeView[];
    next: number;
  }
  const result: BookmarkNodeView[] = [];
  const stack: Frame[] = [{ source: nodes, sink: result, next: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    if (frame.next >= frame.source.length) {
      stack.pop();
      continue;
    }
    const node = frame.source[frame.next];
    frame.next += 1;
    if (node === undefined) continue;
    const draft: NodeViewDraft = {
      nodeId: node.id,
      kind: node.kind,
      title: node.title,
      url: node.url,
      path: [...node.path],
      children: [],
    };
    frame.sink.push(draft);
    if (node.children.length > 0) stack.push({ source: node.children, sink: draft.children, next: 0 });
  }
  return result;
}

function toRootViews(tree: NormalizedBookmarkTree): BookmarkRootView[] {
  return tree.roots.map((root) => ({
    nodeId: root.id,
    title: root.title,
    path: [...root.path],
    children: toNodeViews(root.children),
  }));
}

function candidateFor(node: BrowserBookmarkNode): BookmarkRuleCandidate {
  return {
    nodeId: node.id,
    path: [...node.path],
    kind: node.parentId === null ? 'root' : 'folder',
  };
}

/**
 * 由数据源快照、完整规范树与用户偏好派生 UI 快照。
 *
 * 完整树包含被隐藏的节点，`hiddenNodeIds` 单独给出，使设置里的隐藏管理可以恢复显示；
 * 搜索与主页仍按 `hiddenNodeIds` 过滤，不展示被隐藏的根或文件夹。
 */
export interface BookmarkViewInput {
  readonly source: BookmarkSourceSnapshot;
  readonly tree: NormalizedBookmarkTree | null;
  /** 当前 canonical 启用意图（本页设置与跨页已提交值合成）；不是本机实际授权状态。 */
  readonly intentEnabled: boolean;
  readonly preferences: BookmarkPreferences;
  readonly layoutHidden: readonly string[];
  readonly actionError: string | null;
  readonly busy: boolean;
  readonly folderRequest: BookmarkFolderRequest | null;
}

/** 数据源状态 → 界面状态；启用意图仍在但本机被撤销/拒绝时归为需要重新授权。 */
export function bookmarkViewStatus(source: Pick<BookmarkSourceSnapshot, 'status' | 'importing'>, intentEnabled: boolean): BookmarkViewStatus {
  if (source.status === 'ready') return source.importing ? 'importing' : 'ready';
  if (source.status === 'disabled' && intentEnabled) return 'permission-missing';
  return source.status;
}

function ruleMatches(
  tree: NormalizedBookmarkTree | null,
  rules: readonly BookmarkHiddenRule[],
): { readonly hiddenNodeIds: readonly string[]; readonly matches: readonly BookmarkRuleMatch[] } {
  if (!tree) return { hiddenNodeIds: [], matches: [] };
  const resolution = resolveHiddenRules(tree, rules);
  const index = createBookmarkTreeIndex(tree);
  const matches: BookmarkRuleMatch[] = [
    ...resolution.matched.map((match) => {
      const node = index.byId.get(match.nodeId);
      return {
        ruleId: match.rule.ruleId,
        status: 'matched' as const,
        nodeId: match.nodeId,
        candidates: node ? [candidateFor(node)] : [],
      };
    }),
    ...resolution.pending.map((pending) => ({
      ruleId: pending.rule.ruleId,
      status: pending.status,
      nodeId: null,
      candidates: pending.candidates.flatMap((nodeId) => {
        const node = index.byId.get(nodeId);
        return node ? [candidateFor(node)] : [];
      }),
    })),
  ];
  return { hiddenNodeIds: [...resolution.hiddenNodeIds], matches };
}

export function bookmarkViewSnapshot(input: BookmarkViewInput): BookmarkViewSnapshot {
  const status = bookmarkViewStatus(input.source, input.intentEnabled);
  const readable = READABLE_STATUSES.has(status);
  const { hiddenNodeIds, matches } = readable ? ruleMatches(input.tree, input.preferences.hiddenRules) : {
    hiddenNodeIds: [] as readonly string[],
    matches: [] as readonly BookmarkRuleMatch[],
  };
  const error = [input.source.error, input.source.cacheWarning]
    .filter((entry): entry is string => entry !== null && entry !== undefined && entry !== '')
    .join('；');
  return {
    status,
    permission: input.source.permission,
    enabled: input.intentEnabled,
    mode: input.preferences.mode,
    showInSearch: input.preferences.showInSearch,
    // 布局空数组就是“没有隐藏项”，不能回落到创建时的旧布局。
    regionVisible: !input.layoutHidden.includes('bookmarks'),
    roots: readable && input.tree ? toRootViews(input.tree) : [],
    hiddenRules: input.preferences.hiddenRules,
    hiddenNodeIds,
    ruleMatches: matches,
    error: error === '' ? null : error,
    actionError: input.actionError,
    readAt: input.source.readAt,
    busy: input.busy,
    folderRequest: input.folderRequest,
  };
}

/**
 * 解析可委托打开的书签地址。
 *
 * 只有功能启用、本机已授权、状态可读，且节点仍是当前投影里的书签时返回原始地址；
 * 地址只用于判断能否交给浏览器（`bookmarkAddressState`），返回值完全保持浏览器原文，
 * 不 trim、不补协议、不改写。失败返回明确原因，不猜测、不回退到其他节点。
 */
export function resolveBookmarkOpenTarget(
  snapshot: BookmarkViewSnapshot,
  nodeId: string,
): { readonly url: string } | { readonly error: string } {
  if (!snapshot.enabled || snapshot.permission !== 'granted' || !READABLE_STATUSES.has(snapshot.status)) {
    return { error: '浏览器收藏夹当前不可读取，无法打开书签' };
  }
  const node = findBookmarkNode(snapshot.roots, nodeId);
  if (!node || node.kind !== 'bookmark') return { error: '书签已不在当前列表，请重新读取后再试' };
  if (bookmarkAddressState(node.url) !== 'usable') return { error: '书签地址缺失或不完整，无法打开' };
  return { url: node.url as string };
}

/**
 * 打开失败的可见反馈文案。
 *
 * 原生导航失败的错误文本可能夹带书签主机、路径、标题，甚至完整地址或 URL 编码值；
 * 提示条与操作中心是界面之外的公共区域，不可能可靠判断哪部分是机密，因此这里
 * 统一使用固定安全说明，完全不展示原始 `cause` 内容，也不写 console。
 *
 * 只保留本层能确定且不含书签内容的固定原因（如缺节点、坏地址），它们由
 * `resolveBookmarkOpenTarget` 产生，不经此函数拼接原件。
 */
export function bookmarkOpenFailureMessage(): string {
  return '书签未打开：浏览器拒绝了打开请求，请稍后重试';
}

export interface BookmarkOpenInput {
  readonly snapshot: BookmarkViewSnapshot;
  readonly nodeId: string;
  readonly target: BookmarkOpenTarget;
  readonly open: (url: string, target: BookmarkOpenTarget) => Promise<void>;
  /** 失败上报。区域被布局隐藏时这是唯一可见的反馈通道，必须由调用方接到常驻通知。 */
  readonly report: (message: string) => void;
}

/**
 * 执行一次书签打开：地址只来自当前投影的原始节点值。
 *
 * 返回 `true` 表示委托成功且不报错；任何失败都恰好上报一次明确原因，不伪造成功。
 */
export async function openBookmarkWithFeedback(input: BookmarkOpenInput): Promise<boolean> {
  const resolved = resolveBookmarkOpenTarget(input.snapshot, input.nodeId);
  if ('error' in resolved) {
    input.report(resolved.error);
    return false;
  }
  try {
    await input.open(resolved.url, input.target);
    return true;
  } catch {
    // 不读取原始 cause：原生错误里可能含书签主机/路径/标题，公共反馈只给固定安全说明。
    input.report(bookmarkOpenFailureMessage());
    return false;
  }
}

/**
 * 归一化隐藏规则的命中去重集合只做两件事：校验与去重，绝不替调用方补数据。
 *
 * - 未给出（`undefined`）是唯一允许生成新规则 ID 的入口：这是「新建一条隐藏」的语义。
 * - 数组是「更新这些已存在的规则」的语义：空数组、全空白项或夹空白项一律整次拒绝，
 *   否则会给用户悄悄造出 `hidden: false` 的规则，还会掩盖调用方的错误。
 * - 有效数组保持调用方顺序稳定去重；ID 原样保留，不 trim、不改名。
 *
 * 同节点可能存在多条 `hidden: true` 规则，取消隐藏时必须逐条更新，不能只改第一条。
 * 输入不合法时抛错，由 `run` 的失败通道显示，不会退回新建。
 */
export function resolveHiddenRuleIds(
  ruleId: string | readonly string[] | undefined,
  makeId: () => string,
): string[] {
  if (ruleId === undefined) return [makeId()];
  if (typeof ruleId === 'string') {
    if (ruleId.trim() === '') throw new Error('隐藏规则 ID 不能为空，未执行任何写入');
    return [ruleId];
  }
  if (ruleId.length === 0) throw new Error('没有要更新的隐藏规则，未执行任何写入');
  for (const entry of ruleId) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new Error('隐藏规则 ID 列表含空白项，已整次取消，未执行任何写入');
    }
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of ruleId) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    ids.push(entry);
  }
  return ids;
}

export interface HiddenRuleApplyInput {
  /** 已经归一化、去重后的规则 ID；顺序即写入顺序。 */
  readonly ruleIds: readonly string[];
  readonly write: (ruleId: string) => Promise<void>;
}

export interface HiddenRuleApplyResult {
  /** 实际写入成功的规则 ID，按写入顺序。 */
  readonly written: readonly string[];
  /** 第一条失败对应的规则 ID；全成功时为 null。 */
  readonly failedRuleId: string | null;
  /** 可直接展示的失败说明（含已完成数量），全成功时为 null。 */
  readonly error: string | null;
}

/**
 * 在单次动作内逐条写入隐藏规则。
 *
 * 必须顺序 `await`：并行写会让同一节点的多条规则互相覆盖，也会撞上提供方的忙锁。
 * 第一条失败即停止，已完成条目如实保留并在错误里说明，其余留给用户重试；
 * 不把部分成功伪报成全部成功。
 */
export async function applyHiddenRules(input: HiddenRuleApplyInput): Promise<HiddenRuleApplyResult> {
  const written: string[] = [];
  for (let index = 0; index < input.ruleIds.length; index += 1) {
    const ruleId = input.ruleIds[index] as string;
    try {
      await input.write(ruleId);
      written.push(ruleId);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      const remaining = input.ruleIds.length - written.length;
      return {
        written,
        failedRuleId: ruleId,
        error: remaining === 1
          ? `隐藏规则保存失败（已完成 ${written.length} 条），可稍后重试。原因：${reason}`
          : `隐藏规则未全部保存：已完成 ${written.length} 条，还剩 ${remaining} 条可重试。原因：${reason}`,
      };
    }
  }
  return { written, failedRuleId: null, error: null };
}

/**
 * 本次授权尝试是否真的让功能进入可读状态。
 *
 * `enableFromGesture` 会返回权限请求的原始结果；如果请求期间发生撤销/关闭，数据源
 * 只更新权限显示并保留关闭状态，此时 `permission` 仍可能是 `granted`。持久化启用意图
 * 必须同时核对数据源快照，不能只看返回值。
 */
export function enableAttemptSucceeded(snapshot: BookmarkSourceSnapshot): boolean {
  return snapshot.enabled && snapshot.permission === 'granted'
    && snapshot.status !== 'permission-missing' && snapshot.status !== 'disabled';
}

function initialSnapshot(preferences: BookmarkPreferences): BookmarkSourceSnapshot {
  return {
    status: preferences.enabled ? 'loading' : 'disabled',
    capability: 'unsupported',
    permission: 'unknown',
    enabled: preferences.enabled,
    mode: preferences.mode,
    projection: null,
    readAt: null,
    stale: false,
    error: null,
    importing: false,
    pendingRules: [],
    cacheWarning: null,
  };
}

function createPlatform(onTree: (tree: NormalizedBookmarkTree) => void): BookmarkPlatformPort {
  return {
    capability: hasBookmarkApi,
    permission: hasBookmarkPermission,
    requestPermission: requestBookmarkPermission,
    async read() {
      const raw = await readBookmarkTree();
      // 数据源在读完还会再确认一次权限；这里先自查一次，避免撤销期间把迟到的树交给界面。
      if (await hasBookmarkPermission() !== 'granted') return raw;
      // 数据源内部还会再规范化一次；这里保留一份完整树用于展示被隐藏的根与设置管理。
      onTree(normalizeBookmarkTree(raw));
      return raw;
    },
    subscribeChanges: (handlers) => subscribeBookmarkChanges(handlers),
    subscribePermissionChanges: (listener) => subscribeBookmarkPermissionChanges(listener),
    open: (url, target) => openBookmark(url, target),
  };
}

/** 包装缓存端口，顺带记录降级展示所用的整棵树；缓存语义保持由平台实现决定。 */
function createTrackedCache(onTree: (tree: NormalizedBookmarkTree) => void): BookmarkCache {
  const inner = createBookmarkCache();
  return {
    async read() {
      const cached = await inner.read();
      if (cached) onTree(cached.tree);
      return cached;
    },
    write: (tree, generation) => inner.write(tree, generation),
    clear: (generation) => inner.clear(generation),
    subscribe: (listener) => inner.subscribe(listener),
    minimumGeneration: () => inner.minimumGeneration(),
  };
}

interface BookmarkFeatureRuntimeProps {
  /** 首帧偏好；只在挂载时读取一次，之后的变化必须走 `applyPreferences`。 */
  readonly initialPreferences: BookmarkPreferences;
  readonly children: ReactNode;
}

function BookmarkFeatureRuntime({ initialPreferences, children }: BookmarkFeatureRuntimeProps) {
  const data = useData();
  const initial = useRef(initialPreferences);
  const [snapshot, setSnapshot] = useState<BookmarkSourceSnapshot>(() => initialSnapshot(initial.current));
  const [tree, setTree] = useState<NormalizedBookmarkTree | null>(null);
  /** canonical 偏好：本页设置与跨页观察共用一份，界面不再直读可能过期的 data.settings。 */
  const [preferences, setPreferences] = useState<BookmarkPreferences>(initialPreferences);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [folderRequest, setFolderRequest] = useState<BookmarkFolderRequest | null>(null);
  const sourceRef = useRef<BookmarkSource | null>(null);
  const cacheRef = useRef<BookmarkCache | null>(null);
  const bridgeRef = useRef<BookmarkPreferenceBridge | null>(null);
  const preferencesRef = useRef<BookmarkPreferences>(initialPreferences);
  const activeRef = useRef(true);
  /** 是否允许把读到的整棵树暴露给界面：关闭/撤销后迟到的读取必须被丢弃。 */
  const treeVisibleRef = useRef(false);
  const busyRef = useRef(false);
  /** 启用尝试的代数：关闭功能或重新发起启用都会让旧授权结果失效。 */
  const enableToken = useRef(0);
  /** 在途启用所持有的代数；读取完成时若已失效，完整树不得进入界面。 */
  const pendingEnableToken = useRef<number | null>(null);
  const folderRequestId = useRef(0);
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  /**
   * 跨页已提交的关闭必须作废本页在途授权：只推进 token 并清掉在途标记，
   * 迟到的 granted 不再持久化，也不会把树重新写回界面。
   */
  const interruptPendingEnable = useCallback(() => {
    enableToken.current += 1;
    pendingEnableToken.current = null;
    treeVisibleRef.current = false;
  }, []);

  useEffect(() => {
    activeRef.current = true;
    let disposed = false;
    const recordTree = (next: NormalizedBookmarkTree) => {
      if (disposed || !activeRef.current || !treeVisibleRef.current) return;
      // 在途启用已被关闭/取代时，即使授权后读取完成，也不得把树重新写回界面。
      if (pendingEnableToken.current !== null && pendingEnableToken.current !== enableToken.current) return;
      setTree(next);
    };
    const cache = createTrackedCache(recordTree);
    const source = createBookmarkSource({
      platform: createPlatform(recordTree),
      cache,
      initial: {
        enabled: initial.current.enabled,
        mode: initial.current.mode,
        hiddenRules: toRuleInput(initial.current),
      },
    });
    sourceRef.current = source;
    cacheRef.current = cache;
    treeVisibleRef.current = initial.current.enabled;
    setSnapshot(source.getSnapshot());
    const unsubscribe = source.subscribe((next) => {
      if (disposed) return;
      // 只有功能启用且未关闭/撤销/失败时才接受树写回；迟到结果不能把旧树重新显示出来。
      treeVisibleRef.current = next.enabled && next.status !== 'disabled' && next.status !== 'permission-missing'
        && next.status !== 'unsupported' && next.status !== 'error';
      setSnapshot(next);
      if (!treeVisibleRef.current) setTree(null);
    });
    void source.initialize().catch((cause: unknown) => {
      if (!disposed) setActionError(errorMessage(cause));
    });
    return () => {
      disposed = true;
      activeRef.current = false;
      treeVisibleRef.current = false;
      unsubscribe();
      source.dispose();
      if (sourceRef.current === source) sourceRef.current = null;
      if (cacheRef.current === cache) cacheRef.current = null;
    };
  }, []);

  // 设置或同步改变书签偏好后重新应用；值未变化时不触碰数据源，也绝不重建数据源。
  // 观察器给出过权威值后，本页设置快照不再回退 canonical（避免无关重渲染带回旧值）。
  useEffect(() => {
    bridgeRef.current?.acceptFromSettings(data.settings.bookmarks);
  }, [data.settings.bookmarks]);

  // 跨页偏好观察：只读既有 settings 行；页面卸载时退订。
  useEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    const bridge = connectBookmarkPreferences({
      subscribe: data.subscribeBookmarkPreferences,
      source,
      initial: preferencesRef.current,
      onChange: (next) => {
        if (!activeRef.current) return;
        preferencesRef.current = next;
        setPreferences(next);
      },
      interruptEnable: () => {
        if (!activeRef.current) return;
        interruptPendingEnable();
      },
      onError: (cause) => {
        if (activeRef.current) setActionError(errorMessage(cause));
      },
    });
    bridgeRef.current = bridge;
    return () => {
      if (bridgeRef.current === bridge) bridgeRef.current = null;
      bridge.dispose();
    };
  }, [data.subscribeBookmarkPreferences, interruptPendingEnable]);

  const run = useCallback((task: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    const settle = () => {
      busyRef.current = false;
      if (activeRef.current) setBusy(false);
    };
    const fail = (cause: unknown) => {
      if (activeRef.current) setActionError(errorMessage(cause));
    };
    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(task());
    } catch (cause) {
      fail(cause);
      settle();
      return;
    }
    void pending.catch(fail).finally(settle);
  }, []);

  const requestEnable = useCallback(() => {
    if (busyRef.current) return;
    const source = sourceRef.current;
    if (!source) return;
    const token = ++enableToken.current;
    pendingEnableToken.current = token;
    run(async () => {
      // enableFromGesture 在任何 await 之前同步发起 permissions.request，
      // 因此这里必须直接调用它，不能把权限请求延后到 effect 或微任务。
      const permission = await source.enableFromGesture();
      const stillCurrent = sourceRef.current === source && token === enableToken.current;
      if (pendingEnableToken.current === token) pendingEnableToken.current = null;
      if (!stillCurrent) {
        // 等待期间用户关闭了功能（或会话已结束）：本次授权结果作废，绝不再打开投影。
        if (sourceRef.current === source) await source.disable();
        return;
      }
      // 请求期间可能发生权限撤销/关闭：此时数据源虽然返回原始 `granted`，
      // 但不会进入启用状态。只有数据源确实已启用才允许持久化意图。
      if (permission !== 'granted' || !enableAttemptSucceeded(source.getSnapshot())) return;
      try {
        await dataRef.current.updateBookmarkPreferences({ enabled: true });
      } catch (cause) {
        // 意图没有持久化成功时，运行时也回到关闭，避免刷新前后表现不一致。
        await source.disable();
        throw cause;
      }
    });
  }, [run]);

  const disable = useCallback(() => {
    const source = sourceRef.current;
    if (!source) return;
    // 关闭必须打断在途授权：推进代数，迟到的 granted 不会再被持久化或重新打开投影。
    enableToken.current += 1;
    treeVisibleRef.current = false;
    setTree(null);
    setActionError(null);
    // 不走 run() 的 busy 门控：否则在启用请求进行中点击关闭会被静默吞掉。
    void source.disable().catch((cause: unknown) => {
      if (activeRef.current) setActionError(errorMessage(cause));
    });
    void dataRef.current.updateBookmarkPreferences({ enabled: false }).catch((cause: unknown) => {
      if (activeRef.current) setActionError(errorMessage(cause));
    });
  }, []);

  const retry = useCallback(() => {
    const source = sourceRef.current;
    if (!source) return;
    run(() => source.refresh());
  }, [run]);

  const updateMode = useCallback((mode: BookmarkPreferences['mode']) => {
    run(async () => {
      await dataRef.current.updateBookmarkPreferences({ mode });
    });
  }, [run]);

  const updateSearch = useCallback((showInSearch: boolean) => {
    run(async () => {
      await dataRef.current.updateBookmarkPreferences({ showInSearch });
    });
  }, [run]);

  const setRegionVisible = useCallback((visible: boolean) => {
    run(async () => {
      const hidden = dataRef.current.settings.layout.hidden;
      const nextHidden: SlotId[] = visible
        ? hidden.filter((slot) => slot !== 'bookmarks')
        : [...hidden, 'bookmarks'];
      await dataRef.current.updateLayout({ hidden: nextHidden });
    });
  }, [run]);

  const setHidden = useCallback((target: BookmarkRuleCandidate, hidden: boolean, ruleId?: string | readonly string[]) => {
    // 一次动作、一次忙锁：同节点的多条规则在这里顺序写入，不能被 busyRef 当成重复点击吞掉。
    run(async () => {
      const ruleIds = resolveHiddenRuleIds(ruleId, newId);
      const result = await applyHiddenRules({
        ruleIds,
        write: (id) => dataRef.current.setBookmarkHiddenRule({
          ruleId: id,
          targetId: target.nodeId,
          path: [...target.path],
          kind: target.kind,
          hidden,
          updatedAt: Date.now(),
        }),
      });
      // 部分成功已经落库，只把剩余失败如实报出来；已完成条目不回滚、不重写。
      if (result.error !== null) throw new Error(result.error);
    });
  }, [run]);

  const bindRule = useCallback((ruleId: string, target: BookmarkRuleCandidate) => {
    run(async () => {
      // 用 canonical 偏好查找规则：data.settings 可能落后于跨页提交。
      const rule = preferencesRef.current.hiddenRules.find((entry) => entry.ruleId === ruleId);
      if (!rule) throw new Error('隐藏规则不存在，无法绑定目标');
      await dataRef.current.setBookmarkHiddenRule({
        ...rule,
        targetId: target.nodeId,
        path: [...target.path],
        kind: target.kind,
        updatedAt: Date.now(),
      });
    });
  }, [run]);

  const deleteRule = useCallback((ruleId: string) => {
    run(async () => {
      await dataRef.current.removeBookmarkHiddenRule(ruleId);
    });
  }, [run]);

  const clearCache = useCallback(() => {
    const cache = cacheRef.current;
    if (!cache) return;
    run(async () => {
      // 0 不推进缓存的最小白名单代次：只删除当前快照，不阻断数据源后续写入。
      await cache.clear(0);
    });
  }, [run]);

  const viewSnapshot = useMemo(() => bookmarkViewSnapshot({
    source: snapshot,
    tree,
    intentEnabled: preferences.enabled,
    preferences,
    // 布局隐藏项始终取当前设置；空数组表示没有任何隐藏区域，不回落到旧值。
    layoutHidden: data.settings.layout.hidden,
    actionError,
    busy,
    folderRequest,
  }), [snapshot, tree, preferences, data.settings.layout.hidden, actionError, busy, folderRequest]);

  const openBookmarkNode = useCallback((node: BookmarkNodeView) => {
    const source = sourceRef.current;
    if (!source) {
      // 数据源已销毁（会话结束）时也必须给出反馈，不能静默失败。
      notifyError(new Error('浏览器收藏夹当前不可用，书签未打开'));
      return;
    }
    const target = dataRef.current.settings.shortcuts.openTarget;
    setActionError(null);
    // 失败经常驻提示条上报：书签区域被布局隐藏时，区域内的 actionError 用户看不到。
    void openBookmarkWithFeedback({
      snapshot: viewSnapshot,
      nodeId: node.nodeId,
      target,
      open: (url, openTarget) => source.open(url, openTarget),
      report: (message) => {
        if (!activeRef.current) return;
        setActionError(message);
        notifyError(new Error(message));
      },
    });
  }, [viewSnapshot]);

  const openFolder = useCallback((nodeId: string) => {
    folderRequestId.current += 1;
    setFolderRequest({ requestId: folderRequestId.current, nodeId });
  }, []);

  const value = useMemo<BookmarkContextValue>(() => ({
    snapshot: viewSnapshot,
    requestEnable,
    disable,
    retry,
    updateMode,
    updateSearch,
    setRegionVisible,
    setHidden,
    bindRule,
    deleteRule,
    clearCache,
    openBookmark: openBookmarkNode,
    openFolder,
  }), [viewSnapshot, requestEnable, disable, retry, updateMode, updateSearch, setRegionVisible, setHidden, bindRule,
    deleteRule, clearCache, openBookmarkNode, openFolder]);

  return <BookmarkContextProvider value={value}>{children}</BookmarkContextProvider>;
}

/**
 * 浏览器收藏夹提供方。
 *
 * 数据未就绪时仍挂载上下文（关闭空状态），这样 SettingsPanel 等必须接线的消费者不会抛错；
 * 就绪后创建数据源，并在整个页面会话内只创建一次。
 */
export function BookmarkFeatureProvider({ children }: { readonly children: ReactNode }) {
  const { status, settings } = useData();
  if (status !== 'ready') {
    return <BookmarkContextProvider value={INACTIVE_CONTEXT}>{children}</BookmarkContextProvider>;
  }
  return <BookmarkFeatureRuntime initialPreferences={settings.bookmarks}>{children}</BookmarkFeatureRuntime>;
}
