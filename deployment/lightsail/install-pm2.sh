#!/bin/bash
# PM2 setup script for Key-Commune (runs as keycommune user)
# This script is invoked by setup.sh with: sudo -u keycommune bash install-pm2.sh

set -e

# Change to application directory
cd "$(dirname "$0")/../.."

# Create logs directory for PM2 (owned by keycommune user)
mkdir -p logs
chmod 755 logs

# Install Node.js dependencies (production only)
echo "Installing Node.js dependencies..."
npm install --omit=dev

# Build the application
echo "Building the application..."
npm run build

# Install pm2-logrotate for log management
pm2 install pm2-logrotate

# Configure log rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true

echo "Application ready, now starting with PM2..."

# Stop existing process if running
pm2 delete key-commune 2>/dev/null || true

# Start the application
pm2 start dist/index.js --name key-commune

# Save PM2 configuration
pm2 save

# Display status
echo "PM2 Status:"
pm2 list