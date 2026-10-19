import type { SearchToolContext, SearchToolResults } from '@/domain/search-tool-types';
import type { SearchToolGroup } from '@/domain/search-customization';
import { createToolAction, isEnabled, toolResults } from '@/domain/search-tool-utils';

const GROUP: SearchToolGroup = 'github';
const REPOSITORY = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9_.-]+)$/;
const ISSUE_REFERENCE = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9_.-]+)#(\d+)$/;
type Repo = { readonly owner: string; readonly name: string; readonly path: string };

function action(input: { readonly actionId: string; readonly kind: 'open' | 'copy' | 'error'; readonly label: string; readonly value: string; readonly detail: string }) {
  return createToolAction({ toolId: 'github', group: GROUP, ...input });
}

function explicitError(detail: string): SearchToolResults {
  const item = action({ actionId: 'error', kind: 'error', label: 'GitHub 命令无效', value: '', detail });
  return toolResults([item], true, item.id);
}

function parseRepo(value: string): Repo | null {
  const match = REPOSITORY.exec(value);
  if (!match || match[2] === '.' || match[2] === '..') return null;
  return { owner: match[1]!, name: match[2]!, path: `${match[1]}/${match[2]}` };
}

function splitArgument(value: string): { readonly head: string; readonly tail: string } {
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(value.trim());
  return { head: match?.[1] ?? '', tail: match?.[2]?.trim() ?? '' };
}

function openAction(input: { readonly actionId: string; readonly label: string; readonly url: string }): ReturnType<typeof action> {
  return action({ actionId: input.actionId, kind: 'open', label: input.label, value: input.url, detail: input.url });
}

function repoActions(repo: Repo): SearchToolResults {
  const base = `https://github.com/${repo.path}`;
  const actions = [
    openAction({ actionId: 'open', label: '打开仓库', url: base }),
    openAction({ actionId: 'issues', label: '查看 Issues', url: `${base}/issues` }),
    openAction({ actionId: 'prs', label: '查看 Pull requests', url: `${base}/pulls` }),
    openAction({ actionId: 'releases', label: '查看所有 Releases', url: `${base}/releases` }),
    openAction({ actionId: 'code', label: '在仓库内搜索代码', url: searchUrl('code', '', repo) }),
    action({ actionId: 'clone-https', kind: 'copy', label: '复制 HTTPS clone 命令', value: `git clone ${base}.git`, detail: `git clone ${base}.git` }),
    action({ actionId: 'clone-ssh', kind: 'copy', label: '复制 SSH clone 命令', value: `git clone git@github.com:${repo.path}.git`, detail: `git clone git@github.com:${repo.path}.git` }),
  ];
  return toolResults(actions, true, actions[0]!.id);
}

function issueAction(input: string): SearchToolResults | null {
  const match = ISSUE_REFERENCE.exec(input);
  if (!match) return null;
  if (!parseRepo(`${match[1]}/${match[2]}`)) return null;
  if (!Number.isSafeInteger(Number(match[3])) || Number(match[3]) < 1) return null;
  const repo = `${match[1]}/${match[2]}`;
  const item = openAction({ actionId: 'number', label: '打开 GitHub Issue 或 PR',
    url: `https://github.com/${repo}/issues/${match[3]}` });
  return toolResults([item], true, item.id);
}

function searchUrl(type: 'code' | 'issues' | 'prs' | 'repositories', query: string, repo?: Repo): string {
  const qualifier = repo ? `repo:${repo.path}${query ? ` ${query}` : ''}` : query;
  const resultType = type === 'issues' ? 'issues' : type === 'prs' ? 'pullrequests' : type;
  const params = new URLSearchParams({ q: qualifier, type: resultType });
  return `https://github.com/search?${params.toString()}`;
}

function searchAction(type: 'code' | 'issues' | 'prs' | 'repositories', args: string): SearchToolResults {
  const url = searchUrl(type, args.trim());
  const item = openAction({ actionId: `search-${type}`, label: `搜索 GitHub ${type}`, url });
  return toolResults([item], true, item.id);
}

function repositoryScopedAction(type: 'code' | 'issues' | 'prs', args: string): SearchToolResults {
  const { head, tail: query } = splitArgument(args);
  const repo = parseRepo(head);
  if (!repo) return explicitError(`用法：gh ${type} owner/repo [关键词]`);
  if (!query) return explicitError(`用法：gh code owner/repo 关键词`);
  const url = searchUrl(type, query, repo);
  const item = openAction({ actionId: `search-${type}`, label: `搜索仓库 ${repo.path} 的 ${type}`, url });
  return toolResults([item], true, item.id);
}

function commandActions(command: string, args: string): SearchToolResults | null {
  if (command === 'search') return args.trim() ? searchAction('repositories', args) : explicitError('用法：gh search 关键词');
  if (command === 'code') return repositoryScopedAction(command, args);
  if (command === 'issues' || command === 'prs') return repositoryListAction(command, args);
  if (command === 'releases') return releasesAction(args);
  if (command === 'clone') return cloneAction(args);
  return null;
}

function repositoryListAction(command: 'issues' | 'prs', args: string): SearchToolResults {
  const { head, tail: query } = splitArgument(args);
  const repo = parseRepo(head);
  if (!repo) return explicitError(`用法：gh ${command} owner/repo [关键词]`);
  if (!query) {
    const url = `https://github.com/${repo.path}/${command === 'issues' ? 'issues' : 'pulls'}`;
    return toolResults([openAction({ actionId: `list-${command}`, label: `打开仓库 ${repo.path} 的 ${command}`, url })], true, `github:list-${command}`);
  }
  const constraint = command === 'issues' ? 'is:issue' : 'is:pr';
  const item = openAction({ actionId: `search-${command}`, label: `搜索仓库 ${repo.path} 的 ${command}`,
    url: searchUrl(command, `repo:${repo.path} ${constraint} ${query}`) });
  return toolResults([item], true, item.id);
}

function releasesAction(args: string): SearchToolResults {
  const [repository, ...rest] = args.trim().split(/\s+/);
  const repo = parseRepo(repository ?? '');
  if (!repo || rest.length > 0) return explicitError('用法：gh releases owner/repo');
  const url = `https://github.com/${repo.path}/releases`;
  const item = openAction({ actionId: 'releases', label: '查看所有 Releases', url });
  return toolResults([item], true, item.id);
}

function cloneActions(repo: Repo): ReturnType<typeof action>[] {
  const https = `git clone https://github.com/${repo.path}.git`;
  const ssh = `git clone git@github.com:${repo.path}.git`;
  return [
    action({ actionId: 'clone-https', kind: 'copy', label: '复制 HTTPS clone 命令', value: https, detail: https }),
    action({ actionId: 'clone-ssh', kind: 'copy', label: '复制 SSH clone 命令', value: ssh, detail: ssh }),
  ];
}

function cloneAction(args: string): SearchToolResults {
  const repo = parseRepo(args.trim());
  if (!repo) return explicitError('用法：gh clone owner/repo');
  const actions = cloneActions(repo);
  return toolResults(actions, true, actions[0]!.id);
}

export function parseGitHubTool(
  query: string,
  context: SearchToolContext,
  enabled: readonly SearchToolGroup[],
): SearchToolResults | null {
  void context;
  const match = /^gh(?:\s+(.*))?$/i.exec(query.trim());
  if (!match) return null;
  if (!isEnabled(GROUP, enabled)) return explicitError('GitHub 快捷工具已关闭');
  const input = (match[1] ?? '').trim();
  if (!input || /^help$/i.test(input)) return helpResults();
  return parseArguments(input);
}

function parseArguments(input: string): SearchToolResults {
  const { head, tail: args } = splitArgument(input);
  const command = head.toLocaleLowerCase();
  const issue = issueAction(head);
  if (issue && !args) return issue;
  const repo = parseRepo(head);
  if (repo && !args) return repoActions(repo);
  return commandActions(command, args) ?? explicitError(`不支持的 GitHub 命令：${head}`);
}

function helpResults(): SearchToolResults {
  const examples = ['gh owner/repo', 'gh owner/repo#123', 'gh search react', 'gh code owner/repo auth token',
    'gh issues owner/repo state:open bug', 'gh prs owner/repo review:none', 'gh releases owner/repo',
    'gh clone owner/repo'];
  const actions = examples.map((example, index) => createToolAction({ toolId: 'github', group: GROUP,
    actionId: `example-${index + 1}`, kind: 'fill', label: example, value: example, detail: example }));
  return toolResults(actions, true, actions[0]!.id);
}
