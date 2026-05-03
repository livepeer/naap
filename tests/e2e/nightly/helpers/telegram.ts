const E2E_CHAT_ID = 555555555;
export const E2E_CHAT = { id: E2E_CHAT_ID };

interface UpdateOptions {
  chatId?: number;
  photo?: { fileId: string; caption?: string };
  callbackData?: string;
}

interface UpdateResult {
  status: number;
  reply: string | undefined;
  captures: Array<{ chatId: number | string; text: string; payload?: any }>;
  data: any;
}

/**
 * Post a synthetic Telegram Update to the bot webhook. Requires
 * E2E_TELEGRAM_CAPTURE=1 to be set on the server (the workflow sets it).
 */
export async function postUpdate(
  text: string,
  options: UpdateOptions = {}
): Promise<UpdateResult> {
  const baseURL = process.env.E2E_BASE_URL || 'https://a3book.brainliber.com';
  const chatId = options.chatId ?? E2E_CHAT_ID;

  const update: any = {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: Math.floor(Math.random() * 1e9),
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: 'private' },
      from: { id: chatId, is_bot: false, first_name: 'E2E' },
    },
  };

  if (options.photo) {
    update.message.photo = [{ file_id: options.photo.fileId, file_size: 1000, width: 100, height: 100 }];
    if (options.photo.caption) update.message.caption = options.photo.caption;
  } else {
    update.message.text = text;
  }

  if (options.callbackData) {
    update.callback_query = {
      id: String(Math.random()),
      from: { id: chatId, is_bot: false, first_name: 'E2E' },
      data: options.callbackData,
      message: { message_id: 0, chat: { id: chatId, type: 'private' } },
    };
  }

  const res = await fetch(`${baseURL}/api/v1/agentbook/telegram/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });

  let data: any = {};
  try { data = await res.json(); } catch { /* */ }

  return {
    status: res.status,
    reply: data?.botReply,
    captures: data?.captured || [],
    data,
  };
}
