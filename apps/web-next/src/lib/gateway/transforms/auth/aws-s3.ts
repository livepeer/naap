import type { AuthStrategy, AuthContext } from '../types';
import { signAwsV4 } from '../../aws-sig-v4';

export const awsS3Auth: AuthStrategy = {
  name: 'aws-s3',
  inject(ctx: AuthContext): void {
    const accessKeyRef = (ctx.authConfig.accessKeyRef as string) || 'access_key';
    const secretKeyRef = (ctx.authConfig.secretKeyRef as string) || 'secret_key';
    const accessKey = ctx.secrets[accessKeyRef] || '';
    const secretKey = ctx.secrets[secretKeyRef] || '';
    if (accessKey && secretKey) {
      signAwsV4({
        method: ctx.method,
        url: ctx.url,
        headers: ctx.headers,
        body: ctx.body instanceof ArrayBuffer ? ctx.body : typeof ctx.body === 'string' ? ctx.body : null,
        accessKey,
        secretKey,
        region: (ctx.authConfig.region as string) || 'us-east-1',
        service: (ctx.authConfig.service as string) || 's3',
        signPayload: (ctx.authConfig.signPayload as boolean) ?? false,
      });
    }
  },
};
