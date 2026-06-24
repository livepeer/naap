import { createDeviceExchangeHandler } from '@pymthouse/builder-sdk/signer/server';

import { readDeviceExchangeConfig } from '@/lib/pymthouse-signer-exchange-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const config = readDeviceExchangeConfig();
  if (!config) {
    return Response.json(
      {
        error: 'server_misconfigured',
        error_description:
          'PYMTHOUSE_ISSUER_URL, PYMTHOUSE_M2M_CLIENT_ID, and PYMTHOUSE_M2M_CLIENT_SECRET are required',
      },
      { status: 503 },
    );
  }

  const handler = createDeviceExchangeHandler(config);
  return handler(request);
}
