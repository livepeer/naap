export type FeatureFlag =
  | 'telegram_bot'
  | 'tax_package_generation'
  | 'multi_user_teams';

export type UsageDimension =
  | 'expenses_created'
  | 'ocr_scans'
  | 'ai_messages'
  | 'invoices_sent'
  | 'bank_connections';

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete';

export interface PlanFeatures {
  telegram_bot: boolean;
  tax_package_generation: boolean;
  multi_user_teams: boolean;
}

export interface PlanQuotas {
  expenses_created: number;
  ocr_scans: number;
  ai_messages: number;
  invoices_sent: number;
  bank_connections: number;
}
