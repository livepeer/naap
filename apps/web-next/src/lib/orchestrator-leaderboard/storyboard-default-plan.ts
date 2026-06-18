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
