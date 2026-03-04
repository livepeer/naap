/**
 * Service Gateway — Request Transform
 *
 * Builds the upstream request from consumer request + connector config.
 * Handles: URL construction, auth injection, body transforms, header mapping.
 */

import type {
  ResolvedConfig,
  ResolvedSecrets,
  UpstreamRequest,
} from './types';
import { signAwsV4 } from './aws-sig-v4';

export function buildUpstreamRequest(
  request: Request,
  config: ResolvedConfig,
  secrets: ResolvedSecrets,
  consumerBody: string | null,
  consumerPath: string,
  consumerBodyRaw?: ArrayBuffer | null,
): UpstreamRequest {
  const { connector, endpoint } = config;

  const consumerUrl = new URL(request.url);
  const upstreamUrl = buildUpstreamUrl(connector.upstreamBaseUrl, endpoint, consumerPath, consumerUrl.searchParams);
  const url = new URL(upstreamUrl);

  const method = endpoint.upstreamMethod || endpoint.method;
  const headers = buildUpstreamHeaders(connector, endpoint, secrets, request);
  const body = transformBody(endpoint, consumerBody, consumerBodyRaw);

  injectAuth(headers, connector, secrets, method, url, body);

  return { url: url.toString(), method, headers, body };
}

function buildUpstreamUrl(
  baseUrl: string,
  endpoint: ResolvedConfig['endpoint'],
  consumerPath: string,
  consumerSearchParams?: URLSearchParams
): string {
  const consumerParts = consumerPath.split('/').filter(Boolean);
  const patternParts = endpoint.path.split('/').filter(Boolean);

  let upstreamPath = endpoint.upstreamPath;

  patternParts.forEach((part, i) => {
    if (part.startsWith(':') && part.endsWith('*')) {
      const catchAllSegments = consumerParts.slice(i);
      upstreamPath = upstreamPath.replace(part, catchAllSegments.join('/'));
    } else if (part.startsWith(':') && consumerParts[i]) {
      upstreamPath = upstreamPath.replace(part, consumerParts[i]);
    }
  });

  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const path = upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`;
  const url = new URL(`${base}${path}`);

  if (consumerSearchParams) {
    consumerSearchParams.forEach((value, key) => {
      url.searchParams.append(key, value);
    });
  }

  const queryParams = endpoint.upstreamQueryParams;
  if (queryParams && typeof queryParams === 'object') {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

function buildUpstreamHeaders(
  connector: ResolvedConfig['connector'],
  endpoint: ResolvedConfig['endpoint'],
  secrets: ResolvedSecrets,
  request: Request
): Headers {
  const headers = new Headers();

  if (endpoint.upstreamContentType) {
    headers.set('Content-Type', endpoint.upstreamContentType);
  } else {
    const original = request.headers.get('content-type');
    if (original) headers.set('Content-Type', original);
  }

  const mapping = endpoint.headerMapping;
  if (mapping && typeof mapping === 'object') {
    for (const [key, value] of Object.entries(mapping)) {
      headers.set(key, interpolateSecrets(String(value), secrets));
    }
  }

  const requestId = request.headers.get('x-request-id');
  if (requestId) headers.set('x-request-id', requestId);

  const traceId = request.headers.get('x-trace-id');
  if (traceId) headers.set('x-trace-id', traceId);

  return headers;
}

function injectAuth(
  headers: Headers,
  connector: ResolvedConfig['connector'],
  secrets: ResolvedSecrets,
  method: string,
  url: URL,
  body?: BodyInit | null,
): void {
  const config = connector.authConfig;

  switch (connector.authType) {
    case 'bearer': {
      const tokenRef = (config.tokenRef as string) || 'token';
      const token = secrets[tokenRef] || '';
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      break;
    }

    case 'header': {
      const headerEntries = (config.headers as Record<string, string>) || {};
      for (const [key, valueRef] of Object.entries(headerEntries)) {
        headers.set(key, interpolateSecrets(valueRef, secrets));
      }
      break;
    }

    case 'basic': {
      const userRef = (config.usernameRef as string) || 'username';
      const passRef = (config.passwordRef as string) || 'password';
      const username = secrets[userRef] || '';
      const password = secrets[passRef] || '';
      const encoded = Buffer.from(`${username}:${password}`).toString('base64');
      headers.set('Authorization', `Basic ${encoded}`);
      break;
    }

    case 'query': {
      const paramName = (config.paramName as string) || 'key';
      const secretRef = (config.secretRef as string) || 'token';
      const secretValue = secrets[secretRef];
      if (secretValue) {
        url.searchParams.set(paramName, secretValue);
      }
      break;
    }

    case 'aws-s3': {
      const accessKeyRef = (config.accessKeyRef as string) || 'access_key';
      const secretKeyRef = (config.secretKeyRef as string) || 'secret_key';
      const accessKey = secrets[accessKeyRef] || '';
      const secretKey = secrets[secretKeyRef] || '';
      if (accessKey && secretKey) {
        signAwsV4({
          method,
          url,
          headers,
          body: body instanceof ArrayBuffer ? body : typeof body === 'string' ? body : null,
          accessKey,
          secretKey,
          region: (config.region as string) || 'us-east-1',
          service: (config.service as string) || 's3',
          signPayload: (config.signPayload as boolean) ?? false,
        });
      }
      break;
    }

    case 'none':
    default:
      break;
  }
}

function transformBody(
  endpoint: ResolvedConfig['endpoint'],
  consumerBody: string | null,
  consumerBodyRaw?: ArrayBuffer | null,
): BodyInit | undefined {
  if (endpoint.bodyTransform === 'binary') {
    return consumerBodyRaw ? consumerBodyRaw : undefined;
  }

  if (!consumerBody && !endpoint.upstreamStaticBody) {
    return undefined;
  }

  switch (endpoint.bodyTransform) {
    case 'passthrough':
      return consumerBody || undefined;

    case 'static':
      return endpoint.upstreamStaticBody || undefined;

    case 'template': {
      if (!endpoint.upstreamStaticBody || !consumerBody) {
        return consumerBody || undefined;
      }
      try {
        const body = JSON.parse(consumerBody);
        return interpolateTemplate(endpoint.upstreamStaticBody, body);
      } catch {
        return consumerBody;
      }
    }

    default: {
      if (endpoint.bodyTransform.startsWith('extract:') && consumerBody) {
        const fieldPath = endpoint.bodyTransform.slice('extract:'.length);
        try {
          const body = JSON.parse(consumerBody);
          const extracted = getNestedValue(body, fieldPath);
          return extracted !== undefined ? JSON.stringify(extracted) : consumerBody;
        } catch {
          return consumerBody;
        }
      }
      return consumerBody || undefined;
    }
  }
}

function interpolateSecrets(template: string, secrets: ResolvedSecrets): string {
  return template.replace(/\{\{secrets\.(\w+)\}\}/g, (_, name) => secrets[name] || '');
}

function interpolateTemplate(template: string, body: Record<string, unknown>): string {
  return template.replace(/\{\{body\.([.\w]+)\}\}/g, (_, path) => {
    const value = getNestedValue(body, path);
    return value !== undefined ? String(value) : '';
  });
}

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
