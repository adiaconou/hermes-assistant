import { sendSms, sendWhatsApp } from '../../../twilio.js';
import type { MessageChannel } from '../types.js';

export async function sendScheduledMessage(
  phoneNumber: string,
  channel: MessageChannel,
  body: string
): Promise<void> {
  if (channel === 'whatsapp') {
    await sendWhatsApp(phoneNumber, body);
  } else {
    await sendSms(phoneNumber, body);
  }
}
