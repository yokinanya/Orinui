import { describe, expect, it } from 'vitest';
import { search } from './search-tools-fixture';

describe('GitHub 快捷命令', () => {
  it('要求 gh 前缀并直达仓库或编号', () => {
    expect(search('owner/repo#123').actions).toEqual([]);
    expect(search('gh owner/repo#123').actions[0]).toMatchObject({
      kind: 'open', label: '打开 GitHub Issue 或 PR', value: 'https://github.com/owner/repo/issues/123',
    });
    expect(search('gh owner/repo').preferredId).toBe('github:open');
    expect(search('gh owner/repo').actions.find(({ id }) => id === 'github:releases')?.value)
      .toBe('https://github.com/owner/repo/releases');
    expect(search('gh owner/repo').actions.find(({ id }) => id === 'github:releases')?.label)
      .toBe('查看所有 Releases');
  });

  it('保留多词搜索、编码与 issues/PR 约束', () => {
    const code = search('gh code owner/repo auth token "hello world"').actions[0]?.value ?? '';
    expect(code).toContain('repo%3Aowner%2Frepo+auth+token+%22hello+world%22');
    expect(search('gh issues owner/repo').actions[0]?.value).toBe('https://github.com/owner/repo/issues');
    expect(search('gh prs owner/repo').actions[0]?.value).toBe('https://github.com/owner/repo/pulls');
    expect(search('gh issues owner/repo state:open bug').actions[0]?.value)
      .toContain('repo%3Aowner%2Frepo+is%3Aissue+state%3Aopen+bug');
    expect(search('gh prs owner/repo state:open review:none').actions[0]?.value)
      .toContain('repo%3Aowner%2Frepo+is%3Apr+state%3Aopen+review%3Anone&type=pullrequests');
    expect(search('gh search owner/repo').actions[0]?.value).toContain('q=owner%2Frepo&type=repositories');
    expect(search('gh code owner/repo').actions[0]?.kind).toBe('error');
  });

  it('拒绝非法仓库、编号和命令，并在关闭时明确报错', () => {
    for (const query of ['gh owner/..', 'gh owner/repo#0x4', 'gh owner/repo#123x', 'gh clone owner/repo extra']) {
      expect(search(query).actions[0]).toMatchObject({ kind: 'error' });
    }
    expect(search('gh unknown x').explicit).toBe(true);
    expect(search('gh owner/repo', []).actions[0]).toMatchObject({ kind: 'error', detail: 'GitHub 快捷工具已关闭' });
  });

  it('clone 默认 HTTPS 并提供完整可复制命令', () => {
    const result = search('gh clone owner/repo');
    expect(result.preferredId).toBe('github:clone-https');
    expect(result.actions.map(({ value, detail }) => [value, detail])).toEqual([
      ['git clone https://github.com/owner/repo.git', 'git clone https://github.com/owner/repo.git'],
      ['git clone git@github.com:owner/repo.git', 'git clone git@github.com:owner/repo.git'],
    ]);
  });
});

it('原样保留引号内空白、筛选表达式和 URL 特殊字符', () => {
  const query = 'label:"good  first issue" (bug OR crash) & 中文';
  const url = new URL(search(`gh issues owner/repo ${query}`).actions[0]!.value);
  expect(url.searchParams.get('q')).toBe(`repo:owner/repo is:issue ${query}`);
  const code = new URL(search('gh code owner/repo "hello  world"').actions[0]!.value);
  expect(code.searchParams.get('q')).toBe('repo:owner/repo "hello  world"');
});
