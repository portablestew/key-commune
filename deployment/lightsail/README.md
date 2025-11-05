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
4. Select blueprint: **Node.js**
5. Add the optional Launch script (see below)
6. Choose plan: **$5/month minimum recommended** (for production use)
7. Name your instance: `key-commune-app`
8. Click "Create instance"
9. Wait for the instance to start (2-3 minutes)
10. Note the **Public IP address** (e.g., 123.45.67.89)

### Important:
- Your instance will have a dynamic IP that changes if you stop and start it
- DuckDNS will automatically keep your domain pointing to the correct IP

## Section 3: Launch Script

```bash
# Set your DuckDNS credentials
export DUCKDNS_DOMAIN=myapp
export DUCKDNS_TOKEN=abc123def456ghi789

# Download and run setup
sudo apt update && sudo apt install -y git
git clone https://github.com/portablestew/key-commune
cd key-commune
./deployment/lightsail/setup.sh
```

Note: These commands may also be run on the Lightsail instance via SSH (use the browser-based terminal in the Lightsail console).

### Before running:
- Replace `myapp` with your actual DuckDNS subdomain
- Replace `abc123def456ghi789` with your actual DuckDNS token
- Replace the git repository URL with your actual repository

### What happens next:
The setup script will:
1. Install all dependencies and build the application
2. Configure DuckDNS to point to your instance
3. Wait for DNS propagation (may take several minutes)
4. Obtain a free SSL certificate from Let's Encrypt
5. Configure the application for HTTPS
6. Set up automatic updates
7. Start the application with PM2

### After completion:
Your API will be available at: `https://yourdomain.duckdns.org`

## Troubleshooting

### Common Issues:

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