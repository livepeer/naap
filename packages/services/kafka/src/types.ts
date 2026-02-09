/**
 * Kafka service types and interfaces
 */

export interface KafkaConfig {
  brokers: string | string[];
  clientId: string;
  ssl?: boolean;
  sasl?: {
    mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
    username: string;
    password: string;
  };
}

export interface ConsumerConfig {
  groupId: string;
  topics: string | string[];
  fromBeginning?: boolean;
  sessionTimeout?: number;
  heartbeatInterval?: number;
  maxBytesPerPartition?: number;
}

export interface ProducerConfig {
  idempotent?: boolean;
  maxInFlightRequests?: number;
  retry?: {
    retries?: number;
    initialRetryTime?: number;
    multiplier?: number;
  };
}

export interface Message {
  topic: string;
  partition?: number;
  offset?: string;
  key?: string | Buffer;
  value: string | Buffer | object;
  headers?: Record<string, string | Buffer>;
  timestamp?: string;
}

export interface ConsumerMessage {
  topic: string;
  partition: number;
  offset: string;
  key?: Buffer;
  value: Buffer;
  headers?: Record<string, Buffer>;
  timestamp: string;
}

export type MessageHandler = (message: ConsumerMessage) => Promise<void> | void;

export interface TopicConfig {
  topic: string;
  numPartitions?: number;
  replicationFactor?: number;
  configEntries?: Array<{
    name: string;
    value: string;
  }>;
}
