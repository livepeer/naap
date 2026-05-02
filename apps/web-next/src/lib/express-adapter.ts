/**
 * Run an Express application from a Next.js Route Handler.
 *
 * Converts a `NextRequest` (Web Fetch API) into a Node `IncomingMessage`,
 * captures the response into a buffer, and returns a Web `Response`.
 *
 * Used to host plugin Express backends (agentbook-tax, agentbook-invoice)
 * inside Vercel Functions instead of running them as separate services.
 */

import 'server-only';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import type { NextRequest } from 'next/server';

type ExpressLike = (req: unknown, res: unknown, next?: (err?: unknown) => void) => void;

export interface DispatchOptions {
  /** Extra headers to set on the proxied request (overrides incoming values). */
  extraHeaders?: Record<string, string>;
}

export async function dispatchToExpress(
  app: ExpressLike,
  request: NextRequest,
  options: DispatchOptions = {}
): Promise<Response> {
  const url = new URL(request.url);

  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = request.method;
  req.url = url.pathname + url.search;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  if (options.extraHeaders) {
    for (const [key, value] of Object.entries(options.extraHeaders)) {
      headers[key.toLowerCase()] = value;
    }
  }
  req.headers = headers;

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const bodyBuffer = hasBody ? Buffer.from(await request.arrayBuffer()) : null;
  if (bodyBuffer && bodyBuffer.length > 0) {
    req.push(bodyBuffer);
  }
  req.push(null);

  return new Promise<Response>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const res = new ServerResponse(req);

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);

    (res as unknown as { write: (...args: unknown[]) => boolean }).write = (
      chunk: unknown,
      encoding?: unknown,
      cb?: unknown
    ) => {
      if (chunk != null) chunks.push(toBuffer(chunk, encoding));
      return (originalWrite as (...args: unknown[]) => boolean)(chunk, encoding, cb);
    };

    (res as unknown as { end: (...args: unknown[]) => ServerResponse }).end = (
      chunk?: unknown,
      encoding?: unknown,
      cb?: unknown
    ) => {
      if (chunk != null && typeof chunk !== 'function') {
        chunks.push(toBuffer(chunk, encoding));
      }

      const responseHeaders = new Headers();
      const raw = res.getHeaders();
      for (const [name, value] of Object.entries(raw)) {
        if (value == null) continue;
        if (Array.isArray(value)) {
          for (const item of value) responseHeaders.append(name, String(item));
        } else {
          responseHeaders.set(name, String(value));
        }
      }

      const body = Buffer.concat(chunks);

      if (res.statusCode >= 500) {
        console.error(
          `[express-adapter] ${req.method} ${req.url} → ${res.statusCode}`,
          body.toString('utf8').slice(0, 500),
        );
      }

      resolve(
        new Response(body, {
          status: res.statusCode,
          statusText: res.statusMessage || '',
          headers: responseHeaders,
        })
      );

      return (originalEnd as (...args: unknown[]) => ServerResponse)(chunk, encoding, cb);
    };

    try {
      app(req, res, (err?: unknown) => {
        if (err) {
          console.error(`[express-adapter] ${req.method} ${req.url} threw:`, err);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    } catch (err) {
      console.error(`[express-adapter] ${req.method} ${req.url} sync-threw:`, err);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function toBuffer(chunk: unknown, encoding?: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, (encoding as BufferEncoding) || 'utf8');
  }
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.from(String(chunk));
}
