/**
 * useIntegration Hook
 * Provides access to 3rd party integrations through the shell proxy
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createIntegrationClient, createShellApiClient } from '../utils/api.js';
import type {
  Integration,
  StorageIntegration,
  AIIntegration,
  EmailIntegration,
  PaymentIntegration,
  HealthStatus,
  IntegrationMetadata,
} from '../types/integrations.js';

export interface UseIntegrationOptions {
  pluginName: string;
  authToken?: string;
}

export interface UseIntegrationResult<T extends Integration> {
  integration: T | null;
  loading: boolean;
  error: string | null;
  status: HealthStatus | null;
  checkHealth: () => Promise<HealthStatus>;
}

/**
 * Generic hook for using any integration
 */
export function useIntegration<T extends Integration>(
  integrationType: string,
  options: UseIntegrationOptions
): UseIntegrationResult<T> {
  const { pluginName, authToken } = options;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<HealthStatus | null>(null);
  const [available, setAvailable] = useState(false);

  const client = useMemo(
    () => createIntegrationClient(pluginName, authToken),
    [pluginName, authToken]
  );

  // Check if integration is available
  useEffect(() => {
    const checkAvailability = async () => {
      setLoading(true);
      try {
        const api = createShellApiClient(authToken);
        const response = await api.get<{ available: boolean; configured: boolean }>(
          `/api/v1/integrations/${integrationType}/status`
        );
        setAvailable(response.data.available && response.data.configured);
        if (!response.data.configured) {
          setError(`Integration "${integrationType}" is not configured`);
        }
      } catch (err) {
        setError(`Integration "${integrationType}" is not available`);
        setAvailable(false);
      } finally {
        setLoading(false);
      }
    };

    checkAvailability();
  }, [integrationType, authToken]);

  const checkHealth = useCallback(async (): Promise<HealthStatus> => {
    try {
      const result = await client.call<HealthStatus>(integrationType, 'healthCheck', []);
      setStatus(result);
      return result;
    } catch (err) {
      const unhealthyStatus: HealthStatus = {
        healthy: false,
        message: err instanceof Error ? err.message : 'Health check failed',
      };
      setStatus(unhealthyStatus);
      return unhealthyStatus;
    }
  }, [client, integrationType]);

  // Create a proxy object that calls through the integration client
  const integration = useMemo(() => {
    if (!available) return null;

    return new Proxy({} as T, {
      get(_target, prop: string) {
        if (prop === 'healthCheck') {
          return checkHealth;
        }
        // Return a function that calls the integration method
        return async (...args: unknown[]) => {
          return client.call(integrationType, prop, args);
        };
      },
    });
  }, [available, client, integrationType, checkHealth]);

  return {
    integration,
    loading,
    error,
    status,
    checkHealth,
  };
}

/**
 * Hook for storage integrations (S3, GCS, Azure Blob)
 */
export function useStorageIntegration(
  type: 'aws-s3' | 'gcp-storage' | 'azure-blob',
  options: UseIntegrationOptions
) {
  return useIntegration<StorageIntegration>(type, options);
}

/**
 * Hook for AI integrations (OpenAI, Anthropic)
 */
export function useAIIntegration(
  type: 'openai' | 'anthropic',
  options: UseIntegrationOptions
) {
  return useIntegration<AIIntegration>(type, options);
}

/**
 * Hook for email integrations (SendGrid, Mailgun, SES)
 */
export function useEmailIntegration(
  type: 'sendgrid' | 'mailgun' | 'ses',
  options: UseIntegrationOptions
) {
  return useIntegration<EmailIntegration>(type, options);
}

/**
 * Hook for payment integrations (Stripe, PayPal)
 */
export function usePaymentIntegration(
  type: 'stripe' | 'paypal',
  options: UseIntegrationOptions
) {
  return useIntegration<PaymentIntegration>(type, options);
}

/**
 * Hook to list all available integrations
 */
export function useAvailableIntegrations(authToken?: string) {
  const [integrations, setIntegrations] = useState<IntegrationMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchIntegrations = async () => {
      setLoading(true);
      try {
        const api = createShellApiClient(authToken);
        const response = await api.get<{ integrations: IntegrationMetadata[] }>(
          '/api/v1/integrations'
        );
        setIntegrations(response.data.integrations);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch integrations');
      } finally {
        setLoading(false);
      }
    };

    fetchIntegrations();
  }, [authToken]);

  return { integrations, loading, error };
}
