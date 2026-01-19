/**
 * Test app factory.
 *
 * Creates an Express app instance for integration testing without starting
 * the server or listening on a port.
 */

import express from 'express';
import smsRouter from '../../src/routes/sms.js';
import pagesRouter from '../../src/routes/pages.js';
import authRouter from '../../src/routes/auth.js';

/**
 * Create a test Express app with all routes configured.
 */
export function createTestApp(): express.Application {
  const app = express();

  // Parse URL-encoded bodies (Twilio sends this format)
  app.use(express.urlencoded({ extended: false }));

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // SMS routes
  app.use(smsRouter);

  // Auth routes (OAuth flow)
  app.use(authRouter);

  // Generated UI pages route
  app.use(pagesRouter);

  return app;
}
