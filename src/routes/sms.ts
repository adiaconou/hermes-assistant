import { Router, Request, Response } from 'express';

const router = Router();

type TwilioWebhookBody = {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
};

type MessageChannel = 'whatsapp' | 'sms';

function detectChannel(from: string): MessageChannel {
  return from.startsWith('whatsapp:') ? 'whatsapp' : 'sms';
}

function stripPrefix(address: string): string {
  return address.replace('whatsapp:', '');
}

function sanitizePhone(phone: string): string {
  if (phone.length < 4) return '****';
  return '***' + phone.slice(-4);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

router.post('/webhook/sms', (req: Request, res: Response) => {
  const { From, Body } = req.body as TwilioWebhookBody;

  const channel = detectChannel(From || '');
  const sender = stripPrefix(From || '');

  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Message received',
      channel,
      from: sanitizePhone(sender),
      bodyLength: Body?.length || 0,
      timestamp: new Date().toISOString(),
    })
  );

  const responseText = `Got your ${channel} message: "${Body}"`;
  const escapedResponse = escapeXml(responseText);

  res.type('text/xml');
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapedResponse}</Message></Response>`
  );
});

export default router;
