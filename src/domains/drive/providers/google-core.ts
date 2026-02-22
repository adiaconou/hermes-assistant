/**
 * Re-export shared Google OAuth utilities and Drive folder hierarchy from google-core domain.
 */

export { getAuthenticatedClient, withRetry, isInsufficientScopesError, handleScopeError } from '../../google-core/providers/auth.js';
export { getOrCreateHermesFolder, moveToHermesFolder, searchFiles } from '../../google-core/service/drive-folders.js';
