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
