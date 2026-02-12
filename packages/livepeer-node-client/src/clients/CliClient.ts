/**
 * LivepeerCliClient
 *
 * Typed client for go-livepeer's CLI API (localhost-only port).
 * Covers: status, orchestrator discovery, staking, gateway payments, protocol params.
 */

import type {
  NodeStatus, Transcoder, Delegator, SenderInfo,
  ProtocolParameters, RoundInfo, TxResult, ContractAddresses,
  NetworkCapabilities, UnbondingLock,
} from '../types.js';

export class LivepeerCliClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:7935') {
    // Validate baseUrl to prevent SSRF via constructor injection
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`LivepeerCliClient: unsupported protocol "${parsed.protocol}"`);
    }
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    // Validate that path starts with / and doesn't contain protocol indicators
    if (!path.startsWith('/') || path.includes('://')) {
      throw new Error(`Invalid API path: ${path}`);
    }
    const url = `${this.baseUrl}${path}`;
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (body) {
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`CLI API ${method} ${path} failed: ${res.status} ${text}`);
    }
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, 'POST', body);
  }

  // --- Status & Info ---
  async getStatus(): Promise<NodeStatus> {
    return this.request<NodeStatus>('/status');
  }

  async getEthChainID(): Promise<number> {
    return this.request<number>('/EthChainID');
  }

  async getEthAddr(): Promise<string> {
    return this.request<string>('/ethAddr');
  }

  // --- Orchestrator Discovery ---
  async getRegisteredOrchestrators(): Promise<Transcoder[]> {
    return this.request<Transcoder[]>('/registeredOrchestrators');
  }

  async getNetworkCapabilities(): Promise<NetworkCapabilities> {
    return this.request<NetworkCapabilities>('/getNetworkCapabilities');
  }

  // --- Staking / Bonding ---
  async bond(amount: string, toAddr: string): Promise<TxResult> {
    return this.post<TxResult>('/bond', { amount, toAddr });
  }

  async unbond(amount: string): Promise<TxResult> {
    return this.post<TxResult>('/unbond', { amount });
  }

  async rebond(unbondingLockId: number, toAddr: string): Promise<TxResult> {
    return this.post<TxResult>('/rebond', { unbondingLockId, toAddr });
  }

  async withdrawStake(unbondingLockId: number): Promise<TxResult> {
    return this.post<TxResult>('/withdrawStake', { unbondingLockId });
  }

  async withdrawFees(amount?: string): Promise<TxResult> {
    return this.post<TxResult>('/withdrawFees', amount ? { amount } : undefined);
  }

  async claimEarnings(): Promise<TxResult> {
    return this.post<TxResult>('/claimEarnings');
  }

  async reward(): Promise<TxResult> {
    return this.post<TxResult>('/reward');
  }

  async getDelegatorInfo(): Promise<Delegator> {
    return this.request<Delegator>('/delegatorInfo');
  }

  async getUnbondingLocks(withdrawable?: boolean): Promise<UnbondingLock[]> {
    const path = withdrawable ? '/unbondingLocks?withdrawable=true' : '/unbondingLocks';
    return this.request<UnbondingLock[]>(path);
  }

  // --- Ticket Broker (Gateway) ---
  async fundDepositAndReserve(deposit: string, reserve: string): Promise<TxResult> {
    return this.post<TxResult>('/fundDepositAndReserve', { depositAmount: deposit, reserveAmount: reserve });
  }

  async fundDeposit(amount: string): Promise<TxResult> {
    return this.post<TxResult>('/fundDeposit', { amount });
  }

  async getSenderInfo(): Promise<SenderInfo> {
    return this.request<SenderInfo>('/senderInfo');
  }

  async unlock(): Promise<TxResult> {
    return this.post<TxResult>('/unlock');
  }

  async cancelUnlock(): Promise<TxResult> {
    return this.post<TxResult>('/cancelUnlock');
  }

  async withdraw(): Promise<TxResult> {
    return this.post<TxResult>('/withdraw');
  }

  // --- Protocol Parameters ---
  async getProtocolParameters(): Promise<ProtocolParameters> {
    return this.request<ProtocolParameters>('/protocolParameters');
  }

  async getCurrentRound(): Promise<RoundInfo> {
    return this.request<RoundInfo>('/currentRound');
  }

  // --- Tokens ---
  async getTokenBalance(): Promise<string> {
    return this.request<string>('/tokenBalance');
  }

  async getEthBalance(): Promise<string> {
    return this.request<string>('/ethBalance');
  }

  async getContractAddresses(): Promise<ContractAddresses> {
    return this.request<ContractAddresses>('/contractAddresses');
  }

  // --- Gas ---
  async setMaxGasPrice(amount: string): Promise<void> {
    await this.post('/setMaxGasPrice', { amount });
  }

  async getMaxGasPrice(): Promise<string> {
    return this.request<string>('/maxGasPrice');
  }
}
