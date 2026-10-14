export const WEBDAV_TEMPLATES = [
  {
    id: 'jianguoyun',
    label: '坚果云',
    url: 'https://dav.jianguoyun.com/dav/',
    urlPlaceholder: 'https://dav.jianguoyun.com/dav/',
    usernamePlaceholder: '坚果云账号邮箱',
    passwordLabel: '应用密码',
    consistencyMode: 'readback-only',
    instructions: '账号填邮箱，密码填「安全选项」中生成的应用密码；同步文件保存在 Orinui 文件夹中。',
    helpUrl: 'https://help.jianguoyun.com/?p=2064',
  },
  {
    id: 'koofr',
    label: 'Koofr',
    url: 'https://app.koofr.net/dav/Koofr/',
    urlPlaceholder: 'https://app.koofr.net/dav/Koofr/',
    usernamePlaceholder: 'Koofr 账号邮箱',
    passwordLabel: '应用密码',
    consistencyMode: 'strong-etag',
    instructions: '账号填邮箱，密码使用为 Orinui 生成的应用密码。',
    helpUrl: 'https://koofr.eu/help/koofr_with_webdav/how-do-i-connect-a-service-to-koofr-through-webdav/',
  },
  {
    id: 'nextcloud',
    label: 'Nextcloud',
    url: '',
    urlPlaceholder: 'https://cloud.example.com/remote.php/dav/files/用户名/',
    usernamePlaceholder: 'Nextcloud 用户名',
    passwordLabel: '应用密码',
    consistencyMode: 'strong-etag',
    instructions: '从文件设置复制 WebDAV 地址，并在个人设置的「安全」中生成应用密码。',
    helpUrl: 'https://docs.nextcloud.com/server/stable/user_manual/en/files/access_webdav.html',
  },
  {
    id: 'custom',
    label: '自定义',
    url: '',
    urlPlaceholder: 'https://dav.example.com/orinui/',
    usernamePlaceholder: 'WebDAV 账号',
    passwordLabel: '密码 / 应用密码',
    consistencyMode: 'strong-etag',
    instructions: '',
    helpUrl: null,
  },
] as const;

export type WebDavTemplate = (typeof WEBDAV_TEMPLATES)[number];

export function getWebDavTemplate(id: string): WebDavTemplate {
  const template = WEBDAV_TEMPLATES.find((value) => value.id === id);
  if (!template) throw new Error('未知的 WebDAV 服务模板');
  return template;
}
