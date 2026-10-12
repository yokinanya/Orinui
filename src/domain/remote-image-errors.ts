export class RedirectConfirmationRequiredError extends Error {
  override readonly name = 'RedirectConfirmationRequiredError';

  constructor(
    readonly sourceUrl: string,
    readonly targetUrl: string,
    options?: ErrorOptions,
  ) {
    super('图片跳转到了另一个网站，请确认后再次点击下载。', options);
  }
}

export class RemoteImageRedirectError extends Error {
  override readonly name = 'RemoteImageRedirectError';

  constructor(readonly sourceUrl: string, message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
