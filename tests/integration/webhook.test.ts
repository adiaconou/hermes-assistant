/**
 * Integration tests for the SMS webhook endpoint.
 *
 * Tests the full request/response cycle using supertest.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/app.js';
import { createSmsPayload, createWhatsAppPayload, toFormData } from '../fixtures/webhook-payloads.js';
import {
  setMockResponses,
  createTextResponse,
  clearMockState,
} from '../mocks/anthropic.js';
import { getSentMessages, clearSentMessages } from '../mocks/twilio.js';

describe('POST /webhook/sms', () => {
  const app = createTestApp();

  beforeEach(() => {
    clearMockState();
    clearSentMessages();
  });

  describe('basic response flow', () => {
    it('should return empty TwiML response immediately', async () => {
      // Set up mock to return a simple response
      setMockResponses([
        createTextResponse('{"needsAsyncWork": false, "immediateResponse": "Hello!"}'),
      ]);

      const payload = createSmsPayload('Hi');

      const response = await request(app)
        .post('/webhook/sms')
        .type('form')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.type).toBe('text/xml');
      expect(response.text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    });

    it('should process SMS messages and send response via Twilio API', async () => {
      // Set up mock for classification (simple response, no async work)
      setMockResponses([
        createTextResponse('{"needsAsyncWork": false, "immediateResponse": "Hi there! How can I help you today?"}'),
      ]);

      const payload = createSmsPayload('Hello!', '+15551234567');

      await request(app)
        .post('/webhook/sms')
        .type('form')
        .send(payload);

      // Wait for async processing
      await vi.waitFor(() => {
        const messages = getSentMessages();
        expect(messages.length).toBeGreaterThan(0);
      }, { timeout: 2000 });

      const sentMessages = getSentMessages();
      expect(sentMessages[0].to).toBe('+15551234567');
      expect(sentMessages[0].body).toBe('Hi there! How can I help you today?');
    });
  });

  describe('WhatsApp messages', () => {
    it('should handle WhatsApp messages with whatsapp: prefix', async () => {
      setMockResponses([
        createTextResponse('{"needsAsyncWork": false, "immediateResponse": "Hello via WhatsApp!"}'),
      ]);

      const payload = createWhatsAppPayload('Hi from WhatsApp', '+15551234567');

      await request(app)
        .post('/webhook/sms')
        .type('form')
        .send(payload);

      // Wait for async processing
      await vi.waitFor(() => {
        const messages = getSentMessages();
        expect(messages.length).toBeGreaterThan(0);
      }, { timeout: 2000 });

      const sentMessages = getSentMessages();
      // WhatsApp messages should have whatsapp: prefix
      expect(sentMessages[0].to).toBe('whatsapp:+15551234567');
      expect(sentMessages[0].from).toContain('whatsapp:');
    });
  });

  describe('async work flow', () => {
    it('should send immediate ack then full response for async work', async () => {
      // First call: classification says async work needed
      // Second call: full response generation
      setMockResponses([
        createTextResponse('{"needsAsyncWork": true, "immediateResponse": "Let me work on that!"}'),
        createTextResponse('Here is your detailed response with all the information you requested.'),
      ]);

      const payload = createSmsPayload('Create a grocery list', '+15559999999');

      await request(app)
        .post('/webhook/sms')
        .type('form')
        .send(payload);

      // Wait for both messages to be sent
      await vi.waitFor(() => {
        const messages = getSentMessages();
        expect(messages.length).toBeGreaterThanOrEqual(2);
      }, { timeout: 5000 });

      const sentMessages = getSentMessages();

      // First message is the immediate ack
      expect(sentMessages[0].body).toBe('Let me work on that!');

      // Second message is the full response
      expect(sentMessages[1].body).toContain('detailed response');
    });
  });

  describe('error handling', () => {
    it('should handle empty message body', async () => {
      setMockResponses([
        createTextResponse('{"needsAsyncWork": false, "immediateResponse": "I received an empty message. How can I help?"}'),
      ]);

      const payload = createSmsPayload('');

      const response = await request(app)
        .post('/webhook/sms')
        .type('form')
        .send(payload);

      // Should still return valid TwiML
      expect(response.status).toBe(200);
      expect(response.text).toContain('<Response>');
    });

    it('should handle missing From field gracefully', async () => {
      setMockResponses([
        createTextResponse('{"needsAsyncWork": false, "immediateResponse": "Hello!"}'),
      ]);

      const response = await request(app)
        .post('/webhook/sms')
        .type('form')
        .send({ Body: 'Test message' });

      // Should return valid TwiML even with missing fields
      expect(response.status).toBe(200);
      expect(response.type).toBe('text/xml');
    });
  });
});

describe('GET /health', () => {
  const app = createTestApp();

  it('should return health status', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.timestamp).toBeDefined();
  });
});
