import { describe, it, expect } from 'vitest';
import {
  buildConfirmKeyboard,
  buildCategoryKeyboard,
  buildProactiveKeyboard,
  buildSnoozeKeyboard,
} from '../keyboards.js';

// Helper: extract all buttons from an InlineKeyboard instance.
// grammy InlineKeyboard stores rows in .inline_keyboard as arrays of button objects.
function getButtons(keyboard: ReturnType<typeof buildConfirmKeyboard>): Array<{ text: string; callback_data?: string }> {
  // InlineKeyboard from grammy exposes .inline_keyboard as the raw 2D array
  const rows = (keyboard as unknown as { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> }).inline_keyboard;
  return rows.flat();
}

function getRows(keyboard: ReturnType<typeof buildConfirmKeyboard>): Array<Array<{ text: string; callback_data?: string }>> {
  return (keyboard as unknown as { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> }).inline_keyboard;
}

// ---------------------------------------------------------------------------
// buildConfirmKeyboard
// ---------------------------------------------------------------------------
describe('buildConfirmKeyboard', () => {
  const labels = {
    correct: 'Correct',
    changeCategory: 'Change category',
    edit: 'Edit',
    markPersonal: 'Personal',
  };

  it('has 4 buttons with correct callback_data prefixes', () => {
    const kb = buildConfirmKeyboard('exp-1', labels);
    const buttons = getButtons(kb);

    expect(buttons).toHaveLength(4);
    expect(buttons[0].callback_data).toBe('confirm:exp-1');
    expect(buttons[1].callback_data).toBe('change_cat:exp-1');
    expect(buttons[2].callback_data).toBe('edit:exp-1');
    expect(buttons[3].callback_data).toBe('personal:exp-1');
  });

  it('includes emoji prefixes in button text', () => {
    const kb = buildConfirmKeyboard('exp-1', labels);
    const buttons = getButtons(kb);

    expect(buttons[0].text).toContain('Correct');
    expect(buttons[1].text).toContain('Change category');
    expect(buttons[2].text).toContain('Edit');
    expect(buttons[3].text).toContain('Personal');
  });

  it('arranges buttons in 2 rows', () => {
    const kb = buildConfirmKeyboard('exp-1', labels);
    const rows = getRows(kb);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(2);
    expect(rows[1]).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// buildCategoryKeyboard
// ---------------------------------------------------------------------------
describe('buildCategoryKeyboard', () => {
  it('limits to 4 categories plus a manual option', () => {
    const categories = [
      { id: 'cat-1', name: 'Food' },
      { id: 'cat-2', name: 'Travel' },
      { id: 'cat-3', name: 'Software' },
      { id: 'cat-4', name: 'Office' },
      { id: 'cat-5', name: 'Marketing' },
      { id: 'cat-6', name: 'Rent' },
    ];
    const kb = buildCategoryKeyboard('exp-1', categories, 'Enter manually');
    const buttons = getButtons(kb);

    // 4 categories + 1 manual = 5 buttons
    expect(buttons).toHaveLength(5);
    expect(buttons[4].text).toContain('Enter manually');
    expect(buttons[4].callback_data).toBe('manual_cat:exp-1');
  });

  it('shows confidence percentage when provided', () => {
    const categories = [
      { id: 'cat-1', name: 'Food', confidence: 0.92 },
      { id: 'cat-2', name: 'Travel', confidence: 0.75 },
    ];
    const kb = buildCategoryKeyboard('exp-1', categories, 'Enter manually');
    const buttons = getButtons(kb);

    expect(buttons[0].text).toBe('Food (92%)');
    expect(buttons[1].text).toBe('Travel (75%)');
  });

  it('omits confidence when not provided', () => {
    const categories = [
      { id: 'cat-1', name: 'Food' },
    ];
    const kb = buildCategoryKeyboard('exp-1', categories, 'Enter manually');
    const buttons = getButtons(kb);

    expect(buttons[0].text).toBe('Food');
    expect(buttons[0].callback_data).toBe('set_cat:exp-1:cat-1');
  });

  it('uses correct callback_data format', () => {
    const categories = [
      { id: 'meals', name: 'Meals' },
    ];
    const kb = buildCategoryKeyboard('exp-42', categories, 'Other');
    const buttons = getButtons(kb);

    expect(buttons[0].callback_data).toBe('set_cat:exp-42:meals');
  });
});

// ---------------------------------------------------------------------------
// buildProactiveKeyboard
// ---------------------------------------------------------------------------
describe('buildProactiveKeyboard', () => {
  it('creates buttons from actions array', () => {
    const actions = [
      { label: 'Send reminder', callbackData: 'send_reminder:inv-1' },
      { label: 'View details', callbackData: 'view:inv-1' },
    ];
    const kb = buildProactiveKeyboard(actions);
    const buttons = getButtons(kb);

    expect(buttons).toHaveLength(2);
    expect(buttons[0].text).toBe('Send reminder');
    expect(buttons[0].callback_data).toBe('send_reminder:inv-1');
    expect(buttons[1].text).toBe('View details');
    expect(buttons[1].callback_data).toBe('view:inv-1');
  });

  it('respects row breaks', () => {
    const actions = [
      { label: 'A', callbackData: 'a', row: true },
      { label: 'B', callbackData: 'b' },
    ];
    const kb = buildProactiveKeyboard(actions);
    const rows = getRows(kb);

    expect(rows).toHaveLength(2);
    expect(rows[0][0].text).toBe('A');
    expect(rows[1][0].text).toBe('B');
  });

  it('handles empty actions array', () => {
    const kb = buildProactiveKeyboard([]);
    const buttons = getButtons(kb);
    expect(buttons).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildSnoozeKeyboard
// ---------------------------------------------------------------------------
describe('buildSnoozeKeyboard', () => {
  const labels = {
    snoozeTomorrow: 'Tomorrow',
    snoozeNextWeek: 'Next week',
    dismiss: 'Dismiss',
  };

  it('has 3 buttons (tomorrow, next week, dismiss)', () => {
    const kb = buildSnoozeKeyboard('msg-1', labels);
    const buttons = getButtons(kb);

    expect(buttons).toHaveLength(3);
  });

  it('has correct callback_data for each button', () => {
    const kb = buildSnoozeKeyboard('msg-1', labels);
    const buttons = getButtons(kb);

    expect(buttons[0].callback_data).toBe('snooze_1d:msg-1');
    expect(buttons[1].callback_data).toBe('snooze_7d:msg-1');
    expect(buttons[2].callback_data).toBe('dismiss:msg-1');
  });

  it('includes labels in button text', () => {
    const kb = buildSnoozeKeyboard('msg-1', labels);
    const buttons = getButtons(kb);

    expect(buttons[0].text).toContain('Tomorrow');
    expect(buttons[1].text).toContain('Next week');
    expect(buttons[2].text).toContain('Dismiss');
  });

  it('arranges buttons in 2 rows (2 snooze + 1 dismiss)', () => {
    const kb = buildSnoozeKeyboard('msg-1', labels);
    const rows = getRows(kb);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(2); // tomorrow + next week
    expect(rows[1]).toHaveLength(1); // dismiss
  });
});
