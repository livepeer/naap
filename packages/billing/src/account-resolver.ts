/**
 * Resolve a tenantId to the billing accountId that owns its subscription.
 *
 * v1: every AgentBook user owns their own account, so accountId === tenantId.
 *
 * When team billing ships, this function will check a BillSeat table first:
 *   const seat = await db.billSeat.findFirst({ where: { tenantId } });
 *   return seat?.accountId ?? tenantId;
 *
 * Every public library function calls this so consumer plugins never see
 * the user-vs-team distinction.
 */
export async function resolveAccountId(tenantId: string): Promise<string> {
  return tenantId;
}
