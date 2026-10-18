import type { S3Credentials } from '@/domain/s3-configuration';
import type { S3ResetTarget } from '@/sync/s3-types';

export class S3RecoveryRequiredError extends Error {
  readonly credentials: S3Credentials;
  readonly target: S3ResetTarget;
  constructor(credentials: S3Credentials, target: S3ResetTarget) {
    super('该 S3 prefix 已有同步库，请输入恢复密钥后重新检查');
    this.name = 'S3RecoveryRequiredError';
    this.credentials = credentials;
    this.target = target;
  }
}
