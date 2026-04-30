/**
 * Inline keyboard builders for Telegram bot.
 * All button labels should go through i18n t() before being passed here.
 */

import { InlineKeyboard } from 'grammy';

/**
 * Expense confirmation keyboard.
 * [✅ Correct] [📁 Change category] [✏️ Edit] [🏠 Personal]
 */
export function buildConfirmKeyboard(
  expenseId: string,
  labels: { correct: string; changeCategory: string; edit: string; markPersonal: string },
): InlineKeyboard {
  return new InlineKeyboard()
    .text(`✅ ${labels.correct}`, `confirm:${expenseId}`)
    .text(`📁 ${labels.changeCategory}`, `change_cat:${expenseId}`)
    .row()
    .text(`✏️ ${labels.edit}`, `edit:${expenseId}`)
    .text(`🏠 ${labels.markPersonal}`, `personal:${expenseId}`);
}

/**
 * Category selection keyboard (for low-confidence or change).
 */
export function buildCategoryKeyboard(
  expenseId: string,
  categories: { id: string; name: string; confidence?: number }[],
  enterManuallyLabel: string,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const cat of categories.slice(0, 4)) {
    const label = cat.confidence
      ? `${cat.name} (${Math.round(cat.confidence * 100)}%)`
      : cat.name;
    keyboard.text(label, `set_cat:${expenseId}:${cat.id}`).row();
  }

  keyboard.text(`✏️ ${enterManuallyLabel}`, `manual_cat:${expenseId}`);
  return keyboard;
}

/**
 * Proactive message keyboard with one-tap actions.
 */
export function buildProactiveKeyboard(
  actions: { label: string; callbackData: string; row?: boolean }[],
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const action of actions) {
    keyboard.text(action.label, action.callbackData);
    if (action.row) keyboard.row();
  }

  return keyboard;
}

/**
 * Snooze/dismiss keyboard (appended to proactive messages).
 */
export function buildSnoozeKeyboard(
  messageId: string,
  labels: { snoozeTomorrow: string; snoozeNextWeek: string; dismiss: string },
): InlineKeyboard {
  return new InlineKeyboard()
    .text(`⏰ ${labels.snoozeTomorrow}`, `snooze_1d:${messageId}`)
    .text(`📅 ${labels.snoozeNextWeek}`, `snooze_7d:${messageId}`)
    .row()
    .text(`🔕 ${labels.dismiss}`, `dismiss:${messageId}`);
}

/**
 * Invoice follow-up keyboard.
 */
export function buildInvoiceFollowUpKeyboard(
  invoiceId: string,
  labels: { sendReminder: string; wait: string; skip: string },
): InlineKeyboard {
  return new InlineKeyboard()
    .text(`📧 ${labels.sendReminder}`, `send_reminder:${invoiceId}`)
    .text(`⏳ ${labels.wait}`, `wait:${invoiceId}`)
    .text(`⏭️ ${labels.skip}`, `skip:${invoiceId}`);
}
