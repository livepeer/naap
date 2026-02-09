/**
 * Shell Configuration
 * 
 * Centralized configuration for the shell application.
 * All hardcoded values should be moved here and made configurable
 * via environment variables.
 */

/**
 * Branding configuration
 */
export interface BrandingConfig {
  /** Application name displayed in the sidebar */
  name: string;
  /** Logo URL (optional) */
  logoUrl?: string;
}

/**
 * External links configuration
 */
export interface ExternalLinksConfig {
  /** Treasury explorer URL */
  treasury: string;
  /** Governance/voting URL */
  governance: string;
  /** Releases/changelog URL */
  releases?: string;
}

/**
 * Shell configuration
 */
export interface ShellConfig {
  branding: BrandingConfig;
  externalLinks: ExternalLinksConfig;
}

/**
 * Get environment variable with fallback
 */
function getEnv(key: string, fallback: string): string {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return (import.meta.env as Record<string, string>)[key] || fallback;
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] || fallback;
  }
  return fallback;
}

/**
 * Shell configuration singleton
 */
export const shellConfig: ShellConfig = {
  branding: {
    name: getEnv('VITE_BRAND_NAME', 'LIVEPEER'),
    logoUrl: getEnv('VITE_LOGO_URL', ''),
  },
  externalLinks: {
    treasury: getEnv('VITE_TREASURY_URL', 'https://explorer.livepeer.org/treasury'),
    governance: getEnv('VITE_GOVERNANCE_URL', 'https://explorer.livepeer.org/voting'),
    releases: getEnv('VITE_RELEASES_URL', ''),
  },
};

/**
 * Get branding name
 */
export function getBrandName(): string {
  return shellConfig.branding.name;
}

/**
 * Get external link URL
 */
export function getExternalLink(key: keyof ExternalLinksConfig): string {
  return shellConfig.externalLinks[key] || '';
}

export default shellConfig;
