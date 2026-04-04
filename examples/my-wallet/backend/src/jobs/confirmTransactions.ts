/**
 * Poll pending transactions for receipts and update gas accounting data.
 * Runs every 30 seconds to catch newly confirmed transactions.
 */

import { prisma } from '../db/client.js';

const ARBITRUM_RPC = process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc';

async function getTransactionReceipt(txHash: string): Promise<any | null> {
  try {
    const res = await fetch(ARBITRUM_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      }),
    });
    const json = await res.json();
    return json.result || null;
  } catch {
    return null;
  }
}

export async function confirmTransactions(): Promise<void> {
  try {
    const pending = await prisma.walletTransactionLog.findMany({
      where: { status: 'pending' },
      take: 20,
      orderBy: { timestamp: 'desc' },
    });

    if (!pending.length) return;

    for (const tx of pending) {
      try {
        const receipt = await getTransactionReceipt(tx.txHash);
        if (!receipt) continue;

        const status = receipt.status === '0x1' ? 'confirmed' : 'failed';
        const gasUsed = receipt.gasUsed ? parseInt(receipt.gasUsed, 16).toString() : tx.gasUsed;
        const gasPrice = receipt.effectiveGasPrice
          ? parseInt(receipt.effectiveGasPrice, 16).toString()
          : tx.gasPrice;
        const blockNumber = receipt.blockNumber
          ? parseInt(receipt.blockNumber, 16)
          : undefined;

        await prisma.walletTransactionLog.update({
          where: { txHash: tx.txHash },
          data: {
            status,
            gasUsed,
            gasPrice,
            blockNumber,
            confirmedAt: new Date(),
          },
        });

        console.log(`[confirmTx] ${tx.txHash} → ${status}`);
      } catch (err: any) {
        console.warn(`[confirmTx] Error checking ${tx.txHash}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error('[confirmTransactions] Error:', err.message);
  }
}
