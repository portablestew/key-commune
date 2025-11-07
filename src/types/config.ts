// Configuration types based on SPEC.md

export interface CustomValidationRule {
  type: 'body-json' | 'path' | 'query';
  json_key: string;
  regex: string;
}

export interface ProviderValidation {
  min_key_length: number;
  max_key_length: number;
  custom_rules?: CustomValidationRule[];
}

export interface ValidationRule {
  type: 'body-json' | 'path' | 'query';
  key: string;
  pattern: string;
}

export interface CacheablePath {
  path: string;
  ttl_seconds: number;
}

export interface ProviderConfig {
  name: string;
  base_url: string;
  timeout_ms?: number;
  auth_header: string;
  cacheable_paths?: CacheablePath[];
  validation?: ValidationRule[] | ProviderValidation;
}

export interface ServerConfig {
  port: number;
  host: string;
  provider?: string;
}

export interface DatabaseConfig {
  path: string;
  max_keys: number;
}

export interface BlockingConfig {
  presented_key_rate_limit_seconds: number;
  auth_failure_block_minutes: number;
  auth_failure_delete_threshold: number;
  throttle_backoff_base_minutes: number;
  throttle_delete_threshold: number;
  throttle_delete_timespan_minutes: number;
}

export interface LoggingConfig {
  level: string;
  key_display: {
    prefix_length: number;
    suffix_length: number;
  };
}

export interface StatsConfig {
  retention_days: number;
  cleanup_interval_minutes: number;
  auto_cleanup: boolean;
  cache_expiry_seconds: number;
}

export interface SSLConfig {
  enabled?: boolean;
  cert_path?: string;
  key_path?: string;
}

export interface AppConfig {
  server: ServerConfig;
  database: DatabaseConfig;
  blocking: BlockingConfig;
  logging: LoggingConfig;
  stats: StatsConfig;
  providers: ProviderConfig[];
  ssl?: SSLConfig;
  encryption_key?: string;
}