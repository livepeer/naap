import { NextRequest, NextResponse } from 'next/server';

const GPU_PRICING: Record<string, Record<string, number>> = {
  runpod: {
    'NVIDIA A100 80GB': 1.64,
    'NVIDIA A100 80GB PCIe': 1.64,
    'NVIDIA H100 80GB HBM3': 3.89,
    'NVIDIA L4': 0.44,
    'NVIDIA RTX 4090': 0.69,
    'NVIDIA RTX A6000': 0.79,
    'NVIDIA A40': 0.79,
    'NVIDIA RTX 3090': 0.44,
  },
  'fal-ai': { default: 0.00011 },
  modal: { default: 0.000164 },
  baseten: { default: 0.00028 },
  replicate: { default: 0.000225 },
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const provider = searchParams.get('provider');
    const gpu = searchParams.get('gpu');
    const count = parseInt(searchParams.get('count') || '1', 10);

    if (!provider || !gpu) {
      return NextResponse.json(
        { success: false, error: 'provider and gpu query params required' },
        { status: 400 },
      );
    }

    const providerPricing = GPU_PRICING[provider] || {};
    const hourlyRate = providerPricing[gpu] ?? providerPricing['default'] ?? null;

    return NextResponse.json({
      success: true,
      data: {
        provider,
        gpuModel: gpu,
        gpuCount: count,
        hourlyRate,
        dailyEstimate: hourlyRate != null ? hourlyRate * 24 * count : null,
        monthlyEstimate: hourlyRate != null ? hourlyRate * 24 * 30 * count : null,
        currency: 'USD',
        note: hourlyRate == null ? 'Pricing unavailable for this GPU model' : undefined,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
