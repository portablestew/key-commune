#!/bin/bash
# Simplified swap file setup for Key-Commune on AWS Lightsail
set -e

# Check if swap is already configured in fstab
if grep "swap" /etc/fstab; then
    echo "Swap already configured in /etc/fstab"
    swapon /swapfile 2>/dev/null || true
    exit 0
fi

# Create 1GB swap file
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile

# Add to fstab for persistence
echo "/swapfile none swap sw 0 0" | tee -a /etc/fstab

# Activate swap
swapon /swapfile

echo "Swap file created and activated"