export const WEBDAV_HTTP_STATUS = {
  ok: 200,
  created: 201,
  noContent: 204,
  multiStatus: 207,
  redirectMin: 300,
  redirectMax: 400,
  notFound: 404,
  conflict: 409,
  methodNotAllowed: 405,
  preconditionFailed: 412,
  successMin: 200,
} as const;

const NUTSTORE_ANCESTORS_NOT_FOUND = /<(?:[A-Za-z_][\w.-]*:)?exception\b[^>]*>\s*AncestorsNotFound\s*<\/(?:[A-Za-z_][\w.-]*:)?exception\s*>/;

export async function isMissingWebDavDescriptor(response: Response, isNutstore: boolean): Promise<boolean> {
  if (response.status === WEBDAV_HTTP_STATUS.notFound) return true;
  return isNutstore && response.status === WEBDAV_HTTP_STATUS.conflict
    && NUTSTORE_ANCESTORS_NOT_FOUND.test(await response.text());
}
