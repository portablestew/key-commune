#!/bin/bash
# Automated deployment script for Key-Commune on AWS Lightsail
# This script sets up DuckDNS, Let's Encrypt SSL, and deploys the application

set -e  # Exit on any error

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
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --post-hook 'pm2 restart key-commune'") | crontab -
    
    log_success "Cron jobs installed"
    log_info "DuckDNS updates every 15 minutes"
    log_info "SSL renewal check daily at 3 AM with PM2 restart"
}

# Function to create HTTPS config
create_https_config() {
    log_info "Configuring HTTPS..."
    
    cat > config/override.yaml << EOF
ssl:
  enabled: true
  cert_path: /etc/letsencrypt/live/$DUCKDNS_DOMAIN.duckdns.org/fullchain.pem
  key_path: /etc/letsencrypt/live/$DUCKDNS_DOMAIN.duckdns.org/privkey.pem
server:
  host: 0.0.0.0
  port: 443
EOF
    
    log_success "HTTPS configuration created"
}

# Function to install dependencies
install_dependencies() {
    log_info "Installing dependencies..."
    
    # Create logs directory for PM2
    mkdir -p logs
    chmod 755 logs
    
    # Update system packages
    sudo apt update
    sudo apt upgrade -y
    
    # Install required packages
    sudo apt install -y curl certbot
    
    # Install Node.js dependencies (production only)
    npm install --omit=dev
    
    # Build the application
    npm run build
    
    log_success "Dependencies installed and application built"
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
        return 0
    fi
    
    # Stop any service on port 80 temporarily
    sudo systemctl stop nginx 2>/dev/null || true
    sudo /opt/bitnami/ctlscript.sh stop apache || true
    
    # Run certbot
    sudo certbot certonly \
        --standalone \
        --non-interactive \
        --agree-tos \
        --email admin@$DUCKDNS_DOMAIN.duckdns.org \
        -d $DUCKDNS_DOMAIN.duckdns.org
    
    # Restart nginx if it was running
    sudo systemctl start nginx 2>/dev/null || true
    sudo /opt/bitnami/ctlscript.sh start apache || true
    
    if sudo ls "/etc/letsencrypt/live/$DUCKDNS_DOMAIN.duckdns.org"; then
        log_success "SSL certificate obtained successfully"
    else
        log_error "Failed to obtain SSL certificate"
        exit 1
    fi
}

# Function to setup PM2
setup_pm2() {
    log_info "Setting up PM2 process manager..."
    
    # Install PM2 globally
    sudo npm install -g pm2
    
    # Install pm2-logrotate for log management
    sudo pm2 install pm2-logrotate
    
    # Configure log rotation
    sudo pm2 set pm2-logrotate:max_size 10M
    sudo pm2 set pm2-logrotate:retain 7
    sudo pm2 set pm2-logrotate:compress true
    
    # Stop existing process if running
    pm2 delete key-commune 2>/dev/null || true
    
    # Start the application
    pm2 start dist/index.js --name key-commune
    
    # Save PM2 configuration
    pm2 save
    
    # Setup PM2 startup
    pm2 startup | tail -n1 | bash
    
    log_success "PM2 configured and application started"
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
    
    # Check if port 443 is listening
    if sudo netstat -tlnp | grep -q ":443"; then
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
    cd "$(dirname "$0")/../.."
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
    echo "  • DuckDNS updates every 5 minutes"
    echo "  • SSL renewal checks daily at 3 AM"
    echo "  • Application restarts after SSL renewal"
}

# Run main function
main "$@"