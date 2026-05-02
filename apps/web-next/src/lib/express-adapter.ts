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
  // Force the inner Express server to skip compression middleware. The
  // compression middleware wraps res.write/res.end and buffers/flushes
  // through the underlying socket — but our socket has no peer, so its
  // flush silently fails and the captured body comes back empty.
  // We capture an uncompressed buffer here; Vercel/CDN handles outer encoding.
  headers['accept-encoding'] = 'identity';
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
    let resolved = false;

    const finalize = (lastChunk?: unknown, encoding?: unknown) => {
      if (resolved) return;
      resolved = true;

      if (lastChunk != null && typeof lastChunk !== 'function') {
        chunks.push(toBuffer(lastChunk, encoding));
      }

      const responseHeaders = new Headers();
      const raw = res.getHeaders();
      for (const [name, value] of Object.entries(raw)) {
        if (value == null) continue;
        // Strip content-length — we set the body explicitly, fetch will
        // recompute it. A stale content-length from compression's pre-flush
        // bookkeeping can cause truncated responses.
        if (name.toLowerCase() === 'content-length') continue;
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
    };

    // Hook write to capture body chunks. Don't forward to the original —
    // the underlying socket is fake and forwarding can throw.
    (res as unknown as { write: (...args: unknown[]) => boolean }).write = (
      chunk: unknown,
      encoding?: unknown,
      cb?: unknown
    ) => {
      if (chunk != null) chunks.push(toBuffer(chunk, encoding));
      if (typeof encoding === 'function') (encoding as () => void)();
      else if (typeof cb === 'function') (cb as () => void)();
      return true;
    };

    // Hook end to capture the final chunk and resolve the promise. Skip
    // calling the original end — its socket writes can throw on our fake
    // peer-less Socket and tank the function with an empty 500.
    (res as unknown as { end: (...args: unknown[]) => ServerResponse }).end = (
      chunk?: unknown,
      encoding?: unknown,
      cb?: unknown
    ) => {
      const cbActual = typeof chunk === 'function' ? chunk
        : typeof encoding === 'function' ? encoding
        : typeof cb === 'function' ? cb
        : null;
      const chunkActual = typeof chunk === 'function' ? undefined : chunk;
      const encodingActual = typeof encoding === 'function' ? undefined : encoding;
      finalize(chunkActual, encodingActual);
      if (cbActual) (cbActual as () => void)();
      return res;
    };

    // Safety net: if Express ends without our hooks firing (shouldn't happen
    // but defends against future middleware shenanigans), emit a final
    // status when the response signals 'finish'.
    res.on('finish', () => finalize());
    res.on('close', () => finalize());

    // IMPORTANT: do NOT pass a callback to app(). Express uses the callback
    // *in place of* its built-in finalhandler, so a "no match" or unhandled
    // error path would write nothing — leaving our promise unresolved until
    // Vercel times out and returns 500 with an empty body. With no callback,
    // Express's finalhandler writes the response (404 / 500) through our
    // wrapped res.end, which calls finalize() and resolves the promise.
    try {
      app(req, res);
    } catch (err) {
      console.error(`[express-adapter] ${req.method} ${req.url} sync-threw:`, err);
      if (!resolved) {
        resolved = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
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
