/**
 * Integration tests for the SMS webhook endpoint.
 *
 * Tests the full request/response cycle using supertest.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockReqRes } from '../helpers/mock-http.js';
import { handleSmsWebhook } from '../../src/routes/sms.js';
import { healthHandler } from '../../src/routes/health.js';
import { createSmsPayload, createWhatsAppPayload, toFormData } from '../fixtures/webhook-payloads.js';
import {
  setMockResponses,
  createTextResponse,
  clearMockState,
} from '../mocks/anthropic.js';
import { getSentMessages, clearSentMessages } from '../mocks/twilio.js';
import { getExpectedTwilioSignature } from 'twilio/lib/webhooks/webhooks.js';

describe('POST /webhook/sms', () => {
  const webhookUrl = 'http://localhost:3000/webhook/sms';
  const authToken = process.env.TWILIO_AUTH_TOKEN || 'test-auth-token';

  function signPayload(payload: Record<string, string>): string {
    return getExpectedTwilioSignature(authToken, webhookUrl, payload);
  }

  beforeEach(() => {
    clearMockState();
    clearSentMessages();
  });

  describe('basic response flow', () => {
    it('should return TwiML with immediate response from classification', async () => {
      // Set up mock to return a simple response (no async work)
      setMockResponses([
        createTextResponse('{"needsAsyncWork": false, "immediateResponse": "Hello!"}'),
      ]);

      const payload = createSmsPayload('Hi');

      const { req, res } = createMockReqRes({
        method: 'POST',
        url: '/webhook/sms',
        headers: { 'x-twilio-signature': signPayload(payload) },
        body: payload,
      });

      await handleSmsWebhook(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/xml');
      expect(res.text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Hello!</Message></Response>');
    });

    it('should not send via Twilio API when no async work needed', async () => {
      // Set up mock for classification (simple response, no async work)
      setMockResponses([
        createTextResponse('{"needsAsyncWork": false, "immediateResponse": "Hi there! How can I help you today?"}'),
      ]);

      const payload = createSmsPayload('Hello!', '+15551234567');

      const { req, res } = createMockReqRes({
        method: 'POST',
        url: '/webhook/sms',
        headers: { 'x-twilio-signature': signPayload(payload) },
        body: payload,
      });

      await handleSmsWebhook(req, res);

      // Give time for any potential async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      // No messages should be sent via Twilio API - response is in TwiML
      const sentMessages = getSentMessages();
      expect(sentMessages.length).toBe(0);
    });
  });

  describe('WhatsApp messages', () => {
    it('should return TwiML response for WhatsApp messages', async () => {
      setMockResponses([
        createTextResponse('{"needsAsyncWork": false, "immediateResponse": "Hello via WhatsApp!"}'),
      ]);

      const payload = createWhatsAppPayload('Hi from WhatsApp', '+15551234567');

      const { req, res } = createMockReqRes({
        method: 'POST',
        url: '/webhook/sms',
        headers: { 'x-twilio-signature': signPayload(payload) },
        body: payload,
      });

      await handleSmsWebhook(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/xml');
      expect(res.text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Hello via WhatsApp!</Message></Response>');
    });

    it('should send async follow-up via WhatsApp API with correct prefix', async () => {
      // The orchestrator architecture makes multiple LLM calls
      setMockResponses([
        // Classification
        createTextResponse('{"needsAsyncWork": true, "immediateResponse": "Working on it!"}'),
        // Planner
        createTextResponse(JSON.stringify({
          analysis: 'User wants something complex',
          goal: 'Handle complex request',
          steps: [{ id: 'step_1', agent: 'general-agent', task: 'Process request' }],
        })),
        // Executor
        createTextResponse('Processed the request.'),
        // Response Composer
        createTextResponse('Here is your WhatsApp response.'),
      ]);

      const payload = createWhatsAppPayload('Create something complex', '+15551234567');

      const { req, res } = createMockReqRes({
        method: 'POST',
        url: '/webhook/sms',
        headers: { 'x-twilio-signature': signPayload(payload) },
        body: payload,
      });

      await handleSmsWebhook(req, res);

      // Wait for async response
      await vi.waitFor(() => {
        const messages = getSentMessages();
        expect(messages.length).toBeGreaterThan(0);
      }, { timeout: 5000 });

      const sentMessages = getSentMessages();
      // WhatsApp messages should have whatsapp: prefix
      expect(sentMessages[0].to).toBe('whatsapp:+15551234567');
      expect(sentMessages[0].from).toContain('whatsapp:');
    });
  });

  describe('async work flow', () => {
    it('should return immediate ack in TwiML and send full response via API', async () => {
      // The new orchestrator architecture makes multiple LLM calls:
      // 1. Classification: determines needsAsyncWork
      // 2. Planner: creates execution plan (expects JSON)
      // 3. Executor: runs agent steps
      // 4. Response Composer: synthesizes final response
      setMockResponses([
        // Classification response
        createTextResponse('{"needsAsyncWork": true, "immediateResponse": "Let me work on that!"}'),
        // Planner response (JSON with plan)
        createTextResponse(JSON.stringify({
          analysis: 'User wants to create a grocery list',
          goal: 'Create grocery list',
          steps: [{ id: 'step_1', agent: 'general-agent', task: 'Create the list' }],
        })),
        // Executor response (general-agent execution)
        createTextResponse('I created your grocery list with common items.'),
        // Response Composer (synthesizes final message)
        createTextResponse('Here is your detailed response with the grocery list!'),
      ]);

      const payload = createSmsPayload('Create a grocery list', '+15559999999');

      const { req, res } = createMockReqRes({
        method: 'POST',
        url: '/webhook/sms',
        headers: { 'x-twilio-signature': signPayload(payload) },
        body: payload,
      });

      await handleSmsWebhook(req, res);

      // Immediate ack should be in TwiML response
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/xml');
      expect(res.text).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Message>Let me work on that!</Message></Response>');

      // Wait for async follow-up message
      await vi.waitFor(() => {
        const messages = getSentMessages();
        expect(messages.length).toBeGreaterThanOrEqual(1);
      }, { timeout: 5000 });

      const sentMessages = getSentMessages();

      // Only the async follow-up goes via Twilio API
      expect(sentMessages[0].body).toContain('grocery list');
      expect(sentMessages[0].to).toBe('+15559999999');
    });
  });

  describe('error handling', () => {
    it('should handle empty message body', async () => {
      setMockResponses([
        createTextResponse('{"needsAsyncWork": false, "immediateResponse": "I received an empty message. How can I help?"}'),
      ]);

      const payload = createSmsPayload('');

      const { req, res } = createMockReqRes({
        method: 'POST',
        url: '/webhook/sms',
        headers: { 'x-twilio-signature': signPayload(payload) },
        body: payload,
      });

      await handleSmsWebhook(req, res);

      // Should return valid TwiML with response message
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/xml');
      expect(res.text).toContain('<Message>');
      expect(res.text).toContain('empty message');
    });

    it('should handle missing From field gracefully', async () => {
      setMockResponses([
        createTextResponse('{"needsAsyncWork": false, "immediateResponse": "Hello!"}'),
      ]);

      const payload = { Body: 'Test message' };
      const { req, res } = createMockReqRes({
        method: 'POST',
        url: '/webhook/sms',
        headers: { 'x-twilio-signature': signPayload(payload) },
        body: payload,
      });

      await handleSmsWebhook(req, res);

      // Should return valid TwiML with message even with missing fields
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/xml');
      expect(res.text).toContain('<Message>Hello!</Message>');
    });
  });
});

describe('GET /health', () => {
  it('should return health status', async () => {
    const { req, res } = createMockReqRes({ method: 'GET', url: '/health' });

    healthHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBeDefined();
    const body = res.body as { status?: string; timestamp?: string };
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });
});
