/**
 * Kafka configuration for base-svc
 */

export const kafkaConfig = {
  brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
  clientId: process.env.KAFKA_CLIENT_ID || 'base-svc',
};

export const consumerConfig = {
  groupId: process.env.KAFKA_GROUP_ID || 'base-svc-job-feeds',
  topics: [
    'gateway.job.created',
    'gateway.job.completed',
    'gateway.job.failed',
    'gateway.job.processing',
  ],
  fromBeginning: false,
};

export interface JobFeedMessage {
  gatewayId: string;
  gatewayAddress?: string;
  jobId: string;
  jobType: string;
  status: 'processing' | 'completed' | 'failed';
  latencyMs?: number;
  priceWei?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}
