/**
 * @fileoverview Centralized application configuration.
 *
 * All environment variables are loaded and validated here. This provides
 * a single source of truth for configuration and makes it easy to see
 * what external configuration the application requires.
 *
 * @see .env.example for required environment variables
 */

/**
 * Application configuration loaded from environment variables.
 *
 * @property port - HTTP server port (default: 3000)
 * @property nodeEnv - Runtime environment: 'development' | 'production'
 * @property twilioPhoneNumber - Twilio phone number for sending SMS
 */
const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
};

export default config;
