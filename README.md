# Key Commune

Key Commune is a proxy server that automatically manages a shared pool of API keys. It provides improved availability and financial isolation.
1. A caller joins the "commune" by making a valid request with a valid API key. This key must uniquely identify the caller.
2. The call is proxied through. On success, the key is considered valid and added to the communal pool. 
3. Each caller continues to make requests using *their own* API key, but each request is load balanced to use another API key from the pool.

## Use cases
- **Capacity sharing with isolation**: Share underlying API capacity across different customer keys while limiting the impact of noisy neighbors
- **Production redundancy**: Use multiple production keys for load balancing and automatic failover when primary accounts hit limits
- **Traffic spike handling**: Allow requests to utilize capacity across multiple accounts during high-demand periods without manual intervention
- **Seamless key migration**: Gradually transition from one set of API keys to another (e.g., scaling up production capacity) without service disruption

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

Key Commune requires an encryption key for secure API key storage. You have two options:

**Option A: Environment Variable (Recommended)**
Create a `.env` file and set the encryption key:
```bash
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" > .env
```

**Option B: YAML Configuration**
Add the encryption key to your `config/default.yaml`:
```yaml
encryption_key: "your-64-character-hex-string-here"
```

### 2. Configure providers in `config/default.yaml`

```yaml
server:
  port: 3000
  host: 127.0.0.1

database:
  path: ./data/keys.db

providers:
  - name: openai
    base_url: https://api.openai.com
    auth_header: Authorization
    url_patterns:
      - /v1/*
    validation:
      - type: body-json
        key: model
        pattern: ^(gpt-4|gpt-4-turbo|gpt-3.5-turbo)

  - name: anthropic
    base_url: https://api.anthropic.com
    auth_header: x-api-key
    url_patterns:
      - /v1/*
```

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

## Deployment

### Using PM2

```bash
# Install PM2 globally
npm install -g pm2

# Start with PM2
pm2 start dist/index.js --name key-commune

# Save PM2 configuration
pm2 save

# Setup auto-restart on system reboot
pm2 startup
```

## Security Considerations

1. **Bind to localhost**: Default configuration binds to 127.0.0.1 (localhost only)
2. **Encrypted keys**: All keys are encrypted at rest using AES-256-GCM
3. **No admin endpoints**: Keys can only be imported via CLI tool
4. **Client privacy**: IPs tracked as /24 subnets only
5. **Reverse proxy**: Use nginx or similar in production for TLS termination

## Monitoring

### Logs

Key Commune uses Pino for structured JSON logging:

```bash
# View logs (if using PM2)
pm2 logs key-commune
```

### Database

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

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.
