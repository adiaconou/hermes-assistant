/**
 * Unit tests for SMS webhook media extraction.
 *
 * Tests the extractMediaAttachments function that parses Twilio webhook
 * body for media attachments from MMS/WhatsApp messages.
 */

import { describe, it, expect } from 'vitest';
import {
  extractMediaAttachments,
  generateMediaDescription,
  buildMessageWithMediaContext,
} from '../../../src/routes/sms.js';

describe('extractMediaAttachments', () => {
  it('should return empty array when NumMedia is 0', () => {
    const body = {
      MessageSid: 'SM123',
      From: '+1234567890',
      To: '+0987654321',
      Body: 'Hello',
      NumMedia: '0',
    };

    const attachments = extractMediaAttachments(body);
    expect(attachments).toEqual([]);
  });

  it('should return empty array when NumMedia is missing', () => {
    const body = {
      MessageSid: 'SM123',
      From: '+1234567890',
      To: '+0987654321',
      Body: 'Hello',
    };

    const attachments = extractMediaAttachments(body);
    expect(attachments).toEqual([]);
  });

  it('should extract single media attachment', () => {
    const body = {
      MessageSid: 'SM123',
      From: '+1234567890',
      To: '+0987654321',
      Body: 'Check this out',
      NumMedia: '1',
      MediaUrl0: 'https://api.twilio.com/media/123',
      MediaContentType0: 'image/jpeg',
    };

    const attachments = extractMediaAttachments(body);
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toEqual({
      url: 'https://api.twilio.com/media/123',
      contentType: 'image/jpeg',
      index: 0,
    });
  });

  it('should extract multiple media attachments', () => {
    const body = {
      MessageSid: 'SM123',
      From: '+1234567890',
      To: '+0987654321',
      Body: 'Multiple images',
      NumMedia: '3',
      MediaUrl0: 'https://api.twilio.com/media/1',
      MediaContentType0: 'image/jpeg',
      MediaUrl1: 'https://api.twilio.com/media/2',
      MediaContentType1: 'image/png',
      MediaUrl2: 'https://api.twilio.com/media/3',
      MediaContentType2: 'application/pdf',
    };

    const attachments = extractMediaAttachments(body);
    expect(attachments).toHaveLength(3);
    expect(attachments[0].index).toBe(0);
    expect(attachments[1].index).toBe(1);
    expect(attachments[2].index).toBe(2);
  });

  it('should handle various content types', () => {
    const body = {
      MessageSid: 'SM123',
      From: '+1234567890',
      To: '+0987654321',
      Body: '',
      NumMedia: '4',
      MediaUrl0: 'https://api.twilio.com/media/1',
      MediaContentType0: 'image/jpeg',
      MediaUrl1: 'https://api.twilio.com/media/2',
      MediaContentType1: 'image/png',
      MediaUrl2: 'https://api.twilio.com/media/3',
      MediaContentType2: 'application/pdf',
      MediaUrl3: 'https://api.twilio.com/media/4',
      MediaContentType3: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };

    const attachments = extractMediaAttachments(body);
    expect(attachments).toHaveLength(4);
    expect(attachments.map(a => a.contentType)).toEqual([
      'image/jpeg',
      'image/png',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
  });

  it('should skip attachments with missing URL', () => {
    const body = {
      MessageSid: 'SM123',
      From: '+1234567890',
      To: '+0987654321',
      Body: '',
      NumMedia: '2',
      MediaUrl0: 'https://api.twilio.com/media/1',
      MediaContentType0: 'image/jpeg',
      // MediaUrl1 missing
      MediaContentType1: 'image/png',
    };

    const attachments = extractMediaAttachments(body);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].url).toBe('https://api.twilio.com/media/1');
  });

  it('should skip attachments with missing content type', () => {
    const body = {
      MessageSid: 'SM123',
      From: '+1234567890',
      To: '+0987654321',
      Body: '',
      NumMedia: '2',
      MediaUrl0: 'https://api.twilio.com/media/1',
      MediaContentType0: 'image/jpeg',
      MediaUrl1: 'https://api.twilio.com/media/2',
      // MediaContentType1 missing
    };

    const attachments = extractMediaAttachments(body);
    expect(attachments).toHaveLength(1);
    expect(attachments[0].url).toBe('https://api.twilio.com/media/1');
  });

  it('should limit to 10 attachments maximum', () => {
    const body: Record<string, string> = {
      MessageSid: 'SM123',
      From: '+1234567890',
      To: '+0987654321',
      Body: '',
      NumMedia: '15',
    };

    // Add 15 attachments
    for (let i = 0; i < 15; i++) {
      body[`MediaUrl${i}`] = `https://api.twilio.com/media/${i}`;
      body[`MediaContentType${i}`] = 'image/jpeg';
    }

    const attachments = extractMediaAttachments(body as any);
    expect(attachments).toHaveLength(10);
  });
});

describe('generateMediaDescription', () => {
  it('should describe a single image', () => {
    const attachments = [
      { url: 'https://example.com/1', contentType: 'image/jpeg', index: 0 },
    ];

    const description = generateMediaDescription(attachments);
    expect(description).toBe('[User sent an image]');
  });

  it('should describe multiple images', () => {
    const attachments = [
      { url: 'https://example.com/1', contentType: 'image/jpeg', index: 0 },
      { url: 'https://example.com/2', contentType: 'image/png', index: 1 },
    ];

    const description = generateMediaDescription(attachments);
    expect(description).toBe('[User sent 2 images]');
  });

  it('should describe a PDF document', () => {
    const attachments = [
      { url: 'https://example.com/1', contentType: 'application/pdf', index: 0 },
    ];

    const description = generateMediaDescription(attachments);
    expect(description).toBe('[User sent an PDF document]');
  });

  it('should describe a Word document', () => {
    const attachments = [
      { url: 'https://example.com/1', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', index: 0 },
    ];

    const description = generateMediaDescription(attachments);
    expect(description).toBe('[User sent an document]');
  });

  it('should describe mixed media types', () => {
    const attachments = [
      { url: 'https://example.com/1', contentType: 'image/jpeg', index: 0 },
      { url: 'https://example.com/2', contentType: 'application/pdf', index: 1 },
    ];

    const description = generateMediaDescription(attachments);
    expect(description).toBe('[User sent an image and an PDF document]');
  });

  it('should describe audio files', () => {
    const attachments = [
      { url: 'https://example.com/1', contentType: 'audio/mpeg', index: 0 },
    ];

    const description = generateMediaDescription(attachments);
    expect(description).toBe('[User sent an audio file]');
  });

  it('should describe video files', () => {
    const attachments = [
      { url: 'https://example.com/1', contentType: 'video/mp4', index: 0 },
    ];

    const description = generateMediaDescription(attachments);
    expect(description).toBe('[User sent an video]');
  });

  it('should describe unknown file types generically', () => {
    const attachments = [
      { url: 'https://example.com/1', contentType: 'application/octet-stream', index: 0 },
    ];

    const description = generateMediaDescription(attachments);
    expect(description).toBe('[User sent an file]');
  });
});

describe('buildMessageWithMediaContext', () => {
  it('returns original text when there are no attachments', () => {
    const result = buildMessageWithMediaContext('Check this', []);
    expect(result).toBe('Check this');
  });

  it('returns media description when text is empty', () => {
    const attachments = [
      { url: 'https://example.com/1', contentType: 'image/jpeg', index: 0 },
    ];
    const result = buildMessageWithMediaContext('', attachments);
    expect(result).toBe('[User sent an image]');
  });

  it('returns media description when text is undefined', () => {
    const attachments = [
      { url: 'https://example.com/1', contentType: 'image/jpeg', index: 0 },
    ];
    const result = buildMessageWithMediaContext(undefined, attachments);
    expect(result).toBe('[User sent an image]');
  });

  it('appends media description when text and attachments are both present', () => {
    const attachments = [
      { url: 'https://example.com/1', contentType: 'image/jpeg', index: 0 },
    ];
    const result = buildMessageWithMediaContext('Analyze this receipt', attachments);
    expect(result).toBe('Analyze this receipt\n\n[User sent an image]');
  });
});
