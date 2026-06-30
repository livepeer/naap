/**
 * NAAP-9 — Storyboard Default discovery bundle (Daydream parity).
 *
 * The DEFAULT PLAN: the concrete instance of the generic capability gate
 * (NAAP-E). It guarantees a non-disruptive switch from the live Daydream
 * discovery path to NaaP discovery by returning ⊇ the orchestrator/capability
 * set Storyboard's MCP currently uses (scope staging + BYOC + tool), with a
 * static-fleet fallback merged into the tier shuffle so no orchestrator is
 * silently dropped when ClickHouse lacks warm rows.
 *
 * The byoc/tool capability arrays and static orchestrators below are the
 * committed-staging BASELINE. Per Decision D7 they MUST be reconciled at build
 * time against the live `sdk.daydream.monster/capabilities` snapshot (the
 * golden set) — they are not authoritative on their own. The golden-set parity
 * test guards drift in both directions.
 *
 * Everything here is generic: `storyboard-default` is just the first plan to
 * ride the capability gate; the static-fleet fallback is a property of the
 * plan, not of Storyboard.
 */

export const STORYBOARD_DEFAULT_PLAN_ID = 'storyboard-default';

/** Env flag gating the bundle. Default OFF → existing per-cap behavior. */
export const STORYBOARD_DEFAULT_DISCOVERY_FLAG = 'STORYBOARD_DEFAULT_DISCOVERY_ENABLED';

export interface StoryboardDefaultCategory {
  /** Leaderboard capability ids queried for this category. */
  readonly capabilities: readonly string[];
  /** Static-fleet fallback orchestrator addresses for this category. */
  readonly staticOrchestrators: readonly string[];
}

export interface StoryboardDefaultPlan {
  readonly id: string;
  readonly name: string;
  /** No pymthouse denylist until a real provider plan (PYMT-5) enforces. */
  readonly billingProviderSlug: string;
  readonly scope: StoryboardDefaultCategory;
  readonly byoc: StoryboardDefaultCategory;
  readonly tool: StoryboardDefaultCategory;
  readonly topN: number;
}

export const STORYBOARD_DEFAULT_PLAN: StoryboardDefaultPlan = {
  id: STORYBOARD_DEFAULT_PLAN_ID,
  name: 'Storyboard Default (Daydream parity)',
  billingProviderSlug: 'daydream',
  scope: {
    capabilities: ['live-video-to-video/scope'],
    staticOrchestrators: [
      'https://orch-staging-1.daydream.monster:8935',
      'https://orch-staging-2.daydream.monster:8935',
      'https://orch-staging-3.daydream.monster:8935',
    ],
  },
  byoc: {
    capabilities: [
      'nano-banana',
      'recraft-v4',
      'flux-schnell',
      'flux-dev',
      'ltx-t2v',
      'ltx-i2v',
      'kontext-edit',
      'bg-remove',
      'topaz-upscale',
      'chatterbox-tts',
      'gemini-image',
      'gemini-text',
    ],
    staticOrchestrators: ['https://byoc-staging-1.daydream.monster:8935'],
  },
  tool: {
    capabilities: [
      'ffmpeg-concat',
      'ffmpeg-trim',
      'ffmpeg-overlay',
      'ffmpeg-export',
      'ffmpeg-audio-mix',
      'ffmpeg-loop',
      'ffmpeg-burn-subtitles',
      'ffmpeg-grid',
      'ffmpeg-mux',
      'pillow-resize',
      'pillow-watermark',
      'pillow-format',
      'pillow-palette',
      'pillow-grid',
      'obscura-extract-text',
      'obscura-extract-markdown',
      'obscura-extract-links',
      'hyperframes-caption',
      'hyperframes-lower-third',
      'hyperframes-render',
      'yolo-detect',
      'yolo-segment',
      'cad-render',
      'cad-validate',
    ],
    staticOrchestrators: ['https://byoc-staging-1.daydream.monster:8935'],
  },
  topN: 100,
} as const;

export type StoryboardDefaultCategoryKey = 'scope' | 'byoc' | 'tool';

export const STORYBOARD_DEFAULT_CATEGORY_KEYS: readonly StoryboardDefaultCategoryKey[] = [
  'scope',
  'byoc',
  'tool',
];

/**
 * Reads the feature flag. Default OFF: any value other than a truthy string
 * (`"true"`/`"1"`) leaves the Daydream path authoritative.
 */
export function isStoryboardDefaultDiscoveryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env[STORYBOARD_DEFAULT_DISCOVERY_FLAG]?.trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

/**
 * Per-category env vars that append EXTRA static-fleet orchestrator URIs to the
 * Storyboard Default bundle (comma-separated). Default unset → empty → byte-for-
 * byte-identical to today (golden-set parity preserved).
 *
 * Purpose: surface a freshly-deployed CANARY orchestrator in NaaP discovery
 * WITHOUT waiting on the global leaderboard dataset cron. Because the static
 * fleet is always merged into the bundle (and the live fetch is fail-safe — see
 * `buildStoryboardDefaultDiscovery`), an address listed here is returned for its
 * capability class even when ClickHouse has no warm rows for it yet. This is the
 * "node's own DISCOVERY_URL" seam for the E2E demo.
 *
 * Fill in once the canary is deployed, e.g. (sdk/orch advertising byoc + tool):
 *   STORYBOARD_CANARY_BYOC_ORCHESTRATORS=https://byoc-canary-1.daydream.monster:8935
 *   STORYBOARD_CANARY_TOOL_ORCHESTRATORS=https://byoc-canary-1.daydream.monster:8935
 *   STORYBOARD_CANARY_SCOPE_ORCHESTRATORS=  (leave empty unless the canary serves scope)
 */
export const STORYBOARD_CANARY_ORCHESTRATOR_ENV: Readonly<
  Record<StoryboardDefaultCategoryKey, string>
> = {
  scope: 'STORYBOARD_CANARY_SCOPE_ORCHESTRATORS',
  byoc: 'STORYBOARD_CANARY_BYOC_ORCHESTRATORS',
  tool: 'STORYBOARD_CANARY_TOOL_ORCHESTRATORS',
};

/** Parse a comma/whitespace-separated env list of orchestrator URIs. */
function parseOrchestratorList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve the env-configured extra static-fleet orchestrators for one category.
 * Returns `[]` when the env var is unset/blank (the zero-regression default).
 */
export function resolveCanaryStaticOrchestrators(
  category: StoryboardDefaultCategoryKey,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return parseOrchestratorList(env[STORYBOARD_CANARY_ORCHESTRATOR_ENV[category]]);
}

/**
 * Resolve the env-configured canary orchestrators for every category. The
 * result is a partial map (categories with no env override are omitted) so it
 * can be passed straight into `buildStoryboardDefaultDiscovery`.
 */
export function resolveAllCanaryStaticOrchestrators(
  env: NodeJS.ProcessEnv = process.env,
): Partial<Record<StoryboardDefaultCategoryKey, string[]>> {
  const out: Partial<Record<StoryboardDefaultCategoryKey, string[]>> = {};
  for (const key of STORYBOARD_DEFAULT_CATEGORY_KEYS) {
    const list = resolveCanaryStaticOrchestrators(key, env);
    if (list.length > 0) {
      out[key] = list;
    }
  }
  return out;
}
