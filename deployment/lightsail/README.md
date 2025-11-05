# AWS Lightsail Deployment Guide

This guide will help you deploy Key-Commune to AWS Lightsail with DuckDNS and Let's Encrypt SSL certificates.

## Section 1: DuckDNS Setup

### What is DuckDNS?
DuckDNS provides free dynamic DNS that automatically updates your IP address. This is perfect for AWS Lightsail instances that don't have static IPs.

### Setup Steps:
1. Go to [duckdns.org](https://duckdns.org)
2. Sign in with your preferred provider (GitHub, Google, Reddit, etc.)
3. Type in a subdomain name and click "Add domain" - remember this for later
4. Note your token from the dashboard - you'll need this for configuration

### Example:
- **Your domain:** `myapp.duckdns.org`
- **Your token:** `abc123def456ghi789` (long random string)

## Section 2: AWS Lightsail Instance

### Setup Steps:
1. Go to [AWS Lightsail Console](https://lightsail.aws.amazon.com)
2. Click "Create instance"
3. Choose platform: **Linux/Unix**
4. Select blueprint: **OS Only** → **Ubuntu 24.04 LTS**
5. Add the optional Launch script (see below)
6. Choose plan: **$5/month minimum recommended** (for production use)
7. Name your instance: `key-commune-app`
8. Click "Create instance"
9. Wait for the instance to start (15+ minutes on small instances)
11. Note the **Public IP address** (e.g., 123.45.67.89)
10. Select the created instance, select "Networking" and open port 443 (add HTTPS)

### After completion:
- Your API will be available at: `https://yourdomain.duckdns.org`
- Test it with your browser or `curl`

### Important:
- Your instance will have a dynamic IP that changes if you stop and start it
- DuckDNS will automatically keep your domain pointing to the correct IP

## Section 3: Launch Script

NOTE:
 - **Substitute correct values** for the environment variables listed below
 - Paste the script into the "Launch script" when creating the AWS Lightsail
 - These commands may instead be run on the Lightsail instance via SSH (use the browser-based terminal in the Lightsail console)

```bash
# Set your DuckDNS credentials
export DUCKDNS_DOMAIN=[!!! my subdomain name]
export DUCKDNS_TOKEN=[!!! abc123def456ghi789]

# Bootstrap deployment
sudo apt install -y curl
curl -sL https://raw.githubusercontent.com/${GITHUB_USERNAME:-portablestew}/key-commune/main/deployment/lightsail/bootstrap.sh | bash
```

### What happens next:
The bootstrap script will:
1. System update, upgrade, and install git
2. Create dedicated keycommune user
3. Clone repository to /home/keycommune/key-commune/
4. Install nodejs, npm, certbot, dnsutils, and swap file
5. Configure DuckDNS
6. Wait for DNS propagation
7. Obtain SSL certificate
8. Build application
9. Setup PM2 and automatic restarts
10. Configure cron jobs for updates and certificate renewal

## Operational Features

- **Dedicated app user**: Application runs as non-root user for security
- **Automatic SSL renewal**: Certificates renew automatically and restart the app
- **Isolated permissions**: App user has minimal required privileges
- **Swap file**: 1GB swap file prevents OOM during installation on small instance types
- **Service management**: PM2 manages application lifecycle

## Troubleshooting

### Common Issues:

**Installation failure**
- SSH onto the host and try again
- `cd /home/keycommune` -- does "key-commune" exist?
  - If not, `sudo su` and paste in the bootstrap command from this page
  - If key-commune exists, try `sudo key-commune/deployment/lightsail/setup.sh`

**DNS not resolving:**
- Wait up to 10 minutes for full propagation
- Check DuckDNS dashboard shows your correct IP
- Run: `dig yourdomain.duckdns.org` to verify

**SSL certificate fails:**
- Ensure port 80 is not blocked
- Check firewall settings in Lightsail console
- Verify DNS resolves before certbot runs

**Application won't start:**
- Check logs: `pm2 logs key-commune`
- Verify all environment variables are set
- Check: `pm2 status`

### Getting Help:
- Check logs: `pm2 logs key-commune`
- View system status: `pm2 status`
- Restart application: `pm2 restart key-commune`
- Stop application: `pm2 stop key-commune`
