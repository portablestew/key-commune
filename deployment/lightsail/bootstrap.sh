#!/bin/bash
# Bootstrap script for Key-Commune system-level setup
# This script prepares the system and user environment before running setup.sh

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

# Function to validate we're running as root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root"
        exit 1
    fi
    log_success "Running as root"
}

# Function to update system packages
update_system() {
    log_info "Updating system packages..."
    
    apt update
    apt upgrade -y
    
    log_success "System packages updated"
}

# Function to install git
install_git() {
    log_info "Installing git..."
    
    apt install -y git
    
    log_success "Git installed successfully"
}

# Function to create keycommune user
create_user() {
    log_info "Creating keycommune user..."
    
    # Create user if it doesn't exist
    if ! id "keycommune" &>/dev/null; then
        useradd -r -s /bin/false -d /home/keycommune -m keycommune
        log_success "Created keycommune user"
    else
        log_info "Keycommune user already exists"
    fi
    
    # Ensure home directory exists and has correct permissions
    mkdir -p /home/keycommune
    chown keycommune:keycommune /home/keycommune
}

# Function to clone repository
clone_repository() {
    log_info "Cloning Key-Commune repository..."
    
    # Use GITHUB_USERNAME environment variable or default to 'portablestew'
    local github_username="${GITHUB_USERNAME:-portablestew}"
    local repo_url="https://github.com/${github_username}/key-commune.git"
    local target_dir="/home/keycommune/key-commune"
    
    # Check if repository already exists
    if [[ -d "$target_dir/.git" ]]; then
        log_info "Repository already exists, pulling latest changes..."
        (cd "$target_dir" && sudo -u keycommune git pull)
    else
        # Clone as keycommune user
        sudo -u keycommune git clone "$repo_url" "$target_dir"
    fi
    
    # Set proper ownership
    chown -R keycommune:keycommune "$target_dir"
    
    log_success "Repository cloned to $target_dir"
}

# Function to execute setup script
execute_setup() {
    log_info "Executing setup.sh..."
    
    local setup_script="/home/keycommune/key-commune/deployment/lightsail/setup.sh"
    
    if [[ ! -f "$setup_script" ]]; then
        log_error "Setup script not found at $setup_script"
        exit 1
    fi
    
    # Make setup script executable
    chmod +x "$setup_script"
    
    # Execute setup script as root (not keycommune - setup.sh needs root privileges)
    # Environment variables are already inherited from parent shell
    bash "$setup_script"
    
    local setup_exit_code=$?
    
    if [[ $setup_exit_code -eq 0 ]]; then
        log_success "Setup script executed successfully"
    else
        log_error "Setup script failed with exit code $setup_exit_code"
        exit $setup_exit_code
    fi
}

# Function to display usage information
show_usage() {
    echo "Key-Commune Bootstrap Script"
    echo "**See README.md for full instructions.**"
}

# Main bootstrap function
main() {
    echo -e "${BLUE}🚀 Starting Key-Commune Bootstrap${NC}"
    echo
    
    # Check if help was requested
    if [[ "$1" == "--help" || "$1" == "-h" ]]; then
        show_usage
        exit 0
    fi
    
    # Verify running as root
    check_root
    
    # Check environment variables
    check_env_vars
    
    # Step 1: Update system packages
    update_system
    
    # Step 2: Install git
    install_git
    
    # Step 3: Create keycommune user
    create_user
    
    # Step 4: Clone repository
    clone_repository
    
    # Step 5: Execute setup script
    execute_setup
    
    echo
    log_success "🎉 Bootstrap completed successfully!"
    echo
    echo -e "${YELLOW}The setup script will continue the deployment process.${NC}"
    echo -e "${BLUE}Monitor the output above for any issues.${NC}"
}

# Run main function
main "$@"