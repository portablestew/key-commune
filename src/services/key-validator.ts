import { ProviderConfig, ValidationRule } from '../types/config.js';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export class KeyValidator {
  private readonly MIN_KEY_LENGTH = 16;
  private readonly MAX_KEY_LENGTH = 256;

  /**
   * Validate key length
   */
  validateKeyLength(key: string): ValidationResult {
    if (key.length < this.MIN_KEY_LENGTH) {
      return {
        valid: false,
        reason: `Key too short (minimum ${this.MIN_KEY_LENGTH} characters)`,
      };
    }

    if (key.length > this.MAX_KEY_LENGTH) {
      return {
        valid: false,
        reason: `Key too long (maximum ${this.MAX_KEY_LENGTH} characters)`,
      };
    }

    return { valid: true };
  }

  /**
   * Validate request against provider's custom rules
   */
  validateRequest(
    provider: ProviderConfig,
    requestBody: any,
    requestPath: string,
    requestQuery: Record<string, string>
  ): ValidationResult {
    if (!provider.validation) {
      return { valid: true };
    }

    // Handle both ValidationRule[] and ProviderValidation types
    let rules: any[];
    
    if (Array.isArray(provider.validation)) {
      // ValidationRule[] - use directly
      rules = provider.validation;
    } else {
      // ProviderValidation - extract custom_rules if present
      if (!provider.validation.custom_rules || provider.validation.custom_rules.length === 0) {
        return { valid: true };
      }
      rules = provider.validation.custom_rules;
    }

    for (const rule of rules) {
      const result = this.validateRule(rule, requestBody, requestPath, requestQuery);
      if (!result.valid) {
        return result;
      }
    }

    return { valid: true };
  }

  /**
   * Validate a single rule
   */
  private validateRule(
    rule: any,
    requestBody: any,
    requestPath: string,
    requestQuery: Record<string, string>
  ): ValidationResult {
    let value: string | undefined;
    
    // Support both ValidationRule (key/pattern) and CustomValidationRule (json_key/regex)
    const keyName = rule.key || rule.json_key;
    const pattern = rule.pattern || rule.regex;

    switch (rule.type) {
      case 'body-json':
        value = this.getJsonValue(requestBody, keyName);
        break;

      case 'path':
        // Match the entire path against regex pattern
        value = requestPath;
        break;

      case 'query':
        value = requestQuery[keyName];
        break;

      default:
        return {
          valid: false,
          reason: `Unknown validation rule type: ${rule.type}`,
        };
    }

    if (value === undefined || value === null) {
      return {
        valid: false,
        reason: `Missing required ${rule.type} parameter: ${keyName}`,
      };
    }

    // Test against pattern (regex)
    try {
      const regex = new RegExp(pattern);
      if (!regex.test(String(value))) {
        return {
          valid: false,
          reason: `${rule.type} parameter "${keyName}" with value "${value}" does not match regex pattern: ${pattern}`,
        };
      }
    } catch (error) {
      return {
        valid: false,
        reason: `Invalid regex pattern: ${pattern}`,
      };
    }

    return { valid: true };
  }

  /**
   * Get value from JSON body using dot notation
   * Example: "model" or "metadata.user_id"
   */
  private getJsonValue(obj: any, key: string): string | undefined {
    if (!obj) return undefined;

    const keys = key.split('.');
    let value = obj;

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return undefined;
      }
    }

    return value !== undefined && value !== null ? String(value) : undefined;
  }

  /**
   * Validate a key for import (length only)
   */
  validateKeyForImport(key: string): ValidationResult {
    return this.validateKeyLength(key);
  }
}