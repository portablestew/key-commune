#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';
import { getDatabase } from '../src/db/database.js';
import { runMigrations } from '../src/db/migrations.js';
import { KeysRepository } from '../src/db/repositories/keys.js';
import { encryptKey, hashKey, generateDisplayKey } from '../src/services/encryption.js';
import { KeyValidator } from '../src/services/key-validator.js';
import { getConfig } from '../src/config/config.js';

/**
 * Import API keys from a file into the database
 * 
 * Usage:
 *   npm run import-keys <file-path>
 *   npm run import-keys keys.txt
 * 
 * File format:
 *   One key per line
 *   Empty lines and lines starting with # are ignored
 */

async function importKeys(filePath: string) {
  try {
    // Load configuration
    const config = getConfig();
    
    if (!config.encryption_key) {
      console.error('ERROR: No encryption key found in configuration');
      process.exit(1);
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error(`ERROR: File not found: ${filePath}`);
      process.exit(1);
    }

    // Read file
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const lines = fileContent.split('\n');

    // Parse keys
    const keys: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      
      keys.push(trimmed);
    }

    console.log(`Found ${keys.length} keys in file`);

    // Initialize database
    const db = getDatabase(config.database.path);
    runMigrations(db);

    const keysRepo = new KeysRepository(db, config.encryption_key);
    const validator = new KeyValidator();

    let imported = 0;
    let skipped = 0;
    let errors = 0;

    // Check current key count
    const currentCount = keysRepo.count();
    const remainingSlots = config.database.max_keys - currentCount;
    
    console.log(`Current keys in database: ${currentCount}/${config.database.max_keys}`);
    console.log(`Available slots: ${remainingSlots}`);
    
    if (remainingSlots <= 0) {
      console.error(`ERROR: Database is at max_keys limit (${config.database.max_keys}). Cannot import more keys.`);
      process.exit(1);
    }
    
    if (keys.length > remainingSlots) {
      console.warn(`WARNING: Only ${remainingSlots} slots available, but ${keys.length} keys provided.`);
      console.warn(`Will attempt to import up to ${remainingSlots} keys.`);
    }

    // Process each key
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const lineNum = i + 1;

      // Validate key
      const validationResult = validator.validateKeyForImport(key);
      if (!validationResult.valid) {
        console.error(`Line ${lineNum}: SKIPPED - ${validationResult.reason}`);
        errors++;
        continue;
      }

      // Hash key
      const keyHash = hashKey(key);

      // Check if key already exists
      const existing = keysRepo.findByHash(keyHash);
      if (existing) {
        console.log(`Line ${lineNum}: SKIPPED - Key already exists (${existing.key_display})`);
        skipped++;
        continue;
      }

      // Check if we've reached max_keys limit
      const currentKeyCount = keysRepo.count();
      if (currentKeyCount >= config.database.max_keys) {
        console.warn(`Line ${lineNum}: SKIPPED - Max keys limit (${config.database.max_keys}) reached`);
        skipped++;
        continue;
      }

      // Create key in database (encryption handled by repository)
      try {
        const display = generateDisplayKey(key);

        // Insert into database (repository handles encryption)
        const apiKey = keysRepo.create(keyHash, key, display);
        console.log(`Line ${lineNum}: IMPORTED - ${display} (ID: ${apiKey.id})`);
        imported++;
      } catch (error: any) {
        console.error(`Line ${lineNum}: ERROR - ${error.message}`);
        errors++;
      }
    }

    // Summary
    console.log('\n--- Import Summary ---');
    console.log(`Total keys in file: ${keys.length}`);
    console.log(`Successfully imported: ${imported}`);
    console.log(`Skipped (already exists): ${skipped}`);
    console.log(`Errors: ${errors}`);

    process.exit(errors > 0 ? 1 : 0);

  } catch (error: any) {
    console.error('FATAL ERROR:', error.message);
    process.exit(1);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: npm run import-keys <file-path>');
  console.error('');
  console.error('Example:');
  console.error('  npm run import-keys keys.txt');
  console.error('');
  console.error('File format:');
  console.error('  One key per line');
  console.error('  Empty lines and lines starting with # are ignored');
  process.exit(1);
}

const filePath = args[0];
importKeys(filePath);