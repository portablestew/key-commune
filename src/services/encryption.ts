import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits

export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function encryptKey(key: string, encryptionKey: string): string {
  // Ensure encryption key is 32 bytes
  const keyBuffer = Buffer.from(encryptionKey, 'hex');
  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(`Encryption key must be ${KEY_LENGTH} bytes (64 hex chars)`);
  }
  
  // Generate random IV
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
  
  // Encrypt
  const encrypted = Buffer.concat([
    cipher.update(key, 'utf8'),
    cipher.final(),
  ]);
  
  // Get auth tag
  const authTag = cipher.getAuthTag();
  
  // Return as base64: iv:authTag:encryptedData
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptKey(encryptedKey: string, encryptionKey: string): string {
  // Parse format: iv:authTag:encryptedData
  const parts = encryptedKey.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted key format');
  }
  
  const [ivBase64, authTagBase64, encryptedBase64] = parts;
  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const encrypted = Buffer.from(encryptedBase64, 'base64');
  
  // Ensure encryption key is 32 bytes
  const keyBuffer = Buffer.from(encryptionKey, 'hex');
  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(`Encryption key must be ${KEY_LENGTH} bytes (64 hex chars)`);
  }
  
  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(authTag);
  
  // Decrypt
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  
  return decrypted.toString('utf8');
}

export function generateDisplayKey(key: string): string {
  if (key.length <= 8) {
    // For short keys, just show partial
    return key.substring(0, Math.min(4, key.length)) + '..';
  }
  
  // Standard format: first 4 + .. + last 4
  return key.substring(0, 4) + '..' + key.substring(key.length - 4);
}