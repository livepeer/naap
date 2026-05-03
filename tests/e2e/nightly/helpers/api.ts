import type { Page } from '@playwright/test';

export interface ApiClient {
  get<T = any>(path: string): Promise<{ status: number; data: T }>;
  post<T = any>(path: string, body?: any): Promise<{ status: number; data: T }>;
  put<T = any>(path: string, body?: any): Promise<{ status: number; data: T }>;
  patch<T = any>(path: string, body?: any): Promise<{ status: number; data: T }>;
  delete<T = any>(path: string): Promise<{ status: number; data: T }>;
}

/**
 * Returns a fetch wrapper that uses the page's cookie jar so requests are
 * authenticated as the logged-in user. Pass the playwright Page after
 * loginAsE2eUser(page).
 */
export function api(page: Page): ApiClient {
  const ctx = page.request;
  async function call<T>(method: string, path: string, body?: any) {
    const res = await ctx.fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      data: body ? JSON.stringify(body) : undefined,
    });
    let data: any = null;
    try { data = await res.json(); } catch { /* non-JSON responses */ }
    return { status: res.status(), data: data as T };
  }
  return {
    get:    (p)    => call('GET',    p),
    post:   (p, b) => call('POST',   p, b),
    put:    (p, b) => call('PUT',    p, b),
    patch:  (p, b) => call('PATCH',  p, b),
    delete: (p)    => call('DELETE', p),
  };
}
