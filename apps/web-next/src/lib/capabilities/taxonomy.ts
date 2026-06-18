/**
 * Canonical capability taxonomy (NAAP-E).
 *
 * The single, provider-neutral vocabulary NaaP uses to describe what a key /
 * plan can do. It mirrors the capability ids the validation front door
 * (`/api/v1/keys/validate`, NAAP-C) already returns and that the discovery /
 * default-plan paths (NAAP-9) reference, grouped into three categories:
 *
 *   - `scope`  — pipeline capabilities (e.g. `live-video-to-video:scope`)
 *   - `byoc`   — bring-your-own-container model capabilities (e.g.
 *                `text-to-image:flux-dev`)
 *   - `tool`   — discrete tool capabilities (e.g. `tool:ffmpeg-concat`)
 *
 * Capability ids are validated by GRAMMAR, not by a fixed enum, so adding a new
 * model or tool needs ZERO code change here — only the provider's plan grant set
 * changes. The grammar matches BPP `validate.schema.json`: either
 * `<pipeline>:<model>` or `tool:<name>`, plus the wildcard `*`.
 */

/** The wildcard capability — grants every capability. */
export const CAPABILITY_WILDCARD = '*';

/** The canonical capability categories the front door / discovery reference. */
export const CAPABILITY_CATEGORIES = ['scope', 'byoc', 'tool'] as const;
export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number];

/** Tool capability ids are namespaced with this prefix (`tool:<name>`). */
export const TOOL_CAPABILITY_PREFIX = 'tool:';

/** A single id segment: lowercase-ish slug, bounded length, no separators. */
const SEGMENT = /^[a-z0-9][a-z0-9._-]{0,126}$/i;

/** Parsed shape of a capability id. */
export type ParsedCapability =
  | { kind: 'wildcard'; raw: string }
  | { kind: 'tool'; raw: string; tool: string }
  | { kind: 'pipeline-model'; raw: string; pipeline: string; model: string };

/**
 * Parse a capability id into its structured form, or `null` when malformed.
 * Grammar (data-driven — no hardcoded model/tool list):
 *   - `*`                  → wildcard
 *   - `tool:<name>`        → tool capability
 *   - `<pipeline>:<model>` → pipeline/model capability (scope or byoc)
 */
export function parseCapabilityId(id: string): ParsedCapability | null {
  const raw = typeof id === 'string' ? id.trim() : '';
  if (raw === '') return null;
  if (raw === CAPABILITY_WILDCARD) return { kind: 'wildcard', raw };

  const colon = raw.indexOf(':');
  if (colon <= 0 || colon === raw.length - 1) return null;
  const left = raw.slice(0, colon);
  const right = raw.slice(colon + 1);
  // Only a single separator is allowed (`a:b`, never `a:b:c`).
  if (right.includes(':')) return null;
  if (!SEGMENT.test(left) || !SEGMENT.test(right)) return null;

  if (left === 'tool') {
    return { kind: 'tool', raw, tool: right };
  }
  return { kind: 'pipeline-model', raw, pipeline: left, model: right };
}

/** True when `id` is a well-formed capability id (or the wildcard). */
export function isWellFormedCapabilityId(id: string): boolean {
  return parseCapabilityId(id) !== null;
}

/**
 * Best-effort category for a capability id. `tool:*` ids are unambiguous; a
 * `<pipeline>:<model>` id can be either `scope` or `byoc` (that distinction is a
 * property of the provider's PLAN, not the id), so this returns `null` for them.
 * Enforcement never relies on category inference — it gates against the plan's
 * explicit grant set — so this is purely informational (admin UI / logging).
 */
export function categoryOfCapability(id: string): CapabilityCategory | null {
  const parsed = parseCapabilityId(id);
  if (!parsed) return null;
  if (parsed.kind === 'tool') return 'tool';
  return null;
}

/** Normalize a raw capability list to well-formed, de-duplicated ids. */
export function normalizeCapabilities(raw: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const parsed = parseCapabilityId(entry);
    if (!parsed) continue;
    if (seen.has(parsed.raw)) continue;
    seen.add(parsed.raw);
    out.push(parsed.raw);
  }
  return out;
}
