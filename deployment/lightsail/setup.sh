#!/bin/bash
# Automated deployment script for Key-Commune on AWS Lightsail
# This script sets up DuckDNS, Let's Encrypt SSL, and deploys the application

set -e  # Exit on any error

# Make helper scripts executable (handles Windows development environment)
chmod +x "$(dirname "$0")/copy-certificates.sh" 2>/dev/null || true
chmod +x "$(dirname "$0")/install-pm2.sh" 2>/dev/null || true

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

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if environment variables are set
check_env_vars() {
    if [[ -z "$DUCKDNS_DOMAIN" || -z "$DUCKDNS_TOKEN" ]]; then
        log_error "Environment variables not set!"
        echo "Please set DUCKDNS_DOMAIN and DUCKDNS_TOKEN before running this script:"
        echo "export DUCKDNS_DOMAIN=yourdomain"
        echo "export DUCKDNS_TOKEN=yourtoken"
        exit 1
    fi
    log_success "Environment variables validated"
}

# Function to get current external IP
get_external_ip() {
    curl -4s ifconfig.me || curl -4s ipecho.net/plain || curl -4s icanhazip.com
}

# Function to wait for DNS propagation
wait_for_dns() {
    log_info "Waiting for DNS propagation for $DUCKDNS_DOMAIN.duckdns.org..."
    
    local timeout=900  # 15 minutes
    local interval=5
    local elapsed=0
    
    while [ $elapsed -lt $timeout ]; do
        local resolved_ip=$(dig +short $DUCKDNS_DOMAIN.duckdns.org 2>/dev/null | tail -n1)
        local current_ip=$(get_external_ip)
        
        if [[ -n "$resolved_ip" && "$resolved_ip" == "$current_ip" ]]; then
            log_success "DNS propagated successfully! Domain points to $resolved_ip"
            return 0
        fi
        
        echo -ne "\r${BLUE}[INFO]${NC} Waiting for DNS... ($elapsed/$timeout seconds)"
        sleep $interval
        elapsed=$((elapsed + interval))
    done
    
    echo
    log_error "DNS propagation timeout after $timeout seconds"
    log_error "Please check your DuckDNS configuration manually"
    exit 1
}

# Function to setup cron jobs
setup_cron() {
    log_info "Setting up automatic updates..."
    
    # Create cron jobs
    (crontab -l 2>/dev/null; echo "*/15 * * * * curl -k 'https://www.duckdns.org/update?domains=$DUCKDNS_DOMAIN&token=$DUCKDNS_TOKEN&ip=' > /dev/null 2>&1") | crontab -
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet") | crontab -
    
    # Setup certbot renewal hook to copy certificates and restart PM2
    # Copy the copy-certificates script verbatim to avoid privilege escalation
    mkdir -p /etc/letsencrypt/renewal-hooks/post
    cp "$(dirname "$0")/copy-certificates.sh" /etc/letsencrypt/renewal-hooks/post/copy-certificates.sh
    chmod +x /etc/letsencrypt/renewal-hooks/post/copy-certificates.sh
    
    # Note: Only copy-certificates.sh is in the renewal hooks directory
    # Certbot will automatically execute it with the domain as $1 argument after successful renewal
    # The script includes PM2 restart logic when certificates are renewed
    log_info "Certificate renewal hook configured at /etc/letsencrypt/renewal-hooks/post/copy-certificates.sh"
    
    log_success "Cron jobs installed"
    log_info "DuckDNS updates every 15 minutes"
    log_info "SSL renewal check daily at 3 AM"
    log_info "Certificate renewal hook configured with PM2 restart"
}

# Function to create HTTPS config
create_https_config() {
    log_info "Configuring HTTPS..."
    
    cat > /home/keycommune/key-commune/config/override.yaml << EOF
ssl:
  enabled: true
  cert_path: /home/keycommune/ssl-certs/fullchain.pem
  key_path: /home/keycommune/ssl-certs/privkey.pem
server:
  host: 0.0.0.0
  port: 443
EOF
    
    # Set proper ownership
    chown keycommune:keycommune /home/keycommune/key-commune/config/override.yaml
    
    log_success "HTTPS configuration created"
}

# Function to install dependencies
install_dependencies() {
    log_info "Installing system dependencies..."
    
    # Install required system packages
    apt update
    apt install -y nodejs npm certbot curl dnsutils
    
    # Install PM2 globally (needed for process management)
    npm install -g pm2
    
    log_success "System dependencies installed"
}

# Function to setup DuckDNS
setup_duckdns() {
    log_info "Updating DuckDNS with current IP..."
    
    local current_ip=$(get_external_ip)
    local duckdns_response=$(curl -k "https://www.duckdns.org/update?domains=$DUCKDNS_DOMAIN&token=$DUCKDNS_TOKEN&ip=" 2>/dev/null)
    
    if [[ "$duckdns_response" == *"OK"* ]]; then
        log_success "DuckDNS updated successfully! IP: $current_ip"
    else
        log_error "DuckDNS update failed. Response: $duckdns_response"
        exit 1
    fi
}

# Function to obtain SSL certificate
setup_ssl() {
    log_info "Obtaining SSL certificate for $DUCKDNS_DOMAIN.duckdns.org..."
    
    # Check if certificate already exists
    if [[ -d "/etc/letsencrypt/live/$DUCKDNS_DOMAIN.duckdns.org" ]]; then
        log_info "SSL certificate already exists, skipping renewal"
        copy_certificates
        return 0
    fi
    
    # Run certbot
    certbot certonly \
        --standalone \
        --non-interactive \
        --agree-tos \
        --email admin@$DUCKDNS_DOMAIN.duckdns.org \
        -d $DUCKDNS_DOMAIN.duckdns.org
    
    if ls "/etc/letsencrypt/live/$DUCKDNS_DOMAIN.duckdns.org" 2>/dev/null; then
        log_success "SSL certificate obtained successfully"
        copy_certificates
    else
        log_error "Failed to obtain SSL certificate"
        exit 1
    fi
}

# Function to copy certificates to app user directory
copy_certificates() {
    log_info "Copying certificates to app user directory..."
    "$(dirname "$0")/copy-certificates.sh" "$DUCKDNS_DOMAIN.duckdns.org"
}

# Function to setup PM2
setup_pm2() {
    log_info "Setting up PM2 process manager for keycommune user..."
    
    # Change to application directory
    cd /home/keycommune/key-commune
    log_info "Working directory: $(pwd)"
    
    # Run PM2 installation and setup as keycommune user
    sudo -u keycommune bash /home/keycommune/key-commune/deployment/lightsail/install-pm2.sh
    
    # Setup PM2 startup (system-level operation)
    log_info "Setting up PM2 startup..."
    pm2 startup systemd -u keycommune --hp /home/keycommune | tail -n1 | bash
    
    log_success "PM2 configured and application started as keycommune user"
}

# Function to verify deployment
verify_deployment() {
    log_info "Verifying deployment..."
    
    # Check if PM2 process is running
    if pm2 list | grep -q "key-commune.*online"; then
        log_success "Application is running"
    else
        log_error "Application is not running"
        pm2 logs key-commune --lines 20
        exit 1
    fi
    
    # Check if port 443 is listening (using ss instead of netstat)
    if ss -tlnp | grep -q ":443"; then
        log_success "HTTPS server is listening on port 443"
    else
        log_warning "HTTPS server may not be listening on port 443"
    fi
}

# Main deployment function
main() {
    echo -e "${BLUE}🚀 Starting Key-Commune Lightsail Deployment${NC}"
    echo
    
    # Check environment variables
    check_env_vars
    
    # Navigate to project directory
    cd /home/keycommune/key-commune
    log_info "Working directory: $(pwd)"
    
    # Step 1: Install dependencies
    install_dependencies
    
    # Step 2: Setup DuckDNS
    setup_duckdns
    
    # Step 3: Wait for DNS propagation
    wait_for_dns
    
    # Step 4: Setup SSL certificate
    setup_ssl
    
    # Step 5: Create HTTPS configuration
    create_https_config
    
    # Step 6: Setup PM2
    setup_pm2
    
    # Step 7: Setup cron jobs
    setup_cron
    
    # Step 8: Verify deployment
    verify_deployment
    
    echo
    log_success "🎉 Deployment complete!"
    echo
    echo -e "${GREEN}Your Key-Commune API is now available at:${NC}"
    echo -e "${BLUE}https://$DUCKDNS_DOMAIN.duckdns.org${NC}"
    echo
    echo -e "${YELLOW}Management commands:${NC}"
    echo "  View logs: pm2 logs key-commune"
    echo "  Restart app: pm2 restart key-commune"
    echo "  Stop app: pm2 stop key-commune"
    echo "  Check status: pm2 status"
    echo "  View cron jobs: crontab -l"
    echo
    echo -e "${YELLOW}Automatic updates are now active:${NC}"
    echo "  • DuckDNS updates every 15 minutes"
    echo "  • SSL renewal checks daily at 3 AM"
    echo "  • Application restarts after SSL renewal"
}

# Run main function
main "$@"