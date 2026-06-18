import { createApiKeyExchangeHandler } from '@pymthouse/builder-sdk/signer/server';

import { readApiKeyExchangeConfig } from '@/lib/pymthouse-signer-exchange-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const config = readApiKeyExchangeConfig();
  if (!config) {
    return Response.json(
      {
        error: 'server_misconfigured',
        error_description:
          'PYMTHOUSE_ISSUER_URL, PYMTHOUSE_PUBLIC_CLIENT_ID, PYMTHOUSE_M2M_CLIENT_ID, and PYMTHOUSE_M2M_CLIENT_SECRET are required',
      },
      { status: 503 },
    );
  }

  const handler = createApiKeyExchangeHandler(config);
  return handler(request);
}
