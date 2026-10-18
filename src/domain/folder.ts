/**
 * 文件夹。
 *
 * 主页网格里文件夹与网站并列占一个格子：点开文件夹在弹层里显示其中的网站，
 * 主页不再有分组标签行，也不支持文件夹嵌套。
 */
export interface Folder {
  id: string;
  name: string;
  order: number;
}
