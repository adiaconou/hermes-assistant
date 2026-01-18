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
});
