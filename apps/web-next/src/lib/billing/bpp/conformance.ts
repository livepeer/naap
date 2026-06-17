/**
 * BPP conformance suite (C0).
 *
 * Validates a provider's payloads against the JSON Schemas in
 * `contracts/billing-provider-protocol/`. Any provider (pymthouse, the stub, or
 * a third party) must pass this. CI runs it so a producer that drifts from the
 * protocol fails before integration.
 *
 * This is test-support code: it reads schema files from disk with ajv and is
 * imported only by `conformance.test.ts` (never by the app runtime).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020, { type ValidateFunction, type ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import type { BppConformanceProvider } from './stub-provider';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root is six levels up from src/lib/billing/bpp/. */
export const CONTRACTS_DIR = path.resolve(
  HERE,
  '../../../../../../contracts/billing-provider-protocol',
);

/** BPP seams the conformance suite exercises against a provider. */
export const BPP_SEAMS = ['validate', 'plans', 'account', 'usage-ingest', 'curated-list'] as const;
export type BppSeam = (typeof BPP_SEAMS)[number];

/** All schema files in the contracts dir (includes the non-BPP ⑨ doc). */
export const ALL_SCHEMA_FILES = [
  ...BPP_SEAMS.map((s) => `${s}.schema.json`),
  'discovery.schema.json',
  'provider-internal-openmeter.schema.json',
] as const;

function readSchema(fileName: string): Record<string, unknown> {
  const full = path.join(CONTRACTS_DIR, fileName);
  return JSON.parse(fs.readFileSync(full, 'utf8')) as Record<string, unknown>;
}

function newAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

/** Compile every schema file (schema-lint guardrail). Throws on an invalid schema. */
export function compileAllSchemas(): Record<string, ValidateFunction> {
  const ajv = newAjv();
  const out: Record<string, ValidateFunction> = {};
  for (const file of ALL_SCHEMA_FILES) {
    out[file] = ajv.compile(readSchema(file));
  }
  return out;
}

/** Provider-internal field names that MUST NOT leak through the BPP seams (⑨). */
export function getForbiddenInternalFieldNames(): string[] {
  const schema = readSchema('provider-internal-openmeter.schema.json');
  const names = schema['x-bpp-forbidden-field-names'];
  if (!Array.isArray(names)) {
    throw new Error('provider-internal-openmeter.schema.json missing x-bpp-forbidden-field-names');
  }
  return names.map((n) => String(n));
}

/** Recursively collect every object key present in a payload. */
function collectKeys(value: unknown, acc: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, acc);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      acc.add(key);
      collectKeys(child, acc);
    }
  }
}

/** Find any forbidden provider-internal field names present in a payload. */
export function findLeakedInternalFields(payload: unknown, forbidden: string[]): string[] {
  const keys = new Set<string>();
  collectKeys(payload, keys);
  return forbidden.filter((name) => keys.has(name));
}

export interface SeamResult {
  seam: BppSeam;
  valid: boolean;
  errors: ErrorObject[];
}

export interface ConformanceReport {
  provider: string;
  seams: SeamResult[];
  /** Seam-isolation: provider-internal (⑨) names found in ② and ⑥ payloads. */
  leakedFields: string[];
  passed: boolean;
}

function schemaFileForSeam(seam: BppSeam): string {
  return `${seam}.schema.json`;
}

async function payloadForSeam(
  provider: BppConformanceProvider,
  seam: BppSeam,
): Promise<unknown> {
  switch (seam) {
    case 'validate':
      return provider.validate('opaque-test-key');
    case 'plans':
      return provider.getPlans();
    case 'account':
      return provider.getAccount();
    case 'usage-ingest':
      return provider.getUsageIngest();
    case 'curated-list':
      return provider.getCuratedList();
  }
}

/**
 * Run the BPP conformance suite (② ④ ⑤ ⑥ ⑧) against a provider plus the
 * seam-isolation assertion on the ② validate and ⑥ usage payloads.
 */
export async function runConformance(
  provider: BppConformanceProvider,
): Promise<ConformanceReport> {
  const ajv = newAjv();
  const seams: SeamResult[] = [];

  for (const seam of BPP_SEAMS) {
    const validate = ajv.compile(readSchema(schemaFileForSeam(seam)));
    const payload = await payloadForSeam(provider, seam);
    const valid = validate(payload) as boolean;
    seams.push({ seam, valid, errors: valid ? [] : (validate.errors ?? []) });
  }

  const forbidden = getForbiddenInternalFieldNames();
  const validatePayload = await provider.validate('opaque-test-key');
  const usagePayload = await provider.getUsageIngest();
  const leakedFields = Array.from(
    new Set([
      ...findLeakedInternalFields(validatePayload, forbidden),
      ...findLeakedInternalFields(usagePayload, forbidden),
    ]),
  );

  const passed = seams.every((s) => s.valid) && leakedFields.length === 0;
  return { provider: provider.slug, seams, leakedFields, passed };
}
