/**
 * @fileoverview Google-core ingress for email-watcher domain.
 *
 * Re-exports shared Google OAuth2 infrastructure from the google-core domain.
 * This is the required `via` path for the email-watcher → google-core cross-domain rule.
 */

export { getAuthenticatedClient, withRetry } from '../../google-core/providers/auth.js';
