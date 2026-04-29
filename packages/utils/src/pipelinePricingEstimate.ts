/**
 * Shared list-price USD estimates from wei-per-unit (dashboard + developer UI).
 * Mirrors billing assumptions in apps/web-next dashboard pipeline table.
 */

export const LIVE_VIDEO_PIPELINE_ID = 'live-video-to-video';
export const TEXT_TO_IMAGE_PIPELINE_ID = 'text-to-image';
export const UPSCALE_PIPELINE_ID = 'upscale';
export const LLM_PIPELINE_ID = 'llm';
/** Same list-price image estimate as {@link TEXT_TO_IMAGE_PIPELINE_ID} (512×512). */
export const OPENAI_IMAGE_GENERATION_PIPELINE_ID = 'openai-image-generation';

/** Billing reference resolution for list-price estimates (512×512). */
export const PIPELINE_PRICE_REF_PIXELS = 512 * 512;
/** LLM list-price USD estimate: one request billed at 10k tokens (wei/token × 10_000). */
export const LLM_PRICE_REF_TOKENS = 10_000;
/** x4 upscale: bill on returned pixels = 4× input area (512² → 1024²). */
export const UPSCALE_X4_OUTPUT_PIXEL_FACTOR = 4;
export const LIVE_VIDEO_ESTIMATE_FPS_FALLBACK = 24;
export const PIPELINE_ETH_USD_CLIENT_FALLBACK = 3000;

const PIPELINE_BILLING_UNIT: Record<string, string> = {
  llm: 'token',
  lms: 'token',
  'openai-chat-completions': 'token',
  'openai-text-embeddings': 'token',
  'audio-to-text': 'second',
  'text-to-speech': 'second',
};

/**
 * Canonical pipeline id for pricing (lowercase, hyphenated).
 * Upstream sometimes emits snake_case or mixed casing; dashboard and developer UIs
 * must agree on the same slugs for USD list-price branches.
 */
export function normalizePipelineIdForPricing(pipelineId: string): string {
  return pipelineId.trim().toLowerCase().replace(/_/g, '-');
}

/** Billing unit for a pipeline id (pixel, token, or second). */
export function pipelineBillingUnit(pipelineId: string): string {
  const k = normalizePipelineIdForPricing(pipelineId);
  return PIPELINE_BILLING_UNIT[k] ?? 'pixel';
}

export function formatUsdPipelineEstimate(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return '—';
  if (usd === 0) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: usd < 0.01 ? 5 : usd < 1 ? 4 : 2,
  }).format(usd);
}

/** Whole thousands as "10k"; otherwise en-US grouping (e.g. 1,500). */
export function formatTokenCountShort(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1000 && n % 1000 === 0) {
    return `${n / 1000}k`;
  }
  return n.toLocaleString('en-US');
}

export function weiBigintToUsd(weiTotal: bigint, ethUsd: number): number {
  return (Number(weiTotal) / 1e18) * ethUsd;
}

export function pipelineTablePriceCellContent(input: {
  pipelineId: string;
  wei: bigint | null;
  unit: string;
  modelFps: number | null;
  pipelineAvgFps: number | undefined;
  ethUsd: number;
  /** When set, appended to the ETH/USD line in tooltips; omit for a neutral line. */
  ethUsdProvenance?: string | null;
}): { main: string; richLines: string[] | null } {
  const { pipelineId, wei, unit, modelFps, pipelineAvgFps, ethUsd, ethUsdProvenance } = input;
  const pid = normalizePipelineIdForPricing(pipelineId);
  const ethUsdLine = (() => {
    const base = `USD @ ETH/USD ≈ $${ethUsd.toFixed(2)}`;
    const p = ethUsdProvenance?.trim();
    if (p) return `${base} (${p}).`;
    return `${base}.`;
  })();
  if (wei == null) {
    return { main: '—', richLines: null };
  }
  const weiLabel = `${wei.toLocaleString('en-US')} wei/${unit}`;

  if (pid === LIVE_VIDEO_PIPELINE_ID) {
    const fps =
      modelFps != null && Number.isFinite(modelFps) && modelFps > 0
        ? modelFps
        : pipelineAvgFps != null && Number.isFinite(pipelineAvgFps) && pipelineAvgFps > 0
          ? pipelineAvgFps
          : LIVE_VIDEO_ESTIMATE_FPS_FALLBACK;
    const weiPerMinute = wei * BigInt(Math.round(PIPELINE_PRICE_REF_PIXELS * fps * 60));
    const usd = weiBigintToUsd(weiPerMinute, ethUsd);
    return {
      main: `${formatUsdPipelineEstimate(usd)}/min`,
      richLines: [
        weiLabel,
        `${fps.toFixed(1)} FPS @ 512×512, one minute of output.`,
        ethUsdLine,
      ],
    };
  }

  if (pid === TEXT_TO_IMAGE_PIPELINE_ID || pid === OPENAI_IMAGE_GENERATION_PIPELINE_ID) {
    const weiPerImage = wei * BigInt(PIPELINE_PRICE_REF_PIXELS);
    const usd = weiBigintToUsd(weiPerImage, ethUsd);
    return {
      main: `${formatUsdPipelineEstimate(usd)}/img`,
      richLines: [
        weiLabel,
        '512×512, one frame.',
        ethUsdLine,
      ],
    };
  }

  if (pid === UPSCALE_PIPELINE_ID) {
    const outputPixels = BigInt(PIPELINE_PRICE_REF_PIXELS * UPSCALE_X4_OUTPUT_PIXEL_FACTOR);
    const weiForJob = wei * outputPixels;
    const usd = weiBigintToUsd(weiForJob, ethUsd);
    return {
      main: `${formatUsdPipelineEstimate(usd)}/img`,
      richLines: [
        weiLabel,
        '512×512 in → ~1024×1024 out (4× pixels billed).',
        ethUsdLine,
      ],
    };
  }

  if (unit === 'token') {
    const weiForRequest = wei * BigInt(LLM_PRICE_REF_TOKENS);
    const usd = weiBigintToUsd(weiForRequest, ethUsd);
    return {
      main: `${formatUsdPipelineEstimate(usd)}/${formatTokenCountShort(LLM_PRICE_REF_TOKENS)} tokens`,
      richLines: [
        weiLabel,
        `${formatTokenCountShort(LLM_PRICE_REF_TOKENS)} tokens @ list wei/token.`,
        ethUsdLine,
      ],
    };
  }

  return { main: weiLabel, richLines: null };
}

/** Integer wei per billing unit from a float average (e.g. net/models). */
export function avgWeiBigIntFromNumber(priceAvgWeiPerUnit: number): bigint | null {
  if (!Number.isFinite(priceAvgWeiPerUnit) || priceAvgWeiPerUnit <= 0) return null;
  const r = Math.round(priceAvgWeiPerUnit);
  if (r <= 0) return null;
  try {
    return BigInt(r);
  } catch {
    return null;
  }
}
