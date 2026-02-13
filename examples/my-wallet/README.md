# My Wallet Plugin

MetaMask wallet integration for the NAAP platform, enabling wallet connections, LPT staking, and Web3 transactions.

## Features

- **Wallet Connection**: Connect MetaMask to link your Ethereum wallet
- **Staking**: Stake LPT tokens to orchestrators on the Livepeer network
- **Transaction History**: View and track all wallet transactions
- **Multi-Network**: Support for Ethereum mainnet and Arbitrum

## Installation

This plugin is installed via the NAAP Marketplace or can be manually installed:

```bash
cd plugins/my-wallet
npm install
npm run build
```

## Development

### Frontend (Port 3008)

```bash
cd frontend
npm install
npm run dev
```

### Backend (Port 4008)

```bash
cd backend
npm install
npm run db:migrate
npm run dev
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `defaultNetwork` | `arbitrum-one` | Default blockchain network |
| `autoConnect` | `true` | Auto-connect wallet on load |
| `showTestnets` | `false` | Show testnet networks |
| `gasStrategy` | `standard` | Gas price strategy (slow/standard/fast) |

## RBAC Roles

| Role | Permissions |
|------|-------------|
| `my-wallet:admin` | Full wallet management |
| `my-wallet:user` | Basic wallet and staking |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/wallet/connections` | GET/POST | Manage wallet connections |
| `/api/v1/wallet/transactions` | GET | Get transaction history |
| `/api/v1/wallet/staking/state` | GET | Get current staking state |
| `/api/v1/wallet/staking/orchestrators` | GET | List available orchestrators |

## License

MIT
