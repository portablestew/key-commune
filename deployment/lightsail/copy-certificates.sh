#!/bin/bash
# Certificate copying script for Key-Commune
# Generic script to copy Let's Encrypt certificates to app user directory
# Used both during initial setup and certbot renewal hooks

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get domain from argument (required)
DOMAIN="$1"

if [ -z "$DOMAIN" ]; then
    log_error "Domain not provided. Usage: $0 <domain>"
    exit 1
fi

log_info "Copying certificates for domain: $DOMAIN"

# Check if source certificates exist
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    log_error "Source certificates not found at /etc/letsencrypt/live/$DOMAIN"
    exit 1
fi

# Create SSL directory for app user
mkdir -p /home/keycommune/ssl-certs

# Copy certificates to app user directory
cp -r /etc/letsencrypt/live/$DOMAIN/* /home/keycommune/ssl-certs/

# Set ownership and permissions
chown -R keycommune:keycommune /home/keycommune/ssl-certs
chmod 644 /home/keycommune/ssl-certs/*.pem
chmod 755 /home/keycommune/ssl-certs

log_success "Certificates copied to /home/keycommune/ssl-certs/"

# Restart PM2 if requested or if called from certbot renewal hooks
if [ "${2:-}" = "--restart-pm2" ] || [[ "$0" == *"/letsencrypt/renewal-hooks/"* ]]; then
    log_info "Restarting PM2 application..."
    sudo -u keycommune pm2 restart key-commune
    log_success "PM2 application restarted"
fi