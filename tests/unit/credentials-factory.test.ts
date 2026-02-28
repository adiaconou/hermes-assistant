import { describe, expect, it, vi } from 'vitest';

describe('Credential Store Factory', () => {
  it('throws for invalid CREDENTIAL_STORE_PROVIDER values', async () => {
    vi.resetModules();

    vi.doMock('../../src/config.js', () => ({
      default: {
        credentials: {
          provider: 'invalid-provider',
          sqlitePath: './data/test-credentials.db',
          encryptionKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
      },
    }));

    const { getCredentialStore } = await import('../../src/services/credentials/index.js');

    expect(() => getCredentialStore()).toThrow(
      "Invalid CREDENTIAL_STORE_PROVIDER: invalid-provider. Expected 'sqlite' or 'memory'."
    );
  });
});
