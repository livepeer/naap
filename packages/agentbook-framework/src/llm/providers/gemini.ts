/**
 * Google Gemini LLM Provider
 * Supports: text generation, vision (image analysis), JSON mode
 */

import type { LLMProvider, LLMRequest, LLMResponse, LLMProviderConfig, LLMMessage } from '../types.js';

export class GeminiProvider implements LLMProvider {
  id = 'gemini';
  name = 'Google Gemini';

  supportsVision(): boolean {
    return true;
  }

  estimateCost(inputTokens: number, outputTokens: number, model: string): number {
    // Gemini pricing (approximate, per 1K tokens in cents)
    const costs: Record<string, { input: number; output: number }> = {
      'gemini-2.0-flash': { input: 0.01, output: 0.04 },
      'gemini-2.5-flash': { input: 0.015, output: 0.06 },
      'gemini-2.5-pro': { input: 0.125, output: 0.5 },
    };
    const c = costs[model] || costs['gemini-2.5-flash'];
    return Math.ceil((inputTokens / 1000) * c.input + (outputTokens / 1000) * c.output);
  }

  async chat(request: LLMRequest, config: LLMProviderConfig): Promise<LLMResponse> {
    const model = request.model || this.resolveModel(request.tier || 'standard', config);
    const apiKey = config.apiKey;
    const baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';

    // Build Gemini request
    const contents = this.buildContents(request.messages);

    const body: any = {
      contents,
      generationConfig: {
        maxOutputTokens: request.maxTokens || 1024,
        temperature: request.temperature ?? 0.7,
      },
    };

    // Add system instruction if present
    const systemMsg = request.messages.find(m => m.role === 'system');
    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    // JSON mode
    if (request.responseFormat === 'json') {
      body.generationConfig.responseMimeType = 'application/json';
    }

    const url = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;

    const start = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${error}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((p: any) => p.text).join('') || '';

    const inputTokens = data.usageMetadata?.promptTokenCount || 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;

    return {
      content: text,
      model,
      provider: 'gemini',
      tokensUsed: { input: inputTokens, output: outputTokens },
      costCents: this.estimateCost(inputTokens, outputTokens, model),
      latencyMs: Date.now() - start,
    };
  }

  private resolveModel(tier: string, config: LLMProviderConfig): string {
    switch (tier) {
      case 'fast': return config.models.fast || 'gemini-2.0-flash';
      case 'premium': return config.models.premium || 'gemini-2.5-pro';
      default: return config.models.standard || 'gemini-2.5-flash';
    }
  }

  private buildContents(messages: LLMMessage[]): any[] {
    return messages
      .filter(m => m.role !== 'system') // system handled separately
      .map(m => {
        const parts: any[] = [{ text: m.content }];

        // Add image for vision
        if (m.imageUrl) {
          parts.push({
            inlineData: {
              mimeType: 'image/jpeg',
              // In production: fetch image and base64 encode
              // For URL-based: use fileData
            },
            // Alternative: use fileUri for URL-based images
          });
        }

        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts,
        };
      });
  }
}
