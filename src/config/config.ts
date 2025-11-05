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

/**
 * Deep merge two objects, with override taking precedence
 */
function deepMerge(base: any, override: any): any {
  if (typeof base !== 'object' || base === null) {
    return override !== undefined ? override : base;
  }
  if (typeof override !== 'object' || override === null) {
    return override;
  }
  
  const result = { ...base };
  
  for (const key of Object.keys(override)) {
    if (key in result && typeof result[key] === 'object' && result[key] !== null &&
        typeof override[key] === 'object' && override[key] !== null &&
        !Array.isArray(result[key]) && !Array.isArray(override[key])) {
      result[key] = deepMerge(result[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  
  return result;
}

/**
 * Validate SSL configuration
 */
function validateSSLConfig(config: AppConfig): void {
  if (config.ssl?.enabled) {
    if (!config.ssl.cert_path) {
      throw new Error('SSL is enabled but cert_path is not specified');
    }
    if (!config.ssl.key_path) {
      throw new Error('SSL is enabled but key_path is not specified');
    }
    
    // Check if cert and key files exist and are readable
    const certPath = path.resolve(process.cwd(), config.ssl.cert_path);
    const keyPath = path.resolve(process.cwd(), config.ssl.key_path);
    
    if (!fs.existsSync(certPath)) {
      throw new Error(`SSL certificate file not found: ${certPath}`);
    }
    if (!fs.existsSync(keyPath)) {
      throw new Error(`SSL private key file not found: ${keyPath}`);
    }
    
    try {
      fs.accessSync(certPath, fs.constants.R_OK);
      fs.accessSync(keyPath, fs.constants.R_OK);
    } catch (error) {
      throw new Error(`SSL certificate or key file is not readable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Warn if server.host is 0.0.0.0 but SSL is not enabled
  if (config.server.host === '0.0.0.0' && !config.ssl?.enabled) {
    console.warn('WARNING: Server is bound to 0.0.0.0 (accessible from all interfaces) but SSL is not enabled. This is not recommended for production deployment.');
  }
}

// Load environment variables from .env file
dotenv.config();

export function loadConfig(configPath: string): AppConfig {
  // Read base YAML file
  const baseFileContents = fs.readFileSync(configPath, 'utf8');
  let rawConfig = yaml.load(baseFileContents);
  
  // Load and merge override file if it exists
  const overridePath = configPath.replace('default.yaml', 'override.yaml');
  if (fs.existsSync(overridePath)) {
    console.log(`Loading config override from: ${overridePath}`);
    const overrideFileContents = fs.readFileSync(overridePath, 'utf8');
    const overrideConfig = yaml.load(overrideFileContents);
    rawConfig = deepMerge(rawConfig, overrideConfig);
  }
  
  // Validate with Zod
  const config = AppConfigSchema.parse(rawConfig);
  
  // Validate SSL configuration
  validateSSLConfig(config);
  
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