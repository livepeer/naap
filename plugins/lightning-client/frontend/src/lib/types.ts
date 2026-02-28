export interface HealthResponse {
  status: string;
  active_jobs: number;
  version: string;
}

export interface StartJobRequest {
  model_id?: string | null;
  params?: Record<string, unknown> | null;
  request_id?: string | null;
  stream_id?: string | null;
  orchestrator_url?: string | null;
}

export interface StartJobResponse {
  job_id: string;
  model_id: string;
  publish_url: string | null;
  subscribe_url: string | null;
  control_url: string | null;
  events_url: string | null;
}

export interface JobListItem {
  job_id: string;
  model_id: string;
  created_at: number;
  orchestrator_url?: string | null;
  media_started: boolean;
}

export interface JobStatusResponse {
  job_id: string;
  model_id: string;
  created_at: number;
  orchestrator_url?: string | null;
  publish_url?: string | null;
  subscribe_url?: string | null;
  control_url?: string | null;
  events_url?: string | null;
  has_payment_session: boolean;
  media_started: boolean;
}

export interface ControlMessageBody {
  message: Record<string, unknown>;
}

export interface GatewayError {
  status: number;
  code?: string;
  message: string;
  details?: unknown;
}
