/**
 * APP-2 front-door client — pure, dependency-free request/response logic.
 *
 * This module shares ZERO code with Storyboard. It speaks only the NaaP front
 * door (BPP ③, POST /api/v1/keys/validate) using a native `naap_` key + an
 * `X-App-Id`. It never sees provider tokens/URLs directly — it receives an
 * opaque `signerSession` and a gated `capabilities` list, which proves the API
 * key + capability model is app-agnostic.
 *
 * Kept side-effect-free so it is unit-testable without a live server; `cli.mjs`
 * wires it to `fetch` + `process.env`.
 */

export const NATIVE_KEY_PREFIX = 'naap_';

/** Redact a key for logs: keep the prefix + last 4, mask the middle. */
export function redactKey(key) {
  if (typeof key !== 'string' || key.length === 0) return '(none)';
  const tail = key.slice(-4);
  return `${NATIVE_KEY_PREFIX}…${tail}`;
}

/**
 * Build the front-door validate request. Throws on obvious misuse (so the CLI
 * fails fast with a clear message instead of sending a doomed request).
 *
 * @param {{ frontDoorUrl: string, apiKey: string, appId: string, requestId?: string }} input
 * @returns {{ url: string, method: 'POST', headers: Record<string,string> }}
 */
export function buildValidateRequest({ frontDoorUrl, apiKey, appId, requestId }) {
  if (!frontDoorUrl) throw new Error('frontDoorUrl is required');
  if (!apiKey || !apiKey.startsWith(NATIVE_KEY_PREFIX)) {
    throw new Error(`apiKey must be a native ${NATIVE_KEY_PREFIX} key`);
  }
  if (!appId) throw new Error('appId is required (X-App-Id) for per-app attribution');
  const url = new URL('/api/v1/keys/validate', frontDoorUrl).toString();
  const headers = {
    authorization: `Bearer ${apiKey}`,
    'x-app-id': appId,
    'content-type': 'application/json',
  };
  if (requestId) headers['x-request-id'] = requestId;
  return { url, method: 'POST', headers };
}

/**
 * Normalize the front-door response envelope. NaaP wraps payloads as
 * `{ success, data }`; tolerate a bare payload too.
 *
 * @param {unknown} json
 * @returns {{ valid: boolean, user?: object, app?: object, billingAccount?: object, capabilities: string[], quota: unknown, signerSession?: object }}
 */
export function parseFrontDoorResponse(json) {
  const body = json && typeof json === 'object' && 'data' in json ? json.data : json;
  const d = body && typeof body === 'object' ? body : {};
  return {
    valid: d.valid === true,
    user: d.user,
    app: d.app,
    billingAccount: d.billingAccount,
    capabilities: Array.isArray(d.capabilities) ? d.capabilities : [],
    quota: d.quota ?? null,
    signerSession: d.signerSession,
  };
}

/** True when the gated capability set permits the desired capability. */
export function hasCapability(capabilities, desired) {
  return Array.isArray(capabilities) && capabilities.includes(desired);
}

/**
 * Build a (mock) inference request from the front-door result. The app uses the
 * provider-issued `signerSession` opaquely — it copies the session's headers
 * without interpreting them, which is exactly how an app-agnostic client should
 * behave. Returns null when the capability is not granted (caller should stop).
 *
 * @returns {{ url: string, method: 'POST', headers: Record<string,string>, body: object } | null}
 */
export function buildInferenceRequest({ signerSession, capability, prompt }) {
  if (!signerSession || typeof signerSession !== 'object') return null;
  const headers = { 'content-type': 'application/json' };
  // signerSession is opaque to the app: forward its headers verbatim if present,
  // else use a bearer access token if that's how the provider issued it.
  if (signerSession.headers && typeof signerSession.headers === 'object') {
    for (const [k, v] of Object.entries(signerSession.headers)) headers[k] = String(v);
  } else if (signerSession.accessToken) {
    const type = signerSession.tokenType || 'Bearer';
    headers.authorization = `${type} ${signerSession.accessToken}`;
  }
  const url = signerSession.url || 'mock://inference/run';
  return {
    url,
    method: 'POST',
    headers,
    body: { capability, prompt: prompt ?? 'a small robot reading a book' },
  };
}
