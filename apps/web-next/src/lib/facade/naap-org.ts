/**
 * Returns the NAAP org filter from the NAAP_ORG environment variable.
 * When unset, returns undefined so the API returns data for all orgs.
 *
 * Allowed values: "daydream" | "cloudspe"
 */
export function getNaapOrg(): string | undefined {
  const org = process.env.NAAP_ORG?.trim();
  return org || undefined;
}
