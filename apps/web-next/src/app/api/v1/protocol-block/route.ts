import { NextResponse } from 'next/server';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

/**
 * Returns the current L1 (Ethereum mainnet) block number.
 *
 * Livepeer rounds are defined in terms of L1 blocks: startBlock and roundLength
 * from the subgraph refer to Ethereum mainnet blocks. The official Livepeer
 * explorer uses L1 block numbers for round progress even when viewing Arbitrum.
 * Using Arbitrum block numbers would produce incorrect progress (wrong scale).
 */
function getL1RpcUrl(): string | undefined {
  return process.env.L1_RPC_URL?.trim() || undefined;
}

export async function GET(): Promise<NextResponse> {
  const rpcUrl = getL1RpcUrl();

  if (!rpcUrl) {
    return NextResponse.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message:
            'Protocol block proxy is unavailable. Set L1_RPC_URL in apps/web-next/.env.local (e.g. https://mainnet.infura.io/v3/<key>). Livepeer rounds use L1 block numbers.',
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 503 }
    );
  }

  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl),
    });

    const chainId = await client.getChainId();
    if (chainId !== mainnet.id) {
      console.error('[protocol-block] RPC returned wrong chainId:', chainId, 'expected:', mainnet.id);
      return NextResponse.json(
        {
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'L1 RPC chain ID mismatch — expected Ethereum mainnet',
          },
          meta: { timestamp: new Date().toISOString() },
        },
        { status: 503 }
      );
    }

    const blockNumber = await client.getBlockNumber();
    return NextResponse.json({
      blockNumber: Number(blockNumber),
      meta: { timestamp: new Date().toISOString() },
    });
  } catch {
    console.error('[protocol-block] L1 RPC unavailable');
    return NextResponse.json(
      {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'L1 RPC is unavailable',
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 503 }
    );
  }
}
