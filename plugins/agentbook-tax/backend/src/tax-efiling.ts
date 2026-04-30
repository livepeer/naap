/**
 * Tax E-Filing — partner API submission, status polling, mock provider.
 */
import { db } from './db/client.js';
import { validateFiling } from './tax-export.js';

// === Mock E-Filing Provider (for development) ===
// In production, this would call Wealthsimple Tax API or a NETFILE-certified vendor.

async function mockSubmit(filingData: any): Promise<{ confirmationNumber: string; status: string }> {
  // Simulate API latency
  await new Promise(r => setTimeout(r, 500));
  const confNum = `CRA-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  return { confirmationNumber: confNum, status: 'accepted' };
}

async function mockCheckStatus(confirmationNumber: string): Promise<{ status: string; details?: string }> {
  // Simulate status check
  return { status: 'accepted', details: 'Notice of Assessment will be mailed within 2 weeks.' };
}

// === Submit Filing ===

export async function submitFiling(
  tenantId: string, taxYear: number,
): Promise<{ success: boolean; data?: any; error?: string }> {
  // 1. Load filing
  const filing = await db.abTaxFiling.findFirst({
    where: { tenantId, taxYear, filingType: 'personal_return' },
  });
  if (!filing) return { success: false, error: 'No filing found for this year' };

  // 2. Check status — must be 'complete' or 'exported'
  if (!['complete', 'exported', 'in_progress'].includes(filing.status)) {
    if (filing.status === 'filed') {
      return { success: false, error: `Already filed on ${filing.filedAt?.toLocaleDateString()}. Confirmation: ${filing.filedRef}` };
    }
    return { success: false, error: `Filing status is "${filing.status}" — must be complete or exported before filing` };
  }

  // 3. Validate
  const forms = (filing.forms as Record<string, any>) || {};
  const validation = validateFiling(forms);
  if (!validation.valid) {
    return {
      success: false,
      error: `Cannot file — ${validation.errors.length} validation error(s)`,
      data: { validation },
    };
  }

  // 4. Load partner config (or use mock)
  const partner = await db.abTaxFilingPartner.findFirst({
    where: { jurisdiction: filing.jurisdiction, enabled: true },
  });

  let result: { confirmationNumber: string; status: string };
  if (partner?.apiUrl) {
    // Real partner API call
    try {
      const res = await fetch(partner.apiUrl + '/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${partner.apiKey}`,
          'X-Cert-ID': partner.certId || '',
        },
        body: JSON.stringify({
          taxYear,
          jurisdiction: filing.jurisdiction,
          region: filing.region,
          forms,
        }),
      });
      result = await res.json() as any;
    } catch (err) {
      return { success: false, error: `Partner API error: ${err}` };
    }
  } else {
    // Use mock provider for development
    result = await mockSubmit({ taxYear, forms });
  }

  // 5. Update filing
  await db.abTaxFiling.update({
    where: { id: filing.id },
    data: {
      status: 'filed',
      filedAt: new Date(),
      filedRef: result.confirmationNumber,
      filedStatus: result.status,
    },
  });

  return {
    success: true,
    data: {
      confirmationNumber: result.confirmationNumber,
      status: result.status,
      filedAt: new Date().toISOString(),
      message: result.status === 'accepted'
        ? `Tax return filed successfully! Confirmation: ${result.confirmationNumber}`
        : `Tax return submitted. Status: ${result.status}. Confirmation: ${result.confirmationNumber}`,
    },
  };
}

// === Check Filing Status ===

export async function checkFilingStatus(
  tenantId: string, taxYear: number,
): Promise<{ success: boolean; data?: any; error?: string }> {
  const filing = await db.abTaxFiling.findFirst({
    where: { tenantId, taxYear, filingType: 'personal_return' },
  });
  if (!filing) return { success: false, error: 'No filing found' };

  if (filing.status !== 'filed' || !filing.filedRef) {
    return {
      success: true,
      data: {
        status: filing.status,
        message: filing.status === 'filed'
          ? `Filed. Confirmation: ${filing.filedRef}`
          : `Filing status: ${filing.status}. Not yet submitted.`,
      },
    };
  }

  // Poll partner for status update
  const partner = await db.abTaxFilingPartner.findFirst({
    where: { jurisdiction: filing.jurisdiction, enabled: true },
  });

  let statusResult: { status: string; details?: string };
  if (partner?.apiUrl) {
    try {
      const res = await fetch(`${partner.apiUrl}/status/${filing.filedRef}`, {
        headers: { 'Authorization': `Bearer ${partner.apiKey}` },
      });
      statusResult = await res.json() as any;
    } catch {
      statusResult = { status: filing.filedStatus || 'unknown', details: 'Could not reach partner API' };
    }
  } else {
    statusResult = await mockCheckStatus(filing.filedRef);
  }

  // Update filing status if changed
  if (statusResult.status !== filing.filedStatus) {
    await db.abTaxFiling.update({
      where: { id: filing.id },
      data: { filedStatus: statusResult.status },
    });
  }

  return {
    success: true,
    data: {
      confirmationNumber: filing.filedRef,
      filedAt: filing.filedAt?.toISOString(),
      status: statusResult.status,
      details: statusResult.details,
      message: `Filing status: **${statusResult.status}**\nConfirmation: ${filing.filedRef}\nFiled: ${filing.filedAt?.toLocaleDateString()}${statusResult.details ? '\n' + statusResult.details : ''}`,
    },
  };
}

// === Seed Mock Partner (for development) ===

export async function seedMockPartner(): Promise<void> {
  await db.abTaxFilingPartner.upsert({
    where: { jurisdiction_partnerName: { jurisdiction: 'ca', partnerName: 'mock' } },
    update: {},
    create: {
      jurisdiction: 'ca',
      partnerName: 'mock',
      apiUrl: '', // empty = use mock provider
      enabled: true,
    },
  });
}
