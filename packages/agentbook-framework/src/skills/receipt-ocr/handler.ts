/**
 * Receipt OCR Handler
 *
 * Processes receipt images via LLM vision API (through service-gateway).
 * Returns structured expense data with confidence scoring.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ReceiptExtractionResult {
  amount_cents: number;
  vendor: string | null;
  date: string | null;
  line_items: { description: string; amount_cents: number }[];
  subtotal_cents: number | null;
  tax_cents: number | null;
  tip_cents: number | null;
  currency: string;
  confidence: number;
}

export interface LLMVisionRequest {
  tier: 'sonnet';
  tenant_id: string;
  system_prompt: string;
  prompt: string;
  image_url?: string;
  max_tokens: number;
  temperature: number;
  response_format: 'json';
}

type LLMCaller = (request: LLMVisionRequest) => Promise<{ content: string }>;

// Load the extraction prompt
let extractionPrompt: string;
try {
  extractionPrompt = readFileSync(join(__dirname, 'prompts', 'extract-receipt.md'), 'utf-8');
} catch {
  extractionPrompt = 'Extract receipt data as JSON: amount_cents, vendor, date, line_items, subtotal_cents, tax_cents, tip_cents, currency, confidence';
}

/**
 * Extract structured data from a receipt image.
 */
export async function extractReceipt(
  imageUrl: string,
  tenantId: string,
  llmCaller: LLMCaller,
): Promise<ReceiptExtractionResult> {
  try {
    const response = await llmCaller({
      tier: 'sonnet',
      tenant_id: tenantId,
      system_prompt: extractionPrompt,
      prompt: 'Extract all data from this receipt image. Return JSON only.',
      image_url: imageUrl,
      max_tokens: 500,
      temperature: 0.1,
      response_format: 'json',
    });

    const parsed = JSON.parse(response.content);

    return {
      amount_cents: parsed.amount_cents || 0,
      vendor: parsed.vendor || null,
      date: parsed.date || null,
      line_items: parsed.line_items || [],
      subtotal_cents: parsed.subtotal_cents || null,
      tax_cents: parsed.tax_cents || null,
      tip_cents: parsed.tip_cents || null,
      currency: parsed.currency || 'USD',
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
    };
  } catch (err) {
    console.error('Receipt extraction failed:', err);
    return {
      amount_cents: 0,
      vendor: null,
      date: null,
      line_items: [],
      subtotal_cents: null,
      tax_cents: null,
      tip_cents: null,
      currency: 'USD',
      confidence: 0,
    };
  }
}

/**
 * Determine if the extraction result needs user confirmation.
 * Low confidence (< 0.8) -> ask user to confirm.
 */
export function needsConfirmation(result: ReceiptExtractionResult): boolean {
  if (result.confidence < 0.8) return true;
  if (result.amount_cents === 0) return true;
  if (!result.vendor) return true;
  return false;
}
