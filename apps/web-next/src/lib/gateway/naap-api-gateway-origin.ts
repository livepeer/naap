/**
 * Service Gateway `livepeer-naap-api` connector stores upstreamBaseUrl as
 * a full versioned API base (e.g. https://naap-api.livepeer.cloud/v1). Endpoint
 * upstream paths should only include the resource path after /v1.
 */
export function naapApiGatewayOriginFromEnv(): string | null {
  const full = process.env.NAAP_API_SERVER_URL?.trim();
  if (!full) return null;
  return full.replace(/\/+$/, '');
}
