# My Wallet Plugin API

## Endpoints

### Wallet Connections

#### GET /api/v1/wallet/connections
Get wallet connection for the authenticated user.

**Response:**
```json
{
  "connection": {
    "id": "uuid",
    "userId": "uuid",
    "address": "0x...",
    "chainId": 42161,
    "lastSeen": "2026-01-24T00:00:00Z"
  }
}
```

#### POST /api/v1/wallet/connections
Link a wallet address to the authenticated user.

**Request:**
```json
{
  "address": "0x...",
  "chainId": 42161
}
```

### Transactions

#### GET /api/v1/wallet/transactions
Get transaction history for the authenticated user.

**Query Parameters:**
- `limit` (default: 50)
- `offset` (default: 0)
- `type` (optional): stake, unstake, claim, transfer

**Response:**
```json
{
  "transactions": [...],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

#### POST /api/v1/wallet/transactions
Log a new transaction.

**Request:**
```json
{
  "txHash": "0x...",
  "type": "stake",
  "chainId": 42161,
  "value": "1000000000000000000",
  "metadata": {}
}
```

### Staking

#### GET /api/v1/wallet/staking/state
Get staking state for a wallet address.

**Query Parameters:**
- `address` (required): Wallet address

**Response:**
```json
{
  "state": {
    "stakedAmount": "1000000000000000000",
    "delegatedTo": "0x...",
    "pendingRewards": "50000000000000000",
    "lastUpdated": "2026-01-24T00:00:00Z"
  }
}
```

#### GET /api/v1/wallet/staking/orchestrators
Get list of available orchestrators for delegation.

**Response:**
```json
{
  "orchestrators": [
    {
      "address": "0x...",
      "name": "Orchestrator 1",
      "totalStake": "10000000000000000000",
      "rewardCut": 10,
      "feeShare": 50
    }
  ]
}
```
