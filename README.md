# Key Commune

Key Commune is a proxy server that automatically manages a shared pool of API keys. It provides improved availability and financial isolation.
1. A caller joins the "commune" by making a valid request with a valid API key. This key must uniquely identify the caller.
2. The call is proxied through. On success, the key is considered valid and added to the communal pool. 
3. Each caller continues to make requests using *their own* API key, but each request is load balanced to use a random API key from the pool.

## Use cases
- **Capacity sharing with isolation**: Share underlying API capacity across different customer keys while limiting the impact of noisy neighbors
- **Production redundancy**: Use multiple production keys for load balancing and automatic failover when primary accounts hit limits
- **Traffic spike handling**: Allow requests to utilize capacity across multiple accounts during high-demand periods without manual intervention
- **Seamless key migration**: Gradually transition from one set of API keys to another (e.g., scaling up production capacity) without service disruption
- **Traffic anonymity**: An individual's sequence of calls may be harder to track when spread across a pool of keys. 

## Features

- **Load Balancing**: Distributes requests across a pool of API keys using a best-of-two selection algorithm
- **Isolation Philosophy**: Problem callers are isolated to their own keys without affecting the commune
- **Automatic Key Management**: Keys are validated, tracked, blocked, and removed based on response patterns
- **Security**: Encrypted key storage with SHA-256 hashing for identification
- **Statistics Tracking**: Daily per-key metrics for call counts, throttles, and client subnets

### Key Isolation

API keys are generally shared amongst all callers. However, when an API key is used and fails, it is temporarily blocked/banned from the pool. 
These penalties are configurable, but the defaults are:
- **Auth failure (401)**: Banned for 1 day. After three strikes it is deleted from the pool. 
- **Throttle (429)**: Banned for 1 minute on the first offense. Increasing exponential backoff for consecutive offenses. After 15 consecutive throttles, the key is deleted from the pool. 

If a caller presents a blocked API key, the request is made without load balancing. Their presented key is used as is. However, if the call succeeds, their key is immediately unblocked. 
The result is that callers happily share keys until one exhibits a problem. Then that caller becomes isolated until they demonstrate that their key is still okay. 

## Architecture

Key Commune acts as a reverse proxy between clients and API providers:

```
Client → Key Commune Proxy → API Provider
         (Load Balancing)
```

### Key Selection Algorithm

1. **New keys**: First request uses the presented key directly (no load balancing)
2. **Blocked keys**: Isolated to their own key until successful response (isolation mode)
3. **Available keys**: Load balanced using random best-of-two selection, preferring keys with the least throttles and lowest call count

### State Machine

- **2xx**: Reset all counters and unblock key
- **401**: Block for 1440 minutes, increment auth failures, delete at 3 strikes
- **429**: Block with exponential backoff (2^(n-1) minutes), delete at 15 strikes
- **403**: No penalty (proxy through)
- **5xx**: No penalty (proxy through)

## Prerequisites

- Node.js 20 or higher
- npm or yarn

## Installation

```bash
# Clone repository
git clone https://github.com/yourusername/key-commune.git
cd key-commune

# Install dependencies
npm install

# Build TypeScript
npm run build
```

## Configuration

### 1. Set Encryption Key

Key Commune requires an encryption key for secure API key storage. Create a `.env` file and set the encryption key:
```bash
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" > .env
```

### 2. Configure the application

Key Commune uses a layered configuration approach:

**Default Configuration**: The application loads configuration from `config/default.yaml` which contains default settings and provider configurations.

**Override Configuration**: To customize settings without modifying the defaults, create `config/override.yaml`. This file will be merged with (and override) the defaults.

#### Example: Create a simple override

```bash
# Copy the example override file
cp config/override.yaml.example config/override.yaml
```

Edit `config/override.yaml` to customize only what you need:

```yaml
# Example: Override only the server port
server:
  port: 3000

# Example: Add a custom provider configuration
# providers:
#   - name: openai
#     base_url: https://api.openai.com
#     auth_header: Authorization
#     timeout_ms: 60000
```

**Note**: It's recommended to keep your customizations in `config/override.yaml` rather than modifying `config/default.yaml`, so you can easily update the application without losing your configuration changes.

## Usage

### 1. Import API Keys

Create a file with your API keys (one per line):

```
# keys.txt
sk-test1234567890abcdefghijk
sk-prod9876543210zyxwvutsrqp
```

Import keys:

```bash
npm run import-keys keys.txt
```

**Note**: The import tool enforces the `database.max_keys` limit (default: 200). If the database is at capacity, the import will be rejected. Keys are imported sequentially, and the process stops when the limit is reached.

### 2. Start the Server

```bash
npm start
```

### 3. Make Requests

Send requests to Key Commune with any valid API key in your pool:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer sk-your-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

Key Commune will:
1. Extract and hash your presented key
2. Select the best available key from the pool
3. Forward the request with the selected key
4. Track statistics and update key state based on response

## Development

### Run Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage
```

### Build

```bash
npm run build
```

### Lint & Format

```bash
npm run lint
npm run format
```

## Security Considerations

1. **Bind to localhost**: Default configuration binds to 127.0.0.1 (localhost only)
2. **Encrypted keys**: All keys are encrypted at rest using AES-256-GCM
3. **No admin endpoints**: Keys can only be imported via CLI tool
4. **Client privacy**: IPs tracked as /24 subnets only
5. **Reverse proxy**: Use nginx or similar in production for TLS termination

## Database

Query the SQLite database directly:

```bash
sqlite3 data/keys.db

# List all keys
SELECT id, key_display, blocked_until, consecutive_throttles FROM api_keys;

# View today's stats
SELECT * FROM daily_stats WHERE date = date('now');
```

## Troubleshooting

### Key not being used

- Check if key is blocked: `SELECT * FROM api_keys WHERE blocked_until > unixepoch();`
- Check key hash matches: Ensure presented key matches stored hash

### Key not added to pool

- Check if max_keys limit is reached: `SELECT COUNT(*) FROM api_keys;`
- New keys are rejected when database reaches `database.max_keys` limit (default: 200)
- The request will still succeed, but the key won't be added to the communal pool

### High throttle rate

- Check daily_stats for throttle patterns
- Consider adding more keys to the pool (if under max_keys limit)
- Review provider rate limits

### Database locked errors

- Ensure only one instance is running
- Check file permissions on data directory

### Cannot import keys

- Verify current key count: `SELECT COUNT(*) FROM api_keys;`
- If at max_keys limit, consider:
  - Increasing `database.max_keys` in config
  - Removing unused/blocked keys: `DELETE FROM api_keys WHERE blocked_until > unixepoch() AND last_success_at < unixepoch() - 86400;`

## Deployment

### AWS Lightsail

See: [deployment/lightsail/README.md](deployment/lightsail/README.md)

### Free sample

This example was deployed directly via the AWS Lightsail instructions linked above:
- **https://keycommune.duckdns.org/**

The above endpoint may be used as an OpenAI-compatible API provider. It uses the settings in [config/default.yaml](config/default.yaml). As a free sample, it notably only supports calling free models on OpenRouter. Any caller may use this endpoint with an OpenRouter API key and automatically participate in the commune. 

**Safety disclaimer**
- Create a **unique** OpenRouter API key before attempting to call this sample endpoint
- Set the API key's maximum budget to 0 credits (only allows free calls)
- Key Commune is not responsible for the security/integrity of keys willingly sent to this endpoint
- If in doubt, revoke the API key through OpenRouter

**Roo Code example**

The sample Key Commune is suitable for agentic coding in Roo Code. To try it out:

1. Sign up for OpenRouter and generate a key
    - Create API Key: https://openrouter.ai/settings/keys
        - Name: any string, e.g. "Free Sample"
        - Credit limit: **set to 0**
    - Update privacy settings: https://openrouter.ai/settings/privacy
        - Enable free endpoints that may train on inputs
        - Enable free endpoints that may publish prompts
        - Note: these setings are a necessary compromise to unlock all available free models
2. Open: Roo Code settings -> Providers -> Click `+` to Add Profile
    - Name: any string, e.g. "Key Commune (Public)"
    - API Provider: *OpenAI Compatible*
    - Base URL: *https://keycommune.duckdns.org/*
    - API Key: [copy-paste a unique, 0-budgeted OpenRouter API key here]
    - Model: *tngtech/deepseek-r1t2-chimera:free* (any [popular free model](https://openrouter.ai/models?max_price=0&order=top-weekly))
    - Enable Reasoning Effort: *Medium*
    - Context Window Size: *160000*
    - Image Support: *no*
    - Advanced settings: *Rate limit=3s*

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.
