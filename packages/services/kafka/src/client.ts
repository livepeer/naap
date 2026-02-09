/**
 * Kafka client factory and utilities
 */

import { Kafka, Producer, Consumer, EachMessagePayload, KafkaJSConnectionError } from 'kafkajs';
import type { KafkaConfig, ConsumerConfig, ProducerConfig, MessageHandler, TopicConfig } from './types';

let kafkaInstance: Kafka | null = null;
const producers: Map<string, Producer> = new Map();
const consumers: Map<string, Consumer> = new Map();

/**
 * Initialize Kafka client
 */
export function createKafkaClient(config: KafkaConfig): Kafka {
  if (kafkaInstance) {
    return kafkaInstance;
  }

  const brokers = Array.isArray(config.brokers) ? config.brokers : [config.brokers];

  kafkaInstance = new Kafka({
    clientId: config.clientId,
    brokers,
    ssl: config.ssl,
    sasl: config.sasl,
    retry: {
      retries: 8,
      initialRetryTime: 100,
      multiplier: 2,
      maxRetryTime: 30000,
    },
  });

  return kafkaInstance;
}

/**
 * Get or create a Kafka producer
 */
export async function createProducer(
  config: KafkaConfig,
  producerConfig: ProducerConfig = {}
): Promise<Producer> {
  const key = `${config.clientId}-producer`;
  
  if (producers.has(key)) {
    return producers.get(key)!;
  }

  const kafka = createKafkaClient(config);
  const producer = kafka.producer({
    idempotent: producerConfig.idempotent ?? true,
    maxInFlightRequests: producerConfig.maxInFlightRequests ?? 1,
    retry: producerConfig.retry,
  });

  await producer.connect();
  producers.set(key, producer);

  return producer;
}

/**
 * Create a Kafka consumer
 */
export async function createConsumer(
  config: KafkaConfig,
  consumerConfig: ConsumerConfig,
  messageHandler: MessageHandler
): Promise<Consumer> {
  const kafka = createKafkaClient(config);
  const topics = Array.isArray(consumerConfig.topics) 
    ? consumerConfig.topics 
    : [consumerConfig.topics];

  const consumer = kafka.consumer({
    groupId: consumerConfig.groupId,
    sessionTimeout: consumerConfig.sessionTimeout ?? 30000,
    heartbeatInterval: consumerConfig.heartbeatInterval ?? 3000,
    maxBytesPerPartition: consumerConfig.maxBytesPerPartition ?? 1048576, // 1MB
  });

  await consumer.connect();
  await consumer.subscribe({
    topics,
    fromBeginning: consumerConfig.fromBeginning ?? false,
  });

  await consumer.run({
    eachMessage: async (payload: EachMessagePayload) => {
      try {
        const message = {
          topic: payload.topic,
          partition: payload.partition,
          offset: payload.message.offset,
          key: payload.message.key,
          value: payload.message.value,
          headers: payload.message.headers,
          timestamp: payload.message.timestamp,
        };

        await messageHandler(message);
      } catch (error) {
        console.error(`Error processing message from ${payload.topic}:`, error);
        // In production, you might want to send to a dead letter queue
        throw error;
      }
    },
  });

  consumers.set(`${config.clientId}-${consumerConfig.groupId}`, consumer);

  return consumer;
}

/**
 * Disconnect a producer
 */
export async function disconnectProducer(config: KafkaConfig): Promise<void> {
  const key = `${config.clientId}-producer`;
  const producer = producers.get(key);
  
  if (producer) {
    await producer.disconnect();
    producers.delete(key);
  }
}

/**
 * Disconnect a consumer
 */
export async function disconnectConsumer(
  config: KafkaConfig,
  groupId: string
): Promise<void> {
  const key = `${config.clientId}-${groupId}`;
  const consumer = consumers.get(key);
  
  if (consumer) {
    await consumer.disconnect();
    consumers.delete(key);
  }
}

/**
 * Disconnect all producers and consumers
 */
export async function disconnectAll(): Promise<void> {
  const disconnectPromises = [
    ...Array.from(producers.values()).map((p) => p.disconnect()),
    ...Array.from(consumers.values()).map((c) => c.disconnect()),
  ];

  await Promise.all(disconnectPromises);
  producers.clear();
  consumers.clear();
  kafkaInstance = null;
}

/**
 * Create a topic (admin operation)
 */
export async function createTopic(
  config: KafkaConfig,
  topicConfig: TopicConfig
): Promise<void> {
  const kafka = createKafkaClient(config);
  const admin = kafka.admin();

  try {
    await admin.connect();
    await admin.createTopics({
      topics: [
        {
          topic: topicConfig.topic,
          numPartitions: topicConfig.numPartitions ?? 1,
          replicationFactor: topicConfig.replicationFactor ?? 1,
          configEntries: topicConfig.configEntries,
        },
      ],
    });
    console.log(`✅ Created topic: ${topicConfig.topic}`);
  } finally {
    await admin.disconnect();
  }
}

/**
 * List all topics
 */
export async function listTopics(config: KafkaConfig): Promise<string[]> {
  const kafka = createKafkaClient(config);
  const admin = kafka.admin();

  try {
    await admin.connect();
    const topics = await admin.listTopics();
    return topics;
  } finally {
    await admin.disconnect();
  }
}

/**
 * Health check for Kafka connection
 */
export async function checkKafkaHealth(config: KafkaConfig): Promise<boolean> {
  try {
    const kafka = createKafkaClient(config);
    const admin = kafka.admin();
    await admin.connect();
    await admin.listTopics();
    await admin.disconnect();
    return true;
  } catch (error) {
    if (error instanceof KafkaJSConnectionError) {
      return false;
    }
    throw error;
  }
}
