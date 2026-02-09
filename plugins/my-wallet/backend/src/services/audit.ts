/**
 * Audit Service - Transaction and action logging for compliance
 */

import { prisma } from '../db/client.js';

export type AuditAction = 
  | 'wallet:connect'
  | 'wallet:disconnect'
  | 'staking:stake'
  | 'staking:unstake'
  | 'staking:claim'
  | 'transaction:submit'
  | 'transaction:confirm'
  | 'transaction:fail'
  | 'settings:update';

export interface AuditLogEntry {
  action: AuditAction;
  userId: string;
  address: string;
  chainId?: number;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Log an audit entry
 * In production, this would write to a dedicated audit log table or external service
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  const timestamp = new Date().toISOString();
  
  // Log to console in structured format
  console.log(JSON.stringify({
    timestamp,
    service: 'my-wallet',
    type: 'audit',
    ...entry,
  }));

  // In production, you might also:
  // 1. Write to a dedicated AuditLog table
  // 2. Send to an external logging service (Datadog, Splunk, etc.)
  // 3. Emit to a message queue for async processing
}

/**
 * Log a wallet connection event
 */
export async function logWalletConnect(
  userId: string,
  address: string,
  chainId: number,
  ipAddress?: string
): Promise<void> {
  await logAudit({
    action: 'wallet:connect',
    userId,
    address,
    chainId,
    metadata: { timestamp: Date.now() },
    ipAddress,
  });
}

/**
 * Log a staking action
 */
export async function logStakingAction(
  action: 'stake' | 'unstake' | 'claim',
  userId: string,
  address: string,
  chainId: number,
  txHash: string,
  amount?: string,
  orchestrator?: string
): Promise<void> {
  await logAudit({
    action: `staking:${action}` as AuditAction,
    userId,
    address,
    chainId,
    metadata: {
      txHash,
      amount,
      orchestrator,
      timestamp: Date.now(),
    },
  });
}

/**
 * Log a transaction submission
 */
export async function logTransactionSubmit(
  userId: string,
  address: string,
  chainId: number,
  txHash: string,
  type: string,
  value?: string
): Promise<void> {
  await logAudit({
    action: 'transaction:submit',
    userId,
    address,
    chainId,
    metadata: {
      txHash,
      type,
      value,
      timestamp: Date.now(),
    },
  });
}

/**
 * Log a transaction status update
 */
export async function logTransactionStatus(
  userId: string,
  address: string,
  chainId: number,
  txHash: string,
  status: 'confirm' | 'fail',
  blockNumber?: number
): Promise<void> {
  await logAudit({
    action: `transaction:${status}` as AuditAction,
    userId,
    address,
    chainId,
    metadata: {
      txHash,
      blockNumber,
      timestamp: Date.now(),
    },
  });
}
