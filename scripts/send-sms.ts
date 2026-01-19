#!/usr/bin/env npx tsx
/**
 * Local SMS testing CLI.
 *
 * Sends a test message to the local webhook endpoint without needing
 * ngrok, Twilio, or any external services.
 *
 * Usage:
 *   npm run sms "Hello, what can you do?"
 *   npm run sms -- --whatsapp "Hi from WhatsApp"
 *   npm run sms -- --phone "+15551234567" "Test message"
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

interface Options {
  whatsapp: boolean;
  phone: string;
  message: string;
}

function parseArgs(args: string[]): Options {
  const options: Options = {
    whatsapp: false,
    phone: '+15551234567',
    message: '',
  };

  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--whatsapp' || arg === '-w') {
      options.whatsapp = true;
    } else if (arg === '--phone' || arg === '-p') {
      options.phone = args[++i] || options.phone;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  options.message = positional.join(' ');

  return options;
}

function printHelp(): void {
  console.log(`
Local SMS Testing CLI

Usage:
  npm run sms "your message here"
  npm run sms -- --whatsapp "WhatsApp message"
  npm run sms -- --phone "+15559999999" "message"

Options:
  --whatsapp, -w    Send as WhatsApp message (adds whatsapp: prefix)
  --phone, -p       Override sender phone number (default: +15551234567)
  --help, -h        Show this help message

Examples:
  npm run sms "Hello!"
  npm run sms "Create a grocery list for dinner"
  npm run sms -- --whatsapp "Hi from WhatsApp"
  npm run sms -- -p "+15559999999" "Test from different number"
`);
}

async function sendMessage(options: Options): Promise<void> {
  if (!options.message) {
    console.error('Error: No message provided');
    console.error('Usage: npm run sms "your message"');
    process.exit(1);
  }

  const from = options.whatsapp
    ? `whatsapp:${options.phone}`
    : options.phone;

  const to = options.whatsapp
    ? 'whatsapp:+15555550000'
    : '+15555550000';

  const payload = new URLSearchParams({
    MessageSid: `SM${Date.now()}`,
    AccountSid: 'test-account-sid',
    From: from,
    To: to,
    Body: options.message,
    NumMedia: '0',
    NumSegments: '1',
  });

  console.log('----------------------------------------');
  console.log(`Channel: ${options.whatsapp ? 'WhatsApp' : 'SMS'}`);
  console.log(`From: ${from}`);
  console.log(`Message: ${options.message}`);
  console.log('----------------------------------------');
  console.log(`Sending to: ${BASE_URL}/webhook/sms`);
  console.log('');

  try {
    const response = await fetch(`${BASE_URL}/webhook/sms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: payload.toString(),
    });

    const text = await response.text();

    console.log(`Response Status: ${response.status}`);
    console.log(`Response Body: ${text}`);
    console.log('');
    console.log('Check server logs for the full processing output.');

  } catch (error) {
    if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
      console.error('Error: Could not connect to server');
      console.error('Make sure the server is running: npm run dev:server');
    } else {
      console.error('Error:', error instanceof Error ? error.message : error);
    }
    process.exit(1);
  }
}

// Parse arguments (skip node and script path)
const args = process.argv.slice(2);
const options = parseArgs(args);

sendMessage(options);
