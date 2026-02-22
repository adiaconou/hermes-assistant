/**
 * Re-export shared Google OAuth utilities from google-core domain.
 */

export { getAuthenticatedClient, withRetry, isInsufficientScopesError, handleScopeError } from '../../google-core/providers/auth.js';
