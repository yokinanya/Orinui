export class ValidationError extends Error {
  override readonly name = 'ValidationError';
}

/** 领域层校验失败时抛出，调用方负责把消息展示给用户。 */
export function fail(message: string): never {
  throw new ValidationError(message);
}
