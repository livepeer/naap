import { z } from 'zod';

export const CreateDeploymentSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, 'Name must start with alphanumeric and contain only alphanumeric, dots, hyphens, underscores'),
  providerSlug: z.string().min(1),
  gpuModel: z.string().min(1),
  gpuVramGb: z.number().int().min(1),
  gpuCount: z.number().int().min(1).max(8).default(1),
  cudaVersion: z.string().optional(),
  artifactType: z.string().min(1),
  artifactVersion: z.string().min(1),
  dockerImage: z.string().min(1),
  healthPort: z.number().int().min(1).max(65535).optional(),
  healthEndpoint: z.string().optional(),
  artifactConfig: z.record(z.unknown()).optional(),
  sshHost: z.string().optional(),
  sshPort: z.number().int().min(1).max(65535).optional(),
  sshUsername: z.string().optional(),
  containerName: z.string().optional(),
  templateId: z.string().optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  concurrency: z.number().int().min(1).max(100).optional(),
  estimatedCostPerHour: z.number().min(0).optional(),
  livepeerConfig: z.object({
    topology: z.enum(['all-in-one', 'all-on-provider', 'split-cpu-serverless']),
    serverlessProvider: z.string().optional(),
    serverlessModelId: z.string().optional(),
    serverlessApiKey: z.string().optional(),
    serverlessEndpointUrl: z.string().optional(),
    modelImage: z.string().optional(),
    capacity: z.number().optional(),
    pricePerUnit: z.number().optional(),
    publicAddress: z.string().optional(),
    capabilityName: z.string().optional(),
  }).optional(),
});

export const UpdateDeploymentSchema = z.object({
  artifactVersion: z.string().optional(),
  dockerImage: z.string().optional(),
  gpuModel: z.string().optional(),
  gpuVramGb: z.number().int().min(1).optional(),
  gpuCount: z.number().int().min(1).max(8).optional(),
  artifactConfig: z.record(z.unknown()).optional(),
  envVars: z.record(z.string(), z.string()).optional(),
  concurrency: z.number().int().min(1).max(100).optional(),
});

export type CreateDeploymentInput = z.infer<typeof CreateDeploymentSchema>;
export type UpdateDeploymentInput = z.infer<typeof UpdateDeploymentSchema>;
