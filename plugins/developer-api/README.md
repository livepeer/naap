# Developer API Manager Plugin

Explore AI models, manage API keys, and track usage for developers integrating with the network.

## Features

- **Model Explorer**: Browse available AI models with pricing and performance info
- **API Key Management**: Create, rotate, and revoke API keys
- **Usage Tracking**: Monitor API usage and costs
- **Documentation**: Access integration guides and API reference

## Installation

```bash
naap-plugin install developer-api
```

## API Endpoints

### GET /api/v1/developer/models
Returns list of available AI models.

### GET /api/v1/developer/keys
Returns list of API keys.

### POST /api/v1/developer/keys
Create a new API key.

### GET /api/v1/developer/usage
Get usage statistics.

## Development

```bash
cd plugins/developer-api
npm install
npm run dev
```

## License

MIT
