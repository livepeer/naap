/**
 * Kafka consumer service for job feeds
 */

import { createConsumer, type MessageHandler, type ConsumerMessage } from '@naap/services-kafka';
import { kafkaConfig, consumerConfig, type JobFeedMessage } from './kafka-config';
import { db } from '../db/client';
import type { Service } from '@naap/service-registry';

export class KafkaConsumerService implements Service {
  name = 'kafka-consumer-job-feeds';
  type = 'kafka' as const;
  private consumer: any = null;
  private isRunning = false;

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    console.log('📡 Starting Kafka consumer for job feeds...');

    const messageHandler: MessageHandler = async (message: ConsumerMessage) => {
      try {
        const value = message.value.toString();
        const jobFeed: JobFeedMessage = JSON.parse(value);

        // Store in database
        await db.jobFeed.create({
          data: {
            gatewayId: jobFeed.gatewayId,
            gatewayAddress: jobFeed.gatewayAddress,
            jobId: jobFeed.jobId,
            jobType: jobFeed.jobType,
            status: jobFeed.status,
            latencyMs: jobFeed.latencyMs,
            priceWei: jobFeed.priceWei,
            timestamp: new Date(jobFeed.timestamp),
            metadata: jobFeed.metadata || {},
          },
        });

        console.log(`✅ Processed job feed: ${jobFeed.jobId} from ${jobFeed.gatewayId}`);
      } catch (error) {
        console.error('Error processing job feed message:', error);
        // In production, you might want to send to a dead letter queue
        throw error;
      }
    };

    this.consumer = await createConsumer(kafkaConfig, consumerConfig, messageHandler);
    this.isRunning = true;
    console.log(`✅ Kafka consumer started for topics: ${consumerConfig.topics.join(', ')}`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning || !this.consumer) {
      return;
    }

    console.log('🛑 Stopping Kafka consumer...');
    
    try {
      await this.consumer.disconnect();
      this.isRunning = false;
      console.log('✅ Kafka consumer stopped');
    } catch (error) {
      console.error('Error stopping Kafka consumer:', error);
      throw error;
    }
  }

  async health(): Promise<boolean> {
    return this.isRunning && this.consumer !== null;
  }

  metadata = {
    topics: consumerConfig.topics,
    groupId: consumerConfig.groupId,
  };
}
