import { describe, it, expect } from 'vitest';
import { KeyValidator } from '../../src/services/key-validator.js';
import { ProviderConfig } from '../../src/types/config.js';

describe('KeyValidator', () => {
  const validator = new KeyValidator();

  describe('validateKeyLength', () => {
    it('should accept valid key length', () => {
      const key = 'a'.repeat(20);
      const result = validator.validateKeyLength(key);
      expect(result.valid).toBe(true);
    });

    it('should reject key too short', () => {
      const key = 'a'.repeat(15);
      const result = validator.validateKeyLength(key);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('too short');
    });

    it('should reject key too long', () => {
      const key = 'a'.repeat(257);
      const result = validator.validateKeyLength(key);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('too long');
    });

    it('should accept minimum length key', () => {
      const key = 'a'.repeat(16);
      const result = validator.validateKeyLength(key);
      expect(result.valid).toBe(true);
    });

    it('should accept maximum length key', () => {
      const key = 'a'.repeat(256);
      const result = validator.validateKeyLength(key);
      expect(result.valid).toBe(true);
    });
  });

  describe('validateRequest', () => {
    it('should pass when no validation rules', () => {
      const provider: ProviderConfig = {
        name: 'test',
        base_url: 'https://api.example.com',
        auth_header: 'Authorization',
        url_patterns: ['*'],
      };
      const result = validator.validateRequest(provider, {}, '/path', {});
      expect(result.valid).toBe(true);
    });

    it('should validate body-json rule with matching pattern', () => {
      const provider: ProviderConfig = {
        name: 'test',
        base_url: 'https://api.example.com',
        auth_header: 'Authorization',
        url_patterns: ['*'],
        validation: [
          {
            type: 'body-json',
            key: 'model',
            pattern: '.+:free$',
          },
        ],
      };
      const body = { model: 'gpt-3.5-turbo:free' };
      const result = validator.validateRequest(provider, body, '/path', {});
      expect(result.valid).toBe(true);
    });

    it('should reject body-json rule with non-matching pattern', () => {
      const provider: ProviderConfig = {
        name: 'test',
        base_url: 'https://api.example.com',
        auth_header: 'Authorization',
        url_patterns: ['*'],
        validation: [
          {
            type: 'body-json',
            key: 'model',
            pattern: '.+:free$',
          },
        ],
      };
      const body = { model: 'gpt-4' };
      const result = validator.validateRequest(provider, body, '/path', {});
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('does not match regex pattern');
    });

    it('should reject when body-json key is missing', () => {
      const provider: ProviderConfig = {
        name: 'test',
        base_url: 'https://api.example.com',
        auth_header: 'Authorization',
        url_patterns: ['*'],
        validation: [
          {
            type: 'body-json',
            key: 'model',
            pattern: '.+',
          },
        ],
      };
      const body = {};
      const result = validator.validateRequest(provider, body, '/path', {});
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Missing required');
    });

    it('should validate nested body-json keys', () => {
      const provider: ProviderConfig = {
        name: 'test',
        base_url: 'https://api.example.com',
        auth_header: 'Authorization',
        url_patterns: ['*'],
        validation: [
          {
            type: 'body-json',
            key: 'metadata.user_id',
            pattern: '^user_\\d+$',
          },
        ],
      };
      const body = { metadata: { user_id: 'user_123' } };
      const result = validator.validateRequest(provider, body, '/path', {});
      expect(result.valid).toBe(true);
    });

    it('should validate path rule', () => {
      const provider: ProviderConfig = {
        name: 'test',
        base_url: 'https://api.example.com',
        auth_header: 'Authorization',
        url_patterns: ['*'],
        validation: [
          {
            type: 'path',
            key: 'path',
            pattern: '^/v1/chat',
          },
        ],
      };
      const result = validator.validateRequest(provider, {}, '/v1/chat/completions', {});
      expect(result.valid).toBe(true);
    });

    it('should validate query rule', () => {
      const provider: ProviderConfig = {
        name: 'test',
        base_url: 'https://api.example.com',
        auth_header: 'Authorization',
        url_patterns: ['*'],
        validation: [
          {
            type: 'query',
            key: 'version',
            pattern: '^v\\d+$',
          },
        ],
      };
      const query = { version: 'v1' };
      const result = validator.validateRequest(provider, {}, '/path', query);
      expect(result.valid).toBe(true);
    });

    it('should handle invalid regex pattern', () => {
      const provider: ProviderConfig = {
        name: 'test',
        base_url: 'https://api.example.com',
        auth_header: 'Authorization',
        url_patterns: ['*'],
        validation: [
          {
            type: 'body-json',
            key: 'model',
            pattern: '[invalid(',
          },
        ],
      };
      const body = { model: 'test' };
      const result = validator.validateRequest(provider, body, '/path', {});
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid regex');
    });
  });

  describe('validateKeyForImport', () => {
    it('should validate key for import', () => {
      const key = 'a'.repeat(20);
      const result = validator.validateKeyForImport(key);
      expect(result.valid).toBe(true);
    });

    it('should reject short key for import', () => {
      const key = 'a'.repeat(10);
      const result = validator.validateKeyForImport(key);
      expect(result.valid).toBe(false);
    });
  });
});