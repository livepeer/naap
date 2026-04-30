/**
 * Tax Slips — OCR extraction for T4, T5, T3, T4A, RRSP, TFSA, bank statements.
 */
import { db } from './db/client.js';

const OCR_SYSTEM_PROMPT = `You are a Canadian tax document scanner. Analyze this image and:
1. Identify the slip type: T4, T5, T3, T4A, RRSP receipt, TFSA receipt, T5007, or bank statement
2. Extract all relevant fields as JSON

For T4: { employment_income, tax_deducted, cpp_contributions, ei_premiums, employer_name }
For T5: { interest_income, dividends, capital_gains, payer_name }
For T3: { capital_gains, other_income, trust_name }
For RRSP: { contribution_amount, receipt_number, issuer }
For TFSA: { contribution_amount, issuer }
For T4A: { pension_income, other_income, payer_name }
For bank statement: { interest_earned, fees_paid, institution_name }

Respond as JSON only: { "slipType": "T4", "fields": { ... }, "confidence": 0.95 }
All monetary values in CENTS (multiply dollars by 100).`;

// === Process Slip OCR ===

export async function processSlipOCR(
  tenantId: string,
  taxYear: number,
  imageUrl: string,
  filingId: string | null,
  callGemini: (sys: string, user: string, max?: number) => Promise<string | null>,
): Promise<{ success: boolean; data?: { id: string; slipType: string; issuer: string | null; extractedData: any; confidence: number }; error?: string }> {
  try {
    const userPrompt = `Please analyze this tax document image: ${imageUrl}`;
    const raw = await callGemini(OCR_SYSTEM_PROMPT, userPrompt, 1024);

    if (!raw) {
      return { success: false, error: 'Gemini returned no response' };
    }

    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

    let parsed: { slipType: string; fields: Record<string, any>; confidence: number };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return { success: false, error: `Failed to parse Gemini response as JSON: ${raw.slice(0, 200)}` };
    }

    const { slipType, fields, confidence } = parsed;

    // Derive issuer from fields depending on slip type
    const issuer: string | null =
      fields?.employer_name ||
      fields?.payer_name ||
      fields?.trust_name ||
      fields?.issuer ||
      fields?.institution_name ||
      null;

    const slip = await db.abTaxSlip.create({
      data: {
        tenantId,
        taxYear,
        slipType,
        issuer,
        imageUrl,
        extractedData: fields,
        confidence: typeof confidence === 'number' ? confidence : 0,
        status: 'pending',
        ...(filingId ? { filingId } : {}),
      },
    });

    return {
      success: true,
      data: {
        id: slip.id,
        slipType: slip.slipType,
        issuer: slip.issuer,
        extractedData: slip.extractedData,
        confidence: slip.confidence,
      },
    };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Unknown error in processSlipOCR' };
  }
}

// === Confirm Slip ===

export async function confirmSlip(
  tenantId: string,
  slipId: string,
): Promise<{ success: boolean; data?: { confirmed: boolean; slipType: string }; error?: string }> {
  try {
    const slip = await db.abTaxSlip.findFirst({
      where: { id: slipId, tenantId },
    });

    if (!slip) {
      return { success: false, error: 'Slip not found' };
    }

    const updated = await db.abTaxSlip.update({
      where: { id: slipId },
      data: { status: 'confirmed' },
    });

    return {
      success: true,
      data: { confirmed: true, slipType: updated.slipType },
    };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Unknown error in confirmSlip' };
  }
}

// === List Slips ===

export async function listSlips(
  tenantId: string,
  taxYear: number,
): Promise<{ success: boolean; data?: { id: string; slipType: string; issuer: string | null; status: string; confidence: number; extractedData: any }[]; error?: string }> {
  try {
    const slips = await db.abTaxSlip.findMany({
      where: { tenantId, taxYear },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slipType: true,
        issuer: true,
        status: true,
        confidence: true,
        extractedData: true,
      },
    });

    return { success: true, data: slips };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Unknown error in listSlips' };
  }
}
