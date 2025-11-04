import { z } from 'zod';

export const ValidationRuleSchema = z.object({
  type: z.enum(['body-json', 'path', 'query']),
  key: z.string(),
  pattern: z.string(),
});

export const CustomValidationRuleSchema = z.object({
  type: z.enum(['body-json', 'path', 'query']),
  json_key: z.string(),
  regex: z.string(),
});

export const ProviderValidationSchema = z.object({
  min_key_length: z.number().min(1).default(16),
  max_key_length: z.number().min(1).default(256),
  custom_rules: z.array(CustomValidationRuleSchema).optional(),
});

export const ProviderConfigSchema = z.object({
  name: z.string(),
  base_url: z.string().url(),
  timeout_ms: z.number().positive().optional().default(60000),
  auth_header: z.string(),
  url_patterns: z.array(z.string()),
  validation: z.union([z.array(ValidationRuleSchema), ProviderValidationSchema]).optional(),
});

export const ServerConfigSchema = z.object({
  port: z.number().min(1).max(65535),
  host: z.string(),
  provider: z.string().optional(),
});

export const DatabaseConfigSchema = z.object({
  path: z.string(),
  max_keys: z.number().positive().default(1000),
});

export const BlockingConfigSchema = z.object({
  presented_key_rate_limit_seconds: z.number().nonnegative().default(1),
  auth_failure_block_minutes: z.number().positive().default(1440),
  auth_failure_delete_threshold: z.number().positive().default(3),
  throttle_backoff_base_minutes: z.number().positive().default(1),
  throttle_delete_threshold: z.number().positive().default(10),
  throttle_delete_timespan_minutes: z.number().positive().default(1440),
});

export const LoggingConfigSchema = z.object({
  level: z.string().default('info'),
  key_display: z.object({
    prefix_length: z.number().positive().default(4),
    suffix_length: z.number().positive().default(4),
  }),
});

export const StatsConfigSchema = z.object({
  retention_days: z.number().positive().default(30),
  cleanup_interval_minutes: z.number().positive().default(60),
  auto_cleanup: z.boolean().default(true),
  cache_expiry_seconds: z.number().positive().default(60),
});

export const AppConfigSchema = z.object({
  server: ServerConfigSchema,
  database: DatabaseConfigSchema,
  blocking: BlockingConfigSchema,
  logging: LoggingConfigSchema,
  stats: StatsConfigSchema,
  providers: z.array(ProviderConfigSchema),
  encryption_key: z.string().optional(),
});