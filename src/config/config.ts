import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { AppConfig } from '../types/config.js';
import { AppConfigSchema } from './schema.js';

const ENV_FILE = '.env';
const REQUIRED_ENV_PERMISSIONS = 0o600; // Read/write for owner only

/**
 * Check if .env file has secure permissions
 */
function checkEnvFilePermissions(envPath: string): boolean {
  try {
    const stats = fs.statSync(envPath);
    const currentPerms = stats.mode & 0o777;
    return currentPerms === REQUIRED_ENV_PERMISSIONS;
  } catch (error) {
    return false;
  }
}

/**
 * Securely create .env file with generated encryption key
 */
function createEnvFileWithKey(key: string): void {
  const envPath = path.resolve(process.cwd(), ENV_FILE);
  
  if (fs.existsSync(envPath)) {
    // File exists - check permissions
    if (!checkEnvFilePermissions(envPath)) {
      throw new Error(
        `Security Error: ${ENV_FILE} file exists with incorrect permissions (${ENV_FILE}). ` +
        `Expected permissions: 600 (owner read/write only). ` +
        `Current permissions too permissive. Please fix with: chmod 600 ${ENV_FILE}`
      );
    }
    
    // File exists with correct permissions - check if ENCRYPTION_KEY already exists
    const envContent = fs.readFileSync(envPath, 'utf8');
    if (envContent.includes('ENCRYPTION_KEY=')) {
      return; // Key already exists in file
    }
    
    // File exists but no ENCRYPTION_KEY - append it
    const appendContent = envContent.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(envPath, `${appendContent}ENCRYPTION_KEY=${key}\n`);
    console.log(`Appended ENCRYPTION_KEY to existing ${ENV_FILE} file`);
  } else {
    // File doesn't exist - create it with secure permissions
    fs.writeFileSync(envPath, `ENCRYPTION_KEY=${key}\n`, { mode: REQUIRED_ENV_PERMISSIONS });
    console.log(`Created ${ENV_FILE} file with secure permissions (600)`);
  }
}

// Load environment variables from .env file
dotenv.config();

export function loadConfig(configPath: string): AppConfig {
  // Read YAML file
  const fileContents = fs.readFileSync(configPath, 'utf8');
  const rawConfig = yaml.load(fileContents);
  
  // Validate with Zod
  const config = AppConfigSchema.parse(rawConfig);
  
  // Check environment variable first, then YAML config, then auto-generate
  const encryptionKey = process.env.ENCRYPTION_KEY || config.encryption_key;
  
  if (!encryptionKey) {
    // Generate new encryption key
    const generatedKey = crypto.randomBytes(32).toString('hex');
    
    // Automatically create/update .env file with secure permissions
    try {
      createEnvFileWithKey(generatedKey);
      console.log('Generated encryption key and saved to .env file with secure permissions');
    } catch (error) {
      console.log('Generated encryption key (could not save to .env):', generatedKey);
      console.log('Error details:', error instanceof Error ? error.message : String(error));
      console.log('To manually save the key: echo "ENCRYPTION_KEY=' + generatedKey + '" > .env && chmod 600 .env');
    }
    
    config.encryption_key = generatedKey;
  } else {
    config.encryption_key = encryptionKey;
  }
  
  return config;
}

export function getConfig(): AppConfig {
  const configPath = process.env.CONFIG_PATH || './config/default.yaml';
  return loadConfig(configPath);
}