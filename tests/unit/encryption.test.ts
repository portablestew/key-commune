import { describe, it, expect } from 'vitest';
import { hashKey, encryptKey, decryptKey, generateDisplayKey } from '../../src/services/encryption.js';

describe('Encryption Service', () => {
  const testKey = 'sk-test1234567890abcdefghijk';
  const encryptionKey = 'a'.repeat(64); // 32 bytes in hex

  describe('hashKey', () => {
    it('should generate consistent SHA-256 hash', () => {
      const hash1 = hashKey(testKey);
      const hash2 = hashKey(testKey);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 = 32 bytes = 64 hex chars
    });

    it('should generate different hashes for different keys', () => {
      const hash1 = hashKey('key1');
      const hash2 = hashKey('key2');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('encryptKey / decryptKey', () => {
    it('should encrypt and decrypt successfully', () => {
      const encrypted = encryptKey(testKey, encryptionKey);
      const decrypted = decryptKey(encrypted, encryptionKey);
      expect(decrypted).toBe(testKey);
    });

    it('should produce different encrypted values each time (due to random IV)', () => {
      const encrypted1 = encryptKey(testKey, encryptionKey);
      const encrypted2 = encryptKey(testKey, encryptionKey);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should throw error with wrong encryption key', () => {
      const encrypted = encryptKey(testKey, encryptionKey);
      const wrongKey = 'b'.repeat(64);
      expect(() => decryptKey(encrypted, wrongKey)).toThrow();
    });
  });

  describe('generateDisplayKey', () => {
    it('should generate display format for normal keys', () => {
      const display = generateDisplayKey(testKey);
      expect(display).toBe('sk-t..hijk');
    });

    it('should handle short keys gracefully', () => {
      const display = generateDisplayKey('short');
      expect(display).toBe('shor..');
    });
  });
});