/**
 * PR 11 — Telegram nudge for CPA-filed accountant requests.
 *
 * Sent on AbAccountantRequest creation. The owner gets:
 *   📒 "Your CPA jane@cpa.test needs your eyes:
 *      'Need receipt for AWS October bill.'
 *      [👀 Resolve]"
 *
 * The Resolve callback (`cpa_resolve:<requestId>`) lives in the
 * Telegram webhook handler and prompts the owner for a free-form
 * resolution note (or kicks off a receipt-upload flow). Best-effort:
 * any failure here logs and returns false, so the underlying request
 * row is still created.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface CpaRequestNudge {
  requestId: string;
  cpaEmail: string;
  message: string;
  entityType: string;
  entityId: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatEntityHint(entityType: string, entityId: string | null): string {
  if (!entityId || entityType === 'general') return '';
  const label =
    entityType === 'AbExpense' ? 'expense'
    : entityType === 'AbInvoice' ? 'invoice'
    : entityType === 'AbMileageEntry' ? 'mileage entry'
    : entityType.toLowerCase();
  return ` (about a specific ${label})`;
}

export async function sendCpaRequestNudge(
  tenantId: string,
  payload: CpaRequestNudge,
): Promise<boolean> {
  try {
    const bot = await db.abTelegramBot.findFirst({
      where: { tenantId, enabled: true },
    });
    if (!bot) return false;
    const chats = Array.isArray(bot.chatIds) ? (bot.chatIds as string[]) : [];
    if (chats.length === 0) return false;

    const text =
      `📒 Your CPA <b>${escapeHtml(payload.cpaEmail)}</b> needs your eyes${escapeHtml(formatEntityHint(payload.entityType, payload.entityId))}:\n` +
      `<i>"${escapeHtml(payload.message.slice(0, 500))}"</i>\n` +
      `Tap below to resolve.`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '👀 Resolve', callback_data: `cpa_resolve:${payload.requestId}` },
          { text: '⏭ Skip for now', callback_data: `cpa_skip:${payload.requestId}` },
        ],
      ],
    };

    let any = false;
    for (const chatId of chats) {
      try {
        const res = await fetch(
          `https://api.telegram.org/bot${bot.botToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              parse_mode: 'HTML',
              reply_markup: replyMarkup,
            }),
          },
        );
        if (res.ok) any = true;
      } catch (err) {
        console.warn('[cpa-notify] sendMessage failed:', err);
      }
    }
    return any;
  } catch (err) {
    console.warn('[cpa-notify] failed:', err);
    return false;
  }
}
