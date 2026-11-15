import { EyeIcon, EyeOffIcon, FolderIcon, ShieldAlertIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { BookmarkHiddenRule, BookmarkRuleKind } from '@/domain/bookmark-preferences';
import {
  bookmarkDisplayName, bookmarkPathText, type BookmarkContextValue, type BookmarkNodeView,
  type BookmarkRootView, type BookmarkRuleMatch,
} from '@/features/bookmarks/bookmark-view';

export interface TreeRow {
  readonly nodeId: string;
  readonly title: string;
  readonly path: readonly string[];
  readonly kind: BookmarkRuleKind;
  readonly depth: number;
  /**
   * 本行节点命中的**全部**规则（按本机匹配结果，ID 优先、路径回退）。
   *
   * 同一节点可能被跨设备合并出多条规则；隐藏与否必须由这些规则的真实 `hidden`
   * 派生，而不是只挑最新一条，否则会出现「内容已隐藏但按钮写隐藏、且永远无法恢复」。
   */
  readonly rules: readonly ActiveRule[];
  /** 本行自身的规则是否隐藏（不含祖先覆盖）。 */
  readonly hidden: boolean;
  /** 自身或祖先被隐藏；用于标注「跟随父级隐藏」。 */
  readonly coveredByAncestor: boolean;
}

export interface ActiveRule {
  readonly rule: BookmarkHiddenRule;
  /** 命中方式是 ID 还是路径回退；用于在界面说明「已按路径重新匹配」。 */
  readonly matchedByPath: boolean;
}

function matchedByPath(rule: BookmarkHiddenRule, nodeId: string): boolean {
  return rule.targetId !== nodeId;
}

/**
 * 列出命中某节点的全部规则。
 *
 * 只认 `status === 'matched'` 且命中的节点就是本行节点的规则；`ambiguous` 与
 * `unmatched` 不生效，规则保留在待处理列表，不猜测目标。顺序按 `ruleId` 稳定排列，
 * 便于逐条取消时结果可复现。
 */
export function activeRulesForNode(
  rules: readonly BookmarkHiddenRule[],
  matches: readonly BookmarkRuleMatch[],
  nodeId: string,
): readonly ActiveRule[] {
  return matches
    .filter((match) => match.status === 'matched' && match.nodeId === nodeId)
    .flatMap((match) => {
      const rule = rules.find((entry) => entry.ruleId === match.ruleId);
      return rule ? [{ rule, matchedByPath: matchedByPath(rule, nodeId) }] : [];
    })
    .toSorted((left, right) => (left.rule.ruleId < right.rule.ruleId
      ? -1
      : Number(left.rule.ruleId !== right.rule.ruleId)));
}

/**
 * 本行自身规则是否处于隐藏。
 *
 * 领域层对任一命中的 `hidden: true` 规则都会隐藏该节点（LWW 只逐条更新），因此这里
 * 必须「任一为 true 即隐藏」；一条 `false` 只取消它自己，不代表整节点可见。
 */
export function rulesHideNode(active: readonly ActiveRule[]): boolean {
  return active.some((entry) => entry.rule.hidden);
}

/** 需要逐条取消隐藏的规则：命中的 `hidden: true` 规则。 */
export function rulesToUnhide(active: readonly ActiveRule[]): readonly ActiveRule[] {
  return active.filter((entry) => entry.rule.hidden);
}

/**
 * 构造 `setHidden` 的第三参数（纯函数，便于断言）。
 *
 * - 没有可取消的规则 → `undefined`（隐藏动作按目标新建规则）。
 * - 只有一条 → 传单条 `ruleId`，兼容只支持单条的既有实现。
 * - 多条 → 一次传回**全部** ID；提供方在单次调用内逐条独立写入。
 *   不要改成循环调用，忙锁会吞掉除第一条以外的写入。
 */
export function hiddenRuleIdsArg(active: readonly ActiveRule[]): string | readonly string[] | undefined {
  const ids = rulesToUnhide(active).map((entry) => entry.rule.ruleId);
  if (ids.length === 0) return undefined;
  return ids.length === 1 ? (ids[0] as string) : ids;
}

/**
 * 单条命中的规则，仅供「已按路径重新匹配」标注使用。
 *
 * **不要**用它推导行是否隐藏——同一节点可能命中多条规则；状态请用
 * `activeRulesForNode` + `rulesHideNode`。
 */
function activeRuleForNode(
  rules: readonly BookmarkHiddenRule[],
  matches: readonly BookmarkRuleMatch[],
  nodeId: string,
): ActiveRule | null {
  const candidates = activeRulesForNode(rules, matches, nodeId);
  const sorted = [...candidates].toSorted((left, right) =>
    right.rule.updatedAt - left.rule.updatedAt
    || (left.rule.ruleId < right.rule.ruleId ? -1 : Number(left.rule.ruleId !== right.rule.ruleId)));
  return sorted[0] ?? null;
}

/** 导出供 UI 测试直接断言「按匹配结果而不是原始 targetId 取规则」。 */
export { activeRuleForNode };

/**
 * 收集隐藏管理器要展示的全部行（根 + 全部文件夹）。
 *
 * 显式栈 DFS：先压入待访问项，再按浏览器顺序展开，**不使用函数自身递归**，
 * 因此深层合法树（5000 层）不会爆调用栈。顺序与深度优先递归完全一致：
 * 根行 → 该根的子文件夹及其子树 → 下一个根行…… `coveredByAncestor` 在压栈时
 * 由父项的隐藏状态派生，不依赖调用栈。
 */
export function collectBookmarkTreeRows(input: {
  readonly roots: readonly BookmarkRootView[];
  readonly rules: readonly BookmarkHiddenRule[];
  readonly matches: readonly BookmarkRuleMatch[];
  readonly hiddenIds: ReadonlySet<string>;
}): TreeRow[] {
  const rows: TreeRow[] = [];
  type Task =
    | { readonly type: 'root'; readonly root: BookmarkRootView }
    | { readonly type: 'node'; readonly node: BookmarkNodeView; readonly depth: number; readonly ancestorHidden: boolean };
  const stack: Task[] = [];
  // 逆序压入根，弹出时仍是浏览器原始根顺序。
  for (let index = input.roots.length - 1; index >= 0; index -= 1) {
    const root = input.roots[index];
    if (root) stack.push({ type: 'root', root });
  }

  while (stack.length > 0) {
    const task = stack.pop();
    if (!task) continue;
    if (task.type === 'root') {
      const { root } = task;
      const active = activeRulesForNode(input.rules, input.matches, root.nodeId);
      rows.push({
        nodeId: root.nodeId,
        title: root.title.trim() || '未命名收藏夹根',
        path: root.path,
        kind: 'root',
        depth: 0,
        rules: active,
        hidden: rulesHideNode(active),
        coveredByAncestor: false,
      });
      const rootHidden = input.hiddenIds.has(root.nodeId);
      // 逆序压入子项：弹出顺序 = 浏览器顺序，且子树先于下一个根。
      for (let childIndex = root.children.length - 1; childIndex >= 0; childIndex -= 1) {
        const child = root.children[childIndex];
        if (child) stack.push({ type: 'node', node: child, depth: 1, ancestorHidden: rootHidden });
      }
      continue;
    }

    const { node } = task;
    if (node.kind !== 'folder') continue;
    const active = activeRulesForNode(input.rules, input.matches, node.nodeId);
    rows.push({
      nodeId: node.nodeId,
      title: bookmarkDisplayName(node),
      path: node.path,
      kind: 'folder',
      depth: task.depth,
      rules: active,
      hidden: rulesHideNode(active),
      coveredByAncestor: task.ancestorHidden,
    });
    const childAncestorHidden = task.ancestorHidden || input.hiddenIds.has(node.nodeId);
    for (let childIndex = node.children.length - 1; childIndex >= 0; childIndex -= 1) {
      const child = node.children[childIndex];
      if (child) {
        stack.push({
          type: 'node', node: child, depth: task.depth + 1, ancestorHidden: childAncestorHidden,
        });
      }
    }
  }
  return rows;
}

function ruleMatchFor(match: readonly BookmarkRuleMatch[], ruleId: string): BookmarkRuleMatch | null {
  return match.find((entry) => entry.ruleId === ruleId) ?? null;
}

function candidateLabel(path: readonly string[]): string {
  const trimmed = path.map((segment) => segment.trim()).filter((segment) => segment !== '');
  return trimmed.length > 0 ? trimmed.join(' / ') : '路径未知（标题为空）';
}

function RuleCard({ rule, match, busy, onBind, onDelete }: {
  readonly rule: BookmarkHiddenRule;
  readonly match: BookmarkRuleMatch | null;
  /** 提供方正忙：禁用会写库的按钮，避免快速点击被忙锁静默吞掉。 */
  readonly busy: boolean;
  readonly onBind: (ruleId: string, nodeId: string) => void;
  readonly onDelete: (ruleId: string) => void;
}) {
  const groupName = useId();
  const [selected, setSelected] = useState<string>('');
  const candidates = match?.candidates ?? [];
  const status = match?.status ?? 'unmatched';
  const canBind = selected !== '' && candidates.some((candidate) => candidate.nodeId === selected);
  return (
    <article aria-labelledby={`${groupName}-title`} className="rounded-xl border border-border/60 bg-background/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h5 id={`${groupName}-title`} className="m-0 truncate text-sm font-medium">
            {rule.path[rule.path.length - 1]?.trim() || '未命名目标'}
          </h5>
          <p className="m-0 mt-0.5 break-words text-xs text-muted-foreground">{candidateLabel(rule.path)}</p>
        </div>
        <span className="rounded border border-amber-600/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-800 dark:text-amber-300">
          {status === 'ambiguous' ? '路径有歧义' : '未找到节点'}
        </span>
      </div>
      {status === 'ambiguous' && candidates.length > 0 && (
        <fieldset className="mt-3 flex min-w-0 flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 text-xs font-medium">选择要隐藏的目标</legend>
          <div role="radiogroup" aria-labelledby={`${groupName}-title`} className="flex flex-col gap-1.5">
            {candidates.map((candidate, index) => {
              const id = `${groupName}-candidate-${index}`;
              return (
                <label key={`${candidate.nodeId}:${index}`} htmlFor={id}
                  className="flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border border-border/60 bg-background/60 p-2 text-xs has-checked:border-primary/60 has-checked:bg-primary/5">
                  <input id={id} type="radio" name={groupName} value={candidate.nodeId}
                    checked={selected === candidate.nodeId}
                    onChange={() => setSelected(candidate.nodeId)}
                    className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2" />
                  <span className="min-w-0 break-words">{candidateLabel(candidate.path)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {status === 'ambiguous' && (
          <Button type="button" size="sm" disabled={!canBind || busy}
            onClick={() => { if (canBind && !busy) onBind(rule.ruleId, selected); }}>
            绑定所选目标
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" disabled={busy}
          onClick={() => { if (!busy) onDelete(rule.ruleId); }}>
          删除规则
        </Button>
      </div>
      <p className="m-0 mt-2 text-xs text-muted-foreground">
        {status === 'ambiguous'
          ? '未指定前不会隐藏任何内容；规则会保留。'
          : '浏览器里没有唯一命中，规则保留但不会隐藏内容；可删除后重新创建。'}
      </p>
    </article>
  );
}

/**
 * 完整浏览器收藏夹树与隐藏规则管理。
 *
 * 只列出浏览器根与普通文件夹：单条书签不可隐藏。树按浏览器顺序完整展开，
 * 被隐藏的节点和空文件夹仍然列出，便于恢复或确认。规则按 `ruleId` 操作；
 * 歧义/无匹配的规则显示候选或删除入口，不猜测目标、不静默删除。
 */
export function BookmarkTreeManager({ bookmarks }: { readonly bookmarks: BookmarkContextValue }) {
  const { snapshot } = bookmarks;
  const [showAll, setShowAll] = useState(false);
  // 逐条取消失败时显式保留在界面上，不伪造「已全部恢复」。
  const [actionFailure, setActionFailure] = useState<string | null>(null);
  const hiddenIds = useMemo(() => new Set(snapshot.hiddenNodeIds), [snapshot.hiddenNodeIds]);
  const rows = useMemo(() => collectBookmarkTreeRows({
    roots: snapshot.roots,
    rules: snapshot.hiddenRules,
    matches: snapshot.ruleMatches,
    hiddenIds,
  }), [snapshot.roots, snapshot.hiddenRules, snapshot.ruleMatches, hiddenIds]);
  const pending = snapshot.hiddenRules
    .map((rule) => ({ rule, match: ruleMatchFor(snapshot.ruleMatches, rule.ruleId) }))
    .filter(({ match }) => match?.status !== 'matched' || !match.nodeId);
  const visibleRows = showAll ? rows : rows.slice(0, 300);
  const truncated = visibleRows.length < rows.length;

  const toggleHidden = (row: TreeRow) => {
    const target = { nodeId: row.nodeId, path: row.path, kind: row.kind };
    // 同一节点可能被多条规则同时隐藏（跨设备合并后的合法状态）。
    // 恢复显示必须一次调用提交**全部**命中的 `hidden: true` 规则 ID：
    // 提供方在单次调用内逐条独立写入，循环调用会被忙锁吞掉，只剩第一条生效。
    try {
      bookmarks.setHidden(target, !row.hidden, row.hidden ? hiddenRuleIdsArg(row.rules) : undefined);
      setActionFailure(null);
    } catch (error) {
      setActionFailure(`切换「${row.title}」的显示状态失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const bindRule = (ruleId: string, nodeId: string) => {
    const match = ruleMatchFor(snapshot.ruleMatches, ruleId);
    const candidate = match?.candidates.find((entry) => entry.nodeId === nodeId);
    if (candidate) bookmarks.bindRule(ruleId, candidate);
  };

  if (!snapshot.enabled) {
    return <p className="m-0 text-sm text-muted-foreground">启用后可在这里管理隐藏的根与文件夹；单条书签不可隐藏。</p>;
  }

  if (snapshot.status === 'unsupported') {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        当前浏览器没有提供书签接口，因此没有可管理的树。这不是空收藏夹，也没有可重试的读取。
      </p>
    );
  }

  if (snapshot.permission !== 'granted') {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        本机尚未授权读取收藏夹，因此没有可管理的树。授权后会按浏览器内容显示根与文件夹；
        可在上方「重新允许读取收藏夹」直接授权。
      </p>
    );
  }

  if (snapshot.status === 'loading') {
    return <p role="status" className="m-0 text-sm text-muted-foreground">正在读取浏览器收藏夹，完成后才能管理隐藏的根与文件夹。</p>;
  }

  if (snapshot.status === 'importing') {
    return <p role="status" className="m-0 text-sm text-muted-foreground">浏览器正在导入收藏夹，完成后才能管理隐藏的根与文件夹。</p>;
  }

  if (snapshot.status === 'error' && snapshot.roots.length === 0) {
    return (
      <p role="alert" className="m-0 text-sm text-muted-foreground">
        本次读取失败，暂时没有可管理的树。这不是空收藏夹；
        {snapshot.error ? `原因：${snapshot.error}。` : '可在上方重新读取。'}
      </p>
    );
  }

  if (snapshot.roots.length === 0) {
    return (
      <p className="m-0 text-sm text-muted-foreground">
        浏览器的收藏夹树为空，暂无可管理的根与文件夹。这里不会显示示例数据，也不会提供新建入口。
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ul aria-label="浏览器收藏夹显示管理" className="m-0 flex list-none flex-col overflow-hidden rounded-xl border border-border/60 bg-background/50 p-0">
        {visibleRows.map((row) => {
          const hidden = row.hidden;
          const covered = row.coveredByAncestor;
          const pathRematch = row.rules.find((entry) => entry.matchedByPath) !== undefined;
          return (
            <li key={`${row.nodeId}:${row.path.join('\u0000')}`}
              className="flex min-h-14 items-center gap-2 border-b border-border/40 px-3 py-2 last:border-b-0"
              style={{ paddingLeft: `${0.75 + row.depth * 1.1}rem` }}>
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/60">
                <FolderIcon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{row.title}</span>
                <span className="block truncate text-xs text-muted-foreground" title={bookmarkPathText(row.path)}>
                  {bookmarkPathText(row.path)}
                  {pathRematch && ' · 已按路径重新匹配'}
                  {row.rules.length > 1 && ` · ${row.rules.length} 条规则`}
                  {covered && ' · 跟随父级隐藏'}
                </span>
              </span>
              <Button type="button" variant={hidden ? 'secondary' : 'ghost'} size="icon-sm"
                aria-pressed={hidden}
                disabled={snapshot.busy}
                aria-label={hidden
                  ? `恢复显示${row.title}及其全部后代`
                  : `隐藏${row.title}及其全部后代`}
                title={hidden ? '恢复显示' : '隐藏此根或文件夹'}
                onClick={() => { if (!snapshot.busy) toggleHidden(row); }}>
                {hidden ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
              </Button>
            </li>
          );
        })}
      </ul>
      {truncated && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setShowAll(true)}>
          显示全部（剩余 {rows.length - visibleRows.length} 项）
        </Button>
      )}
      <p className="m-0 flex items-start gap-1.5 text-xs text-muted-foreground">
        <ShieldAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        隐藏只作用于浏览器根与普通文件夹，并递归覆盖后代；不会修改浏览器书签，也不会产生占位。
      </p>
      {actionFailure && <p role="alert" className="m-0 text-xs text-destructive">{actionFailure}</p>}

      <section aria-label="待处理隐藏规则" className="flex flex-col gap-2">
        <div>
          <h4 className="m-0 text-sm font-medium">待处理规则</h4>
          <p className="m-0 mt-0.5 text-xs text-muted-foreground">
            浏览器节点 ID 未命中，且路径不唯一或已不存在。规则仍保留，未指定前不会隐藏任何内容。
          </p>
        </div>
        {pending.length === 0
          ? <p className="m-0 text-xs text-muted-foreground">当前没有待处理规则。</p>
          : (
            <div className="flex flex-col gap-2">
              <p role="alert" className="m-0 flex items-start gap-1.5 rounded-lg border border-amber-600/40 bg-amber-500/10 p-2 text-xs">
                <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                {pending.length} 条规则待确认。
              </p>
              {pending.map(({ rule, match }) => (
                <RuleCard key={rule.ruleId} rule={rule} match={match} busy={snapshot.busy}
                  onBind={bindRule} onDelete={(ruleId) => bookmarks.deleteRule(ruleId)} />
              ))}
            </div>
          )}
        <p className="m-0 border-t border-border/40 pt-2 text-xs text-muted-foreground">
          未匹配规则不会自动删除；重新出现时可继续按 ID 或完整路径匹配。也可以显式删除。
        </p>
      </section>
    </div>
  );
}
