/**
 * @fileoverview Express server entry point for the Hermes SMS Assistant.
 *
 * This module bootstraps the Express application, configures middleware,
 * and mounts route handlers. In Phase 1 (current), it serves as a simple
 * echo server to prove the SMS pipeline works end-to-end.
 *
 * @see docs/phase-1-requirements.md for Phase 1 specification
 */

import express from 'express';
import config from './config.js';
import smsRouter from './routes/sms.js';
import pagesRouter from './routes/pages.js';
import authRouter from './routes/auth.js';

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

// OAuth routes
app.use(authRouter);

// Generated UI pages route
app.use(pagesRouter);

app.listen(config.port, () => {
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Server started',
      port: config.port,
      env: config.nodeEnv,
      timestamp: new Date().toISOString(),
    })
  );

  // Debug: Log presence of critical env vars (not values)
  console.log(
    JSON.stringify({
      level: 'info',
      message: 'Config check',
      hasCredentialEncryptionKey: !!config.credentials.encryptionKey,
      credentialEncryptionKeyLength: config.credentials.encryptionKey?.length ?? 0,
      hasGoogleClientId: !!config.google.clientId,
      hasGoogleClientSecret: !!config.google.clientSecret,
      googleRedirectUri: config.google.redirectUri,
      baseUrl: config.baseUrl,
      timestamp: new Date().toISOString(),
    })
  );
});
