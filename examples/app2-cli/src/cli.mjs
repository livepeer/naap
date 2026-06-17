#!/usr/bin/env node
/**
 * APP-2 — runnable CLI entry.
 *
 * A second reference application that uses a native `naap_` key to run an
 * inference job through the NaaP front door. It is independent of Storyboard
 * (shares zero code) and provider-agnostic (works the same whether the team is
 * backed by pymthouse or the stub) — it only ever talks to the NaaP front door.
 *
 * Usage:
 *   NAAP_FRONT_DOOR_URL=https://<naap>  NAAP_API_KEY=naap_...  \
 *   NAAP_APP_ID=naap-sample-cli  CAPABILITY=text-to-image:sdxl \
 *   node src/cli.mjs
 *
 * Structured JSON logs only; the API key is always redacted.
 */

import { randomUUID } from 'node:crypto';
import {
  buildInferenceRequest,
  buildValidateRequest,
  hasCapability,
  parseFrontDoorResponse,
  redactKey,
} from './front-door-client.mjs';

function log(level, event, fields) {
  process.stdout.write(`${JSON.stringify({ level, event, ...fields })}\n`);
}

async function main() {
  const frontDoorUrl = process.env.NAAP_FRONT_DOOR_URL;
  const apiKey = process.env.NAAP_API_KEY;
  const appId = process.env.NAAP_APP_ID || 'naap-sample-cli';
  const capability = process.env.CAPABILITY || 'text-to-image:sdxl';
  const prompt = process.env.PROMPT;
  const requestId = randomUUID();

  log('info', 'app2.start', { appId, capability, requestId, apiKey: redactKey(apiKey) });

  let req;
  try {
    req = buildValidateRequest({ frontDoorUrl, apiKey, appId, requestId });
  } catch (err) {
    log('error', 'app2.config_error', { requestId, message: err.message });
    process.exitCode = 2;
    return;
  }

  let res;
  try {
    res = await fetch(req.url, { method: req.method, headers: req.headers });
  } catch (err) {
    // Independent app: no Storyboard/Daydream fallback — it just reports.
    log('error', 'app2.front_door_unreachable', { requestId, message: String(err?.message ?? err) });
    process.exitCode = 1;
    return;
  }

  if (!res.ok) {
    log('error', 'app2.front_door_rejected', { requestId, status: res.status });
    process.exitCode = 1;
    return;
  }

  const result = parseFrontDoorResponse(await res.json());
  if (!result.valid) {
    log('error', 'app2.key_invalid', { requestId });
    process.exitCode = 1;
    return;
  }

  log('info', 'app2.validated', {
    requestId,
    appId: result.app?.id ?? appId,
    providerSlug: result.billingAccount?.providerSlug,
    capabilityCount: result.capabilities.length,
  });

  if (!hasCapability(result.capabilities, capability)) {
    log('warn', 'app2.capability_denied', { requestId, capability, granted: result.capabilities });
    process.exitCode = 3;
    return;
  }

  const inference = buildInferenceRequest({
    signerSession: result.signerSession,
    capability,
    prompt,
  });
  if (!inference) {
    log('error', 'app2.no_signer_session', { requestId });
    process.exitCode = 1;
    return;
  }

  // Mock "run": a real app would POST `inference` to the signer/inference URL.
  log('info', 'app2.inference_ready', {
    requestId,
    capability,
    target: inference.url,
    usesProviderSession: Boolean(result.signerSession),
  });
  log('info', 'app2.done', { requestId, appId, providerSlug: result.billingAccount?.providerSlug });
}

main().catch((err) => {
  log('error', 'app2.fatal', { message: String(err?.message ?? err) });
  process.exitCode = 1;
});
