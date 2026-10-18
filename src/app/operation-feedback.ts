import type { OperationValue } from '@/app/operations';

const COMMAND_LABELS: Readonly<Record<string, string>> = {
  createShortcut: '新增网站', updateShortcut: '保存网站', deleteShortcut: '删除网站', restoreShortcut: '恢复网站',
  moveShortcut: '移动网站', reorderShortcut: '排序网站', moveShortcutToFolder: '移动网站',
  createFolder: '新增文件夹', renameFolder: '保存文件夹名称', deleteFolder: '删除文件夹', moveFolder: '移动文件夹',
  reorderFolder: '排序文件夹', updateAppearance: '保存外观设置',
  updateLayout: '保存布局设置', resetLayout: '恢复默认布局', updateClockFormat: '保存时间格式',
  updateClockSettings: '保存时钟设置', updateSearchPreferences: '保存搜索设置',
  updateShortcutPreferences: '保存网站显示设置', setDefaultEngine: '切换搜索引擎',
  createSearchEngine: '新增搜索引擎', updateSearchEngine: '保存搜索引擎', deleteSearchEngine: '删除搜索引擎',
  clearImageSourceUrl: '清除图片来源',
};

type UnknownCommand = (...args: unknown[]) => Promise<unknown>;
interface RunCommandInput {
  readonly command: UnknownCommand;
  readonly args: readonly unknown[];
  readonly begin: OperationValue['begin'];
  readonly key: string;
  readonly title: string;
}

export function withOperationFeedback<T extends object>(commands: T, begin: OperationValue['begin']): T {
  const wrapped = { ...commands } as Record<string, unknown>;
  for (const [name, title] of Object.entries(COMMAND_LABELS)) {
    const command = wrapped[name];
    if (typeof command !== 'function') throw new Error(`缺少操作命令：${name}`);
    wrapped[name] = async (...args: unknown[]) => runCommand({ command: command as UnknownCommand, args, begin, key: name, title });
  }
  return wrapped as T;
}

async function runCommand(input: RunCommandInput): Promise<unknown> {
  const task = input.begin(input.title, '保存到本机', `command:${input.key}`);
  try {
    const result = await input.command(...input.args);
    task.succeed('已保存');
    return result;
  } catch (cause) {
    task.fail(cause);
    throw cause;
  }
}
