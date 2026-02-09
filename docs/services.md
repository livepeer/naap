# Service Integration Guide

## Overview

The NAAP Platform supports extensible backend services through a service registry pattern. Services can be Kafka consumers, REST clients, WebSocket servers, or custom integrations.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Service Registry                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Kafka Client │  │ REST Client  │  │ Custom Svc   │  │
│  │ Service      │  │ Service      │  │              │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                          │
│  - Lifecycle Management                                 │
│  - Health Checks                                        │
│  - Service Discovery                                    │
└─────────────────────────────────────────────────────────┘
```

## Service Interface

All services must implement the `Service` interface:

```typescript
interface Service {
  name: string;
  type: 'kafka' | 'rest' | 'websocket' | 'custom';
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<boolean>;
  metadata?: Record<string, any>;
}
```

## Adding a Kafka Consumer

### Step 1: Create Consumer Service

Create `services/your-service/src/services/kafka-consumer.ts`:

```typescript
import { createConsumer, type MessageHandler } from '@naap/services/kafka';
import type { Service } from '@naap/service-registry';

export class YourKafkaConsumerService implements Service {
  name = 'your-kafka-consumer';
  type = 'kafka' as const;
  private consumer: any = null;

  async start(): Promise<void> {
    const config = {
      brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
      clientId: process.env.KAFKA_CLIENT_ID || 'your-service',
    };

    const consumerConfig = {
      groupId: process.env.KAFKA_GROUP_ID || 'your-service-group',
      topics: ['your.topic.name'],
      fromBeginning: false,
    };

    const messageHandler: MessageHandler = async (message) => {
      // Process message
      const data = JSON.parse(message.value.toString());
      // Your processing logic
    };

    this.consumer = await createConsumer(config, consumerConfig, messageHandler);
  }

  async stop(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
    }
  }

  async health(): Promise<boolean> {
    return this.consumer !== null;
  }
}
```

### Step 2: Register Service

In your service's `server.ts`:

```typescript
import { getServiceRegistry } from '@naap/service-registry';
import { YourKafkaConsumerService } from './services/kafka-consumer';

const serviceRegistry = getServiceRegistry();
const kafkaConsumer = new YourKafkaConsumerService();
serviceRegistry.register(kafkaConsumer);

// Start on server startup
await serviceRegistry.startAll();

// Stop on shutdown
process.on('SIGTERM', async () => {
  await serviceRegistry.stopAll();
  process.exit(0);
});
```

## Adding a REST Client

### Step 1: Create REST Client Service

Create `services/your-service/src/services/rest-client.ts`:

```typescript
import { createRestClientWithCircuitBreaker } from '@naap/services/rest-client';
import type { Service } from '@naap/service-registry';

export class YourRestClientService implements Service {
  name = 'your-rest-client';
  type = 'rest' as const;
  private client: any = null;

  async start(): Promise<void> {
    const { client } = createRestClientWithCircuitBreaker(
      {
        baseURL: process.env.EXTERNAL_API_URL || 'https://api.example.com',
        timeout: 30000,
        auth: {
          type: 'bearer',
          token: process.env.EXTERNAL_API_TOKEN,
        },
        retry: {
          retries: 3,
          retryDelay: (count) => count * 1000,
        },
        rateLimit: {
          maxRequests: 100,
          perMilliseconds: 60000, // 100 requests per minute
        },
      },
      {
        failureThreshold: 5,
        resetTimeout: 30000,
        monitoringPeriod: 60000,
      }
    );

    this.client = client;
  }

  async stop(): Promise<void> {
    // Cleanup if needed
  }

  async health(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
```

### Step 2: Use REST Client

```typescript
const { request } = createRestClientWithCircuitBreaker(/* config */);

// Make requests
const response = await request({
  method: 'GET',
  url: '/api/data',
  params: { page: 1 },
});
```

## Service Registry Usage

### Registering Services

```typescript
import { getServiceRegistry } from '@naap/service-registry';

const registry = getServiceRegistry();
registry.register(new YourService());
```

### Starting Services

```typescript
// Start all services
await registry.startAll();

// Start specific service
await registry.start('service-name');
```

### Stopping Services

```typescript
// Stop all services
await registry.stopAll();

// Stop specific service
await registry.stop('service-name');
```

### Health Checks

```typescript
// Check single service
const health = await registry.checkHealth('service-name');

// Check all services
const allHealth = await registry.checkAllHealth();
```

## Kafka Integration

### Configuration

Set environment variables:

```bash
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=your-service
KAFKA_GROUP_ID=your-service-group
```

### Creating Topics

Use the setup script:

```bash
./bin/kafka-setup.sh
```

Or manually:

```typescript
import { createTopic } from '@naap/services/kafka';

await createTopic(config, {
  topic: 'your.topic.name',
  numPartitions: 3,
  replicationFactor: 1,
});
```

### Message Format

Standard message format:

```typescript
interface Message {
  gatewayId?: string;
  jobId?: string;
  eventType: string;
  timestamp: string;
  data: Record<string, any>;
}
```

### Error Handling

```typescript
const messageHandler: MessageHandler = async (message) => {
  try {
    // Process message
  } catch (error) {
    console.error('Message processing failed:', error);
    // Optionally send to dead letter queue
    throw error; // Will trigger retry
  }
};
```

## REST Client Features

### Retry Logic

```typescript
retry: {
  retries: 3,
  retryDelay: (count) => count * 1000, // Exponential backoff
  retryCondition: (error) => {
    // Only retry on network errors or 5xx
    return error.code === 'ECONNREFUSED' || 
           (error.response?.status >= 500);
  },
}
```

### Rate Limiting

```typescript
rateLimit: {
  maxRequests: 100,
  perMilliseconds: 60000, // 100 requests per minute
}
```

### Circuit Breaker

```typescript
circuitBreaker: {
  failureThreshold: 5,      // Open after 5 failures
  resetTimeout: 30000,      // Try again after 30s
  monitoringPeriod: 60000,  // Monitor over 1 minute
}
```

### Authentication

```typescript
// Bearer token
auth: {
  type: 'bearer',
  token: process.env.API_TOKEN,
}

// Basic auth
auth: {
  type: 'basic',
  username: 'user',
  password: 'pass',
}

// API key
auth: {
  type: 'api-key',
  apiKey: process.env.API_KEY,
  apiKeyHeader: 'X-API-Key',
}
```

## Best Practices

### 1. Service Lifecycle

- Always implement graceful shutdown
- Handle startup failures gracefully
- Log service lifecycle events
- Implement health checks

### 2. Error Handling

- Catch and log all errors
- Implement retry logic for transient errors
- Use dead letter queues for failed messages
- Monitor error rates

### 3. Resource Management

- Close connections on shutdown
- Limit concurrent operations
- Use connection pooling
- Monitor resource usage

### 4. Configuration

- Use environment variables
- Provide sensible defaults
- Validate configuration on startup
- Document required configuration

### 5. Monitoring

- Log service start/stop events
- Track message processing rates
- Monitor health check results
- Alert on service failures

## Example: Job Feed Consumer

See `services/base-svc/src/services/kafka-consumer.ts` for a complete example of:

- Kafka consumer implementation
- Message processing
- Database integration
- Error handling
- Service registration

## Troubleshooting

### Kafka Consumer Not Receiving Messages

1. Check consumer group:
   ```bash
   docker-compose exec kafka kafka-consumer-groups --bootstrap-server localhost:9092 --list
   ```

2. Verify topic exists:
   ```bash
   docker-compose exec kafka kafka-topics --list --bootstrap-server localhost:9092
   ```

3. Check consumer lag:
   ```bash
   docker-compose exec kafka kafka-consumer-groups --bootstrap-server localhost:9092 --describe --group your-group-id
   ```

### REST Client Errors

1. Check circuit breaker state
2. Verify authentication credentials
3. Check rate limit settings
4. Review retry configuration

### Service Not Starting

1. Check service logs
2. Verify configuration
3. Check dependencies (Kafka, external APIs)
4. Review health check implementation
