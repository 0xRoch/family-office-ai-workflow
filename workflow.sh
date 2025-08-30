#!/bin/bash

# Family Office AI Workflow
# Orchestrates data collection, analysis, and investment recommendations

set -e  # Exit on error

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$SCRIPT_DIR/data"
REPORTS_DIR="$SCRIPT_DIR/reports"
AGENTS_DIR="$SCRIPT_DIR/agents"

# Date for this run
RUN_DATE=$(date +%Y-%m-%d)
RUN_TIME=$(date +%H-%M-%S)
RUN_ID="$RUN_DATE-$RUN_TIME"

# Create reports directory for this run
REPORT_DIR="$REPORTS_DIR/$RUN_DATE"
mkdir -p "$REPORT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] ✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] ⚠${NC} $1"
}

log_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ✗${NC} $1"
}

# Usage function
usage() {
    cat << EOF
Family Office AI Workflow

USAGE:
    ./workflow.sh [COMMAND]

COMMANDS:
    full        Run complete workflow (default)
    fetch       Data collection only  
    analyze     Analysis only (requires existing data)
    decide      Portfolio optimization only
    setup       Initialize Powens connection
    callback    Process Powens callback URL
    status      Show current portfolio status
    help        Show this help message

EXAMPLES:
    ./workflow.sh              # Full workflow
    ./workflow.sh fetch        # Update positions data
    ./workflow.sh analyze      # Generate equity research reports
    ./workflow.sh status       # Show current positions

EOF
}

# Check dependencies
check_dependencies() {
    log "Checking dependencies..."
    
    # Check if Claude CLI is available
    if ! command -v claude &> /dev/null; then
        log_error "Claude CLI not found. Please install Claude Code."
        exit 1
    fi

    # Check if Node.js is available
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found. This workflow now requires Node.js instead of Python."
        exit 1
    fi
    
    # Check if required directories exist
    for dir in "$DATA_DIR" "$REPORTS_DIR"; do
        if [[ ! -d "$dir" ]]; then
            log_error "Required directory not found: $dir"
            exit 1
        fi
    done
    
    # Check for agents directory (either symlink to .claude/agents or direct)
    if [[ ! -d "$AGENTS_DIR" ]] && [[ ! -d ".claude/agents" ]]; then
        log_error "Agents directory not found. Expected either '$AGENTS_DIR' or '.claude/agents'"
        exit 1
    fi
    
    # Check if required files exist
    if [[ ! -f "$DATA_DIR/positions.json" ]]; then
        log_error "positions.json not found. Run setup first."
        exit 1
    fi
    
    if [[ ! -f "$DATA_DIR/ledger.json" ]]; then
        log_error "ledger.json not found. Run setup first."
        exit 1
    fi
    
    log_success "Dependencies verified"
}

# Check if Powens environment is properly configured
check_powens_config() {
    log "Checking Powens configuration..."
    
    if [[ -z "$POWENS_DOMAIN" || -z "$POWENS_CLIENT_ID" || -z "$POWENS_CLIENT_SECRET" ]]; then
        log_error "Missing Powens environment variables. Please set:"
        echo "  POWENS_DOMAIN=your-domain-sandbox.biapi.pro"
        echo "  POWENS_CLIENT_ID=your_client_id"  
        echo "  POWENS_CLIENT_SECRET=your_client_secret"
        echo "  POWENS_USER_ID=your_user_id (optional for setup)"
        return 1
    fi
    
    log_success "Powens configuration found"
    return 0
}

# Authenticate with Powens API
authenticate_powens() {
    local user_id="${1:-$POWENS_USER_ID}"
    
    if [[ -z "$user_id" ]]; then
        log_error "No user ID provided. Run './workflow.sh setup' first."
        return 1
    fi
    
    log "Authenticating with Powens (User ID: $user_id)..."
    
    # Use /auth/renew for existing users
    local response=$(curl -s -X POST "https://$POWENS_DOMAIN/2.0/auth/renew" \
        -H "Content-Type: application/json" \
        -d "{\"client_id\": \"$POWENS_CLIENT_ID\", \"client_secret\": \"$POWENS_CLIENT_SECRET\", \"id_user\": $user_id}")
    
    if echo "$response" | grep -q "access_token"; then
        ACCESS_TOKEN=$(echo "$response" | jq -r '.access_token')
        log_success "Authentication successful"
        return 0
    else
        local error_code=$(echo "$response" | jq -r '.code // "unknown"')
        local error_description=$(echo "$response" | jq -r '.description // "Unknown error"')
        
        case "$error_code" in
            "noSuchUser")
                log_error "User ID $user_id not found in Powens system"
                log "This means either:"
                log "  1. The user connection was never completed, or"
                log "  2. The User ID in .env is incorrect"
                log "💡 Solution: Complete the connection flow to get the correct User ID"
                ;;
            *)
                log_error "Authentication failed [$error_code]: $error_description"
                log "Check your Powens credentials in .env file"
                ;;
        esac
        return 1
    fi
}

# Check if user has connected accounts
check_connected_accounts() {
    local user_id="${1:-$POWENS_USER_ID}"
    
    log "Checking connected accounts for user $user_id..."
    
    local accounts_response=$(curl -s -X GET "https://$POWENS_DOMAIN/2.0/users/$user_id/accounts" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json")
    
    local account_count=$(echo "$accounts_response" | jq -r '.accounts | length')
    
    if [[ "$account_count" -gt 0 ]]; then
        log_success "Found $account_count connected accounts"
        return 0
    else
        local error_code=$(echo "$accounts_response" | jq -r '.code // empty')
        if [[ "$error_code" == "noAccount" ]]; then
            log_warning "No bank accounts connected for user $user_id"
        else
            log_warning "No connected accounts found"
        fi
        return 1
    fi
}

# Wait for Powens data to be ready after connection
wait_for_data_ready() {
    local user_id="${1:-$POWENS_USER_ID}"
    local max_wait=300  # 5 minutes maximum
    local wait_time=10  # Start with 10 seconds
    local elapsed=0
    
    log "Waiting for bank data synchronization..."
    log "This may take a few minutes as Powens fetches your latest data..."
    
    while [[ $elapsed -lt $max_wait ]]; do
        # Check if investments data is available
        local investments_response=$(curl -s -X GET "https://$POWENS_DOMAIN/2.0/users/$user_id/investments" \
            -H "Authorization: Bearer $ACCESS_TOKEN" \
            -H "Content-Type: application/json" 2>/dev/null)
        
        # Check for actual investment data (not just empty response)
        local investment_count=$(echo "$investments_response" | jq -r '.investments | length // 0' 2>/dev/null || echo "0")
        local total_valuation=$(echo "$investments_response" | jq -r '.valuation // 0' 2>/dev/null || echo "0")
        
        if [[ "$investment_count" -gt 0 ]] && [[ "$total_valuation" != "0" ]]; then
            log_success "Data ready! Found $investment_count investments with total valuation: €$total_valuation"
            return 0
        fi
        
        # Show progress
        log "Still synchronizing data... ($elapsed/${max_wait}s) - next check in ${wait_time}s"
        
        sleep "$wait_time"
        elapsed=$((elapsed + wait_time))
        
        # Exponential backoff - increase wait time gradually
        if [[ $wait_time -lt 30 ]]; then
            wait_time=$((wait_time + 5))
        fi
    done
    
    log_warning "Data synchronization timeout after ${max_wait}s"
    log "This is normal for first-time connections. Data may still be synchronizing."
    log "You can try running './workflow.sh fetch' again in a few minutes."
    return 1
}

# Start temporary callback server to catch Powens redirect
start_callback_server() {
    local port=3000
    local callback_file="/tmp/powens_callback.txt"
    
    # Clean up any existing callback file
    rm -f "$callback_file"
    
    log "Starting callback server on port $port..."
    
    # Create a simple HTTP server that captures the callback and shuts down
    cat > "/tmp/callback_server.py" << 'EOF'
#!/usr/bin/env python3
import http.server
import socketserver
import urllib.parse
import sys
import os

class CallbackHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if '/powens/callback' in self.path:
            # Parse the callback URL parameters
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            
            # Extract connection_id and user_id if present
            callback_data = {
                'full_url': self.path,
                'connection_id': params.get('connection_id', [''])[0],
                'user_id': params.get('user_id', [''])[0],
                'code': params.get('code', [''])[0]
            }
            
            # Write callback data to file
            with open('/tmp/powens_callback.txt', 'w') as f:
                for key, value in callback_data.items():
                    f.write(f"{key}={value}\n")
            
            # Send success response
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            
            html_response = f"""
            <html><body>
            <h2>✅ Bank Connection Successful!</h2>
            <p>Connection ID: <strong>{callback_data['connection_id']}</strong></p>
            <p>You can close this window and return to the terminal.</p>
            <script>setTimeout(() => window.close(), 3000);</script>
            </body></html>
            """
            self.wfile.write(html_response.encode())
            
            # Signal server to shut down
            os._exit(0)
        else:
            self.send_response(404)
            self.end_headers()

with socketserver.TCPServer(("", 3000), CallbackHandler) as httpd:
    print("Callback server listening on port 3000...")
    httpd.serve_forever()
EOF

    # Start the callback server in background with output redirected
    python3 "/tmp/callback_server.py" > /tmp/callback_server.log 2>&1 &
    local server_pid=$!
    
    # Wait a moment for server to start
    sleep 2
    
    # Verify server is running
    if kill -0 $server_pid 2>/dev/null; then
        log_success "Callback server started with PID: $server_pid"
    else
        log_error "Failed to start callback server"
        return 1
    fi
    
    echo $server_pid
}

# Stop callback server and extract results
stop_callback_server() {
    local server_pid=$1
    local callback_file="/tmp/powens_callback.txt"
    local timeout=3600  # 1 hour
    local elapsed=0
    
    log "Waiting for bank connection (timeout: ${timeout}s)..."
    
    # Wait for callback or timeout
    while [[ ! -f "$callback_file" && $elapsed -lt $timeout ]]; do
        sleep 2
        elapsed=$((elapsed + 2))
        
        # Show progress every 30 seconds
        if [[ $((elapsed % 30)) -eq 0 ]]; then
            log "Still waiting... ($elapsed/${timeout}s)"
        fi
    done
    
    # Kill the server
    kill $server_pid 2>/dev/null || true
    pkill -f "callback_server.py" 2>/dev/null || true
    
    if [[ -f "$callback_file" ]]; then
        # Extract callback data
        local connection_id=$(grep "connection_id=" "$callback_file" | cut -d'=' -f2)
        local user_id=$(grep "user_id=" "$callback_file" | cut -d'=' -f2)
        local full_url=$(grep "full_url=" "$callback_file" | cut -d'=' -f2-)
        
        log_success "Callback received! Connection ID: $connection_id"
        
        # Update .env with new user_id if provided
        if [[ -n "$user_id" && "$user_id" != "" ]]; then
            log_success "Updating .env with User ID: $user_id"
            if grep -q "POWENS_USER_ID=" .env; then
                sed -i.bak "s/POWENS_USER_ID=.*/POWENS_USER_ID=$user_id/" .env
            else
                echo "POWENS_USER_ID=$user_id" >> .env
            fi
            export POWENS_USER_ID="$user_id"
        else
            log_warning "No user_id in callback, you may need to extract it manually"
            log "Full callback URL: $full_url"
        fi
        
        # Clean up
        rm -f "$callback_file" "/tmp/callback_server.py"
        return 0
    else
        log_error "Timeout waiting for bank connection"
        rm -f "/tmp/callback_server.py"
        return 1
    fi
}

# Prompt user to connect accounts via Webview with auto-callback
connect_accounts() {
    log "Setting up account connection..."
    
    # Ensure we have a valid user
    if ! create_user_if_needed; then
        log_error "Failed to setup Powens user for connection"
        return 1
    fi
    
    local user_id="$POWENS_USER_ID"
    log "Connecting accounts for user ID: $user_id"
    
    # Get temporary code for existing user
    log "Generating temporary code for user $user_id..."
    local temp_code=$(get_temporary_code "$user_id")
    if [[ -z "$temp_code" ]]; then
        log_error "Failed to generate temporary code for user connection"
        return 1
    fi
    log_success "Got temporary code for user association"
    
    # Generate correct Webview URL with temporary code (associates connection with existing user)
    local connect_url="https://webview.powens.com/connect?domain=$POWENS_DOMAIN&client_id=$POWENS_CLIENT_ID&redirect_uri=http://localhost:3000/powens/callback&connector_capabilities=bankwealth&code=$temp_code"
    
    echo ""
    echo "🏦 CONNECT YOUR BANK ACCOUNTS"
    echo "=============================="
    echo ""
    echo "To fetch your financial data, you need to connect your bank accounts."
    echo ""
    
    # Start automatic callback server
    log "Starting callback server..."
    local server_pid=$(start_callback_server)
    
    if [[ -z "$server_pid" ]]; then
        log_error "Failed to get callback server PID"
        return 1
    fi
    
    log "Callback server running with PID: $server_pid"
    
    # Auto-open URL in default browser
    log "Opening connection page in your browser..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        log "Detected macOS, using 'open' command"
        open "$connect_url" && log_success "Browser opened successfully" || log_warning "Failed to open browser"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        log "Detected Linux, using 'xdg-open' command"
        xdg-open "$connect_url" 2>/dev/null && log_success "Browser opened successfully" || log_warning "Failed to open browser"
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        # Windows
        log "Detected Windows, using 'start' command"
        cmd.exe /c start "$connect_url" && log_success "Browser opened successfully" || log_warning "Failed to open browser"
    else
        log_warning "Auto-open not supported on this platform: $OSTYPE"
    fi
    
    echo ""
    echo "If the browser didn't open automatically, copy this URL:"
    echo "   $connect_url"
    echo ""
    echo "Then:"
    echo "1. Select your French banks (BNP Paribas, Crédit Agricole, etc.)"
    echo "2. Enter your banking credentials securely"
    echo "3. Complete the connection process"
    echo ""
    echo "🤖 The callback will be captured automatically - no need to copy URLs!"
    echo ""
    
    # Wait for automatic callback
    if stop_callback_server $server_pid; then
        log_success "Connection completed automatically!"
        
        # Reload environment to get updated POWENS_USER_ID
        [[ -f .env ]] && source .env
        
        # Verify connection with new user_id
        if authenticate_powens "$POWENS_USER_ID" && check_connected_accounts "$POWENS_USER_ID"; then
            log_success "Accounts successfully connected and verified!"
            
            # Wait for data to be ready
            if wait_for_data_ready "$POWENS_USER_ID"; then
                log_success "Bank data synchronization complete!"
            else
                log_warning "Data synchronization is still in progress"
                log "You can run './workflow.sh fetch' later to get the data"
            fi
            return 0
        else
            log_warning "Connection captured but verification failed - may need manual setup"
            return 1
        fi
    else
        log_error "Automatic callback failed or timed out"
        log "You can still process the callback manually with:"
        log "  ./workflow.sh callback '<your-callback-url>'"
        return 1
    fi
}

# Data fetching phase using OpenBanking agent
fetch_data() {
    log "Starting data collection phase..."
    
    # Log workflow start
    echo "Starting workflow run: $RUN_ID" >> "$DATA_DIR/workflow.log"
    
    # Load environment
    [[ -f .env ]] && source .env
    
    # Check if TypeScript/Node.js implementation exists
    if [[ ! -f "$SCRIPT_DIR/dist/openbanking-fetcher.js" ]]; then
        log_error "OpenBanking fetcher not found: $SCRIPT_DIR/dist/openbanking-fetcher.js"
        log "Run 'npm run build' first"
        return 1
    fi

    # Check configuration
    if ! check_powens_config; then
        return 1
    fi

    # Use OpenBanking fetcher agent (with intelligent change detection and proper ledger updates)
    log "Launching OpenBanking fetcher agent..."

    if node "$SCRIPT_DIR/dist/openbanking-fetcher.js" fetch; then
        log_success "Data collection completed via OpenBanking agent"
        return 0
    else
        log_error "OpenBanking agent failed, falling back to legacy method"
        return fetch_data_legacy
    fi
}

# Legacy data fetching phase (backup)
fetch_data_legacy() {
    log "Starting legacy data collection phase..."
    
    # Ensure we have a valid user
    if ! create_user_if_needed; then
        log_error "Failed to setup Powens user"
        return 1
    fi
    
    # Authenticate
    if ! authenticate_powens; then
        log_error "Authentication failed with User ID: $POWENS_USER_ID"
        log "Opening connection window to re-establish connection..."
        connect_accounts
        log_error "Workflow stopped. Please complete bank connection and run workflow again."
        return 1  
    fi
    
    # Check for connected accounts
    if ! check_connected_accounts; then
        log_error "No bank accounts connected for User ID: $POWENS_USER_ID"
        log "This usually means the connection process wasn't completed."
        return 1
    fi
    
    # Check if data is ready before fetching
    log "Verifying data availability..."
    if ! wait_for_data_ready; then
        log_warning "Investment data may still be synchronizing"
        log "Proceeding with fetch anyway - some data may be available"
    fi
    
    # Fetch account data
    log "Fetching account balances..."
    local accounts_data=$(curl -s -X GET "https://$POWENS_DOMAIN/2.0/users/$POWENS_USER_ID/accounts" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json")
    
    # Fetch investments if available
    log "Fetching investment data..."
    local investments_data=$(curl -s -X GET "https://$POWENS_DOMAIN/2.0/users/$POWENS_USER_ID/investments" \
        -H "Authorization: Bearer $ACCESS_TOKEN" \
        -H "Content-Type: application/json" 2>/dev/null || echo '{}')
    
    # Transform and save data
    log "Processing and saving data..."
    
    # Create temporary JSON for processing
    cat > "/tmp/powens_data.json" << EOF
{
    "accounts": $accounts_data,
    "investments": $investments_data,
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
    
    # Transform to positions.json format
    transform_powens_data "/tmp/powens_data.json" "$DATA_DIR/positions.json"
    
    # Log the operation (basic logging for legacy method)
    log_to_ledger "data_collection" "completed" "Fetched data from Powens API (legacy method)"
    
    log_success "Data collection completed (legacy method)"
    return 0
}

# Transform Powens data to our internal format
transform_powens_data() {
    local input_file="$1"
    local output_file="$2"
    
    log "Transforming Powens data to internal format..."
    
    # Extract and categorize investments by asset type
    local all_investments=$(jq '[.investments.investments[] | select(.code_type == "ISIN" and .code != "XX-liquidity" and .valuation > 0) | {
        symbol: (if .stock_symbol then .stock_symbol else .code end),
        name: .label,
        shares: .quantity,
        currentPrice: .unitvalue,
        marketValue: .valuation,
        costBasis: (.quantity * .unitprice),
        unrealizedGainLoss: .diff,
        account: (.id_account | tostring),
        sector: "Unknown",
        currency: "EUR",
        isin: .code,
        lastUpdated: .vdate
    }]' "$input_file")
    
    # Intelligent categorization using configuration files
    local classification_file="data/asset_classification.json"
    local manual_overrides="data/manual_classifications.json"
    
    # Load classification rules
    if [[ ! -f "$classification_file" ]]; then
        echo "Warning: $classification_file not found, using fallback categorization"
        # Fallback to basic categorization
        local equities=$(echo "$all_investments" | jq '[.[] | select(.isin | test("^FR0000"))]')
        local funds=$(echo "$all_investments" | jq '[.[] | select(.name | test("ETF|INDEX|Pilotage|Sélection|Gestion"; "i"))]')
        local real_estate=$(echo "$all_investments" | jq '[.[] | select(.name | test("SCPI|Pierre|Immo"; "i"))]')
        local private_equity=$(echo "$all_investments" | jq '[.[] | select(.name | test("EURAZEO|Private|PRV|VAL"; "i"))]')
        local private_debt=$(echo "$all_investments" | jq '[.[] | select(.name | test("TUDI|Holding|144"; "i"))]')
        local bonds=$(echo "$all_investments" | jq '[]')
        local cash=$(echo "$all_investments" | jq '[]')
        local crowdfunding=$(echo "$all_investments" | jq '[]')
    else
        # Use smart categorization
        local categories=("equities" "funds" "real_estate" "private_equity" "private_debt" "bonds" "cash" "crowdfunding")
        
        # First pass: Apply manual overrides to create exclusion lists
        local manually_classified_isins=""
        if [[ -f "$manual_overrides" ]]; then
            manually_classified_isins=$(jq -r '.classifications | keys[]' "$manual_overrides" 2>/dev/null | paste -sd'|' -)
        fi
        
        for category in "${categories[@]}"; do
            # Build JQ filter for this category
            local name_patterns=$(jq -r ".patterns.$category.name_patterns[]?" "$classification_file" 2>/dev/null | sed 's/.*/(&)/' | paste -sd'|' -)
            local isin_patterns=$(jq -r ".patterns.$category.isin_patterns[]?" "$classification_file" 2>/dev/null | sed 's/.*/(&)/' | paste -sd'|' -)
            
            local jq_filter='false'  # Start with false, add OR conditions
            
            # PRIORITY 1: Apply manual overrides first
            if [[ -f "$manual_overrides" ]]; then
                local manual_isins=$(jq -r ".classifications | to_entries[] | select(.value.category == \"$category\") | .key" "$manual_overrides" 2>/dev/null | paste -sd'|' -)
                if [[ -n "$manual_isins" ]]; then
                    jq_filter="$jq_filter or (.isin | test(\"^($manual_isins)$\"))"
                fi
            fi
            
            # PRIORITY 2: Apply patterns, but exclude manually classified items
            local pattern_filter='false'
            if [[ -n "$name_patterns" ]]; then
                pattern_filter="$pattern_filter or (.name | test(\"$name_patterns\"; \"i\"))"
            fi
            if [[ -n "$isin_patterns" ]]; then
                pattern_filter="$pattern_filter or (.isin | test(\"$isin_patterns\"))"
            fi
            
            # Only apply pattern matching to non-manually-classified assets
            if [[ -n "$manually_classified_isins" && "$pattern_filter" != "false" ]]; then
                jq_filter="$jq_filter or (($pattern_filter) and (.isin | test(\"^($manually_classified_isins)$\") | not))"
            elif [[ "$pattern_filter" != "false" ]]; then
                jq_filter="$jq_filter or ($pattern_filter)"
            fi
            
            # Create the filtered array
            local filtered_investments=$(echo "$all_investments" | jq "[.[] | select($jq_filter)]")
            declare "$category=$filtered_investments"
        done
    fi
    
    # Create the final JSON structure
    cat > "$output_file" << EOF
{
    "lastUpdated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "totalNetWorth": $(jq -r '.investments.valuation // .accounts.balance // 0' "$input_file"),
    "accounts": $(jq -r '.accounts.accounts // []' "$input_file"),
    "positions": {
        "equities": $equities,
        "funds": $funds,
        "bonds": $bonds,
        "cash": $cash,
        "private_equity": $private_equity,
        "private_debt": $private_debt,
        "real_estate": $real_estate,
        "crowdfunding": $crowdfunding
    }
}
EOF
    
    local equity_count=$(echo "$equities" | jq 'length')
    local fund_count=$(echo "$funds" | jq 'length')
    local real_estate_count=$(echo "$real_estate" | jq 'length')
    local private_equity_count=$(echo "$private_equity" | jq 'length')
    local private_debt_count=$(echo "$private_debt" | jq 'length')
    local bonds_count=$(echo "$bonds" | jq 'length')
    local cash_count=$(echo "$cash" | jq 'length')
    local crowdfunding_count=$(echo "$crowdfunding" | jq 'length')
    
    log_success "Data categorized: $equity_count equities, $fund_count funds, $bonds_count bonds, $cash_count cash, $private_equity_count private equity, $private_debt_count private debt, $real_estate_count real estate, $crowdfunding_count crowdfunding"
}

# Log operation to ledger
log_to_ledger() {
    local phase="$1"
    local status="$2" 
    local message="$3"
    
    # Create new entry
    local new_entry=$(cat << EOF
    {
        "id": "workflow-$RUN_ID",
        "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
        "duration": 0,
        "phase": "$phase",
        "status": "$status",
        "errors": [],
        "summary": {
            "positionsAnalyzed": 0,
            "recommendationsGenerated": 0,
            "totalPortfolioValue": 0,
            "changeFromLastRun": 0
        },
        "notes": "$message"
    }
EOF
    )
    
    # Update ledger.json by inserting new entry into entries array
    if [[ -f "$DATA_DIR/ledger.json" ]]; then
        # Use jq to properly append to the entries array
        jq --argjson entry "$new_entry" '.entries += [$entry]' "$DATA_DIR/ledger.json" > "$DATA_DIR/ledger.tmp" && mv "$DATA_DIR/ledger.tmp" "$DATA_DIR/ledger.json"
    fi
    
    # Also log to text file for debugging
    echo "Workflow: $RUN_ID | $phase | $status | $message" >> "$DATA_DIR/workflow.log"
}

# Generate temporary code for existing user to use in webview
get_temporary_code() {
    local user_id="${1:-$POWENS_USER_ID}"
    
    if [[ -z "$user_id" ]]; then
        log_error "No user ID provided for temporary code generation"
        return 1
    fi
    
    # Get temporary code for existing user via auth/renew
    local response=$(curl -s -X POST "https://$POWENS_DOMAIN/2.0/auth/renew" \
        -H "Content-Type: application/json" \
        -d "{\"client_id\": \"$POWENS_CLIENT_ID\", \"client_secret\": \"$POWENS_CLIENT_SECRET\", \"id_user\": $user_id}")
    
    local temp_code=$(echo "$response" | jq -r '.access_token')
    
    if [[ "$temp_code" == "null" || -z "$temp_code" ]]; then
        log_error "Failed to get temporary code for user $user_id"
        return 1
    fi
    
    echo "$temp_code"
    return 0
}

# Create a new user only if we don't have one
create_user_if_needed() {
    # Load environment
    [[ -f .env ]] && source .env
    
    # Check if we already have a valid user ID
    if [[ -n "$POWENS_USER_ID" ]]; then
        log "Checking existing user ID: $POWENS_USER_ID"
        if authenticate_powens "$POWENS_USER_ID"; then
            log_success "Using existing user ID: $POWENS_USER_ID"
            return 0
        else
            log_warning "Existing user ID $POWENS_USER_ID is invalid, creating new user..."
        fi
    fi
    
    # Create new user only if needed
    log "Creating new Powens user (one-time setup)..."
    local auth_response=$(curl -s -X POST "https://$POWENS_DOMAIN/2.0/auth/init" \
        -H "Content-Type: application/json" \
        -d "{\"client_id\": \"$POWENS_CLIENT_ID\", \"client_secret\": \"$POWENS_CLIENT_SECRET\"}")
    
    local new_user_id=$(echo "$auth_response" | jq -r '.id_user')
    
    if [[ "$new_user_id" == "null" || -z "$new_user_id" ]]; then
        log_error "Failed to create user: $(echo "$auth_response" | jq -r '.description // .error')"
        return 1
    fi
    
    log_success "Created user ID: $new_user_id"
    
    # Update .env with new user ID
    if grep -q "POWENS_USER_ID=" .env; then
        sed -i.bak "s/POWENS_USER_ID=.*/POWENS_USER_ID=$new_user_id/" .env
    else
        echo "POWENS_USER_ID=$new_user_id" >> .env
    fi
    
    export POWENS_USER_ID="$new_user_id"
    log_success "Updated .env with user ID: $new_user_id"
    
    return 0
}

# Setup Powens connection for first-time users
setup_powens_connection() {
    log "Setting up Powens connection..."
    
    # Check if configuration exists
    if ! check_powens_config; then
        log_error "Please configure your .env file first with Powens credentials"
        return 1
    fi
    
    # Create user if needed
    if ! create_user_if_needed; then
        return 1
    fi
    
    # Prompt user to connect accounts
    connect_accounts
}

# Process Powens callback
process_callback() {
    local callback_url="$1"
    
    if [[ -z "$callback_url" ]]; then
        log_error "Please provide the callback URL. Usage: ./workflow.sh callback <url>"
        echo "Example: ./workflow.sh callback 'http://localhost:3000/powens/callback?connection_id=6&code=...'"
        return 1
    fi
    
    log "Processing Powens callback..."
    
    # Extract connection_id and code from URL
    local connection_id=$(echo "$callback_url" | sed -n 's/.*connection_id=\([^&]*\).*/\1/p')
    local code=$(echo "$callback_url" | sed -n 's/.*code=\([^&]*\).*/\1/p')
    
    if [[ -z "$connection_id" || -z "$code" ]]; then
        log_error "Could not extract connection_id or code from callback URL"
        return 1
    fi
    
    log "Extracted: connection_id=$connection_id"
    
    # Load environment
    [[ -f .env ]] && source .env
    
    # Check configuration
    if ! check_powens_config; then
        return 1
    fi
    
    # Use existing user or create if needed (but prefer existing)
    if ! create_user_if_needed; then
        log_error "Failed to setup user for callback processing"
        return 1
    fi
    
    local user_id="$POWENS_USER_ID"
    log "Using user ID: $user_id for connection callback"
    
    # Save connection state
    cat > ".powens_state" << EOF
{
    "user_id": $user_id,
    "connection_id": $connection_id,
    "code": "$code",
    "connected": true,
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
    
    log_success "Callback processed successfully!"
    log "Bank connection added to existing user ID: $user_id"
    log "Connection state saved to .powens_state"
    
    # Test the connection
    log "Testing connection..."
    if authenticate_powens "$user_id"; then
        if check_connected_accounts "$user_id"; then
            log_success "Connection verified! You can now run './workflow.sh fetch'"
            
            # Optionally wait for data to be ready
            log "Checking if investment data is ready..."
            if wait_for_data_ready "$user_id"; then
                log_success "Investment data is ready! You can now run the full workflow."
            else
                log_warning "Investment data may still be synchronizing in the background"
                log "You can run './workflow.sh fetch' now or wait a few minutes"
            fi
        else
            log_warning "Connection processed but accounts not yet visible. This may take a few moments."
        fi
    fi
}

# Analysis phase with parallel processing
analyze_positions() {
    log "Starting analysis phase..."
    
    # Extract all positions from positions.json (equities, funds, private equity, private debt, real estate)
    local equities=$(jq -r '.positions.equities[].symbol' "$DATA_DIR/positions.json" 2>/dev/null || echo "")
    local funds=$(jq -r '.positions.funds[].symbol' "$DATA_DIR/positions.json" 2>/dev/null || echo "")
    local private_equity=$(jq -r '.positions.private_equity[].symbol' "$DATA_DIR/positions.json" 2>/dev/null || echo "")
    local private_debt=$(jq -r '.positions.private_debt[].symbol' "$DATA_DIR/positions.json" 2>/dev/null || echo "")
    local real_estate=$(jq -r '.positions.real_estate[].symbol' "$DATA_DIR/positions.json" 2>/dev/null || echo "")
    
    # Combine all positions for analysis
    local all_positions="$equities $funds $private_equity $private_debt $real_estate"
    
    if [[ -z "$all_positions" ]]; then
        log_warning "No positions found to analyze"
        echo "Skipping analysis - no positions to analyze" > "$REPORT_DIR/analysis.log"
        return 0
    fi
    
    local total_count=$(echo "$all_positions" | wc -w)
    local equity_count=$(echo "$equities" | wc -w)
    local fund_count=$(echo "$funds" | wc -w)
    local pe_count=$(echo "$private_equity" | wc -w)
    local pd_count=$(echo "$private_debt" | wc -w)
    local re_count=$(echo "$real_estate" | wc -w)
    
    log "Found $total_count positions: $equity_count equities, $fund_count funds, $pe_count private equity, $pd_count private debt, $re_count real estate"
    
    # Create analysis request directory
    local request_dir="/tmp/portfolio_analysis_$$"
    mkdir -p "$request_dir"
    
    # Generate analysis requests for ALL positions in parallel
    local analyzed_count=0
    for symbol in $all_positions; do
        ((analyzed_count++))
        
        # Get position details from all categories
        local position_data=$(jq "(.positions.equities + .positions.funds + .positions.private_equity + .positions.private_debt + .positions.real_estate)[] | select(.symbol == \"$symbol\")" "$DATA_DIR/positions.json")
        
        # Use jq to properly escape JSON values to avoid control character issues
        local escaped_json=$(echo "$position_data" | jq '{
            symbol: .symbol,
            name: .name,
            shares: .shares,
            currentPrice: .currentPrice,
            marketValue: .marketValue,
            costBasis: .costBasis,
            unrealizedGainLoss: .unrealizedGainLoss,
            analysisRequest: "Generate comprehensive analysis with BUY/HOLD/SELL recommendation, price target, and risk assessment using appropriate specialist agent. Save report to reports/'$RUN_DATE'/\(.symbol).md"
        }')
        
        # Write properly escaped JSON
        echo "$escaped_json" > "$request_dir/analyze_${symbol}.json"
    done
    
    # Create master analysis instruction file
    cat > "$request_dir/analysis_instruction.txt" << EOF
PARALLEL EQUITY ANALYSIS REQUEST

Total positions to analyze: $total_count
Request directory: $request_dir
Report directory: $REPORT_DIR

INSTRUCTIONS:
1. Launch equity-research-analyst agent for EACH JSON file in $request_dir
2. Process ALL positions in PARALLEL (not sequential)
3. Use current 2025 market data for each analysis
4. Generate individual reports in $REPORT_DIR/[SYMBOL].md
5. Each report should include: BUY/HOLD/SELL recommendation, price target, risk assessment

REQUEST FILES: $(ls "$request_dir"/analyze_*.json | wc -l) positions ready for parallel analysis
EOF
    
    log "✓ Generated $analyzed_count analysis requests for parallel processing"
    log "Request files in: $request_dir"
    log "Reports will be saved to: $REPORT_DIR"
    
    # Launch parallel analysis orchestrator
    log "Starting parallel analysis orchestrator..."
    if command -v node >/dev/null 2>&1; then
        node dist/analyze-orchestrator.js "$request_dir" "$REPORT_DIR" "${BATCH_SIZE:-5}"
    else
        log_warning "Node.js not found - falling back to manual instructions"
        echo "PARALLEL ANALYSIS READY: $total_count positions prepared for equity-research-analyst agents" > "$REPORT_DIR/analysis.log"
        echo "Request directory: $request_dir" >> "$REPORT_DIR/analysis.log"
        log "Next: Use Claude Code to process all analysis requests in parallel"
    fi
    
    log_success "Analysis orchestrator complete - ready for parallel execution"
}

# Portfolio value validation function
validate_portfolio_value() {
    log "🔍 Validating portfolio value calculation..."

    # Find latest analysis data directory
    local latest_analysis_dir=$(find /tmp -maxdepth 1 -name "portfolio_analysis_*" -type d | sort | tail -1)

    if [[ -z "$latest_analysis_dir" ]]; then
        log_warning "No analysis data directory found for validation"
        return 1
    fi

    # Calculate portfolio value from analysis files
    local calculated_value=$(find "$latest_analysis_dir" -name "analyze_*.json" -exec jq -r '.marketValue' {} \; 2>/dev/null | awk '{sum += $1} END {print (sum ? sum : 0)}')

    if [[ -z "$calculated_value" || "$calculated_value" == "0" ]]; then
        log_error "❌ Portfolio value validation failed - no valid analysis data"
        return 1
    fi

    # Validate against positions.json if available
    if [[ -f "$DATA_DIR/positions.json" ]]; then
        local positions_value=$(jq -r '[.. | select(type == "object" and has("marketValue")) | .marketValue] | add // 0' "$DATA_DIR/positions.json" 2>/dev/null)

        if [[ -n "$positions_value" && "$positions_value" != "0" ]]; then
            local diff=$(echo "$calculated_value - $positions_value" | bc -l 2>/dev/null || echo "0")
            local abs_diff=$(echo "${diff#-}" | bc -l 2>/dev/null || echo "0")
            local tolerance=1000 # €1,000 tolerance

            if (( $(echo "$abs_diff > $tolerance" | bc -l 2>/dev/null || echo "0") )); then
                log_warning "⚠️  Portfolio value discrepancy detected:"
                log_warning "   Analysis data: €$(printf "%.0f" "$calculated_value")"
                log_warning "   Positions data: €$(printf "%.0f" "$positions_value")"
                log_warning "   Difference: €$(printf "%.0f" "$abs_diff")"
            else
                log_success "✅ Portfolio value validation passed"
                log_success "   Verified value: €$(printf "%.0f" "$calculated_value")"
            fi
        fi
    fi

    # Store validated value for use by orchestrator
    echo "$calculated_value" > "/tmp/validated_portfolio_value.txt"
    log_success "Portfolio value validation complete: €$(printf "%.0f" "$calculated_value")"

    return 0
}

# Portfolio optimization phase
optimize_portfolio() {
    log "Starting portfolio optimization phase..."

    # First validate portfolio value
    if ! validate_portfolio_value; then
        log_error "Portfolio value validation failed - proceeding with caution"
    fi

    # Check if analysis reports exist
    if [[ ! -d "$REPORT_DIR" ]]; then
        log_error "No analysis reports found. Run analysis phase first."
        return 1
    fi

    local report_count=$(find "$REPORT_DIR" -name "*.md" -not -name "portfolio.md" | wc -l)
    if [[ $report_count -eq 0 ]]; then
        log_error "No individual analysis reports found. Run analysis phase first."
        return 1
    fi
    
    log "Found $report_count individual analysis reports"
    log "Launching portfolio optimization agent..."
    
    # Create temporary portfolio optimization request
    local optimization_dir="/tmp/portfolio_optimization_$$"
    mkdir -p "$optimization_dir"
    
    # Create comprehensive optimization request
    cat > "$optimization_dir/optimization_request.json" << EOF
{
    "task": "portfolio_optimization",
    "data_sources": {
        "positions": "$DATA_DIR/positions.json",
        "reports_directory": "$REPORT_DIR",
        "output_report": "$REPORT_DIR/portfolio.md"
    },
    "optimization_rules": {
        "anti_overtrading_threshold": 0.05,
        "max_position_size": 0.15,
        "min_position_size": 0.005,
        "target_cash_reserve": 0.10,
        "rebalancing_frequency": "quarterly"
    },
    "family_office_principles": [
        "Long-term wealth preservation",
        "Tax efficiency optimization",
        "Geographic diversification",
        "Sector diversification",
        "Cost minimization",
        "Risk-adjusted returns"
    ]
}
EOF

    # Launch Node.js orchestrator for portfolio optimization
    log "Executing portfolio optimization orchestrator..."
    if node "$SCRIPT_DIR/dist/portfolio-orchestrator.js" "$optimization_dir/optimization_request.json"; then
        log_success "Portfolio optimization completed successfully"
        if [[ -f "$REPORT_DIR/portfolio.md" ]]; then
            log "Portfolio report generated: $REPORT_DIR/portfolio.md"
        else
            log_warning "Portfolio report not found at expected location"
        fi
    else
        log_error "Portfolio optimization failed"
        return 1
    fi
    
    # Clean up temporary files
    rm -rf "$optimization_dir"
}

# Display portfolio status
show_status() {
    log "Current Portfolio Status"
    echo "========================"
    
    if [[ -f "$DATA_DIR/positions.json" ]]; then
        local last_updated=$(jq -r '.lastUpdated // "Never"' "$DATA_DIR/positions.json")
        local total_worth=$(jq -r '.totalNetWorth // 0' "$DATA_DIR/positions.json")
        local equity_count=$(jq -r '.positions.equities | length' "$DATA_DIR/positions.json" 2>/dev/null || echo "0")
        
        echo "Last Updated: $last_updated"
        echo "Total Net Worth: \$$(printf "%'.0f" $total_worth 2>/dev/null || echo $total_worth)"
        echo "Equity Positions: $equity_count"
        
        if [[ $equity_count -gt 0 ]]; then
            echo ""
            echo "Equity Holdings:"
            jq -r '.positions.equities[] | "  \(.symbol): \(.shares) shares @ $\(.currentPrice) = $\(.marketValue)"' "$DATA_DIR/positions.json" 2>/dev/null || echo "  Error reading positions"
        fi
    else
        log_warning "No position data found"
    fi
    
    echo ""
    echo "Recent Reports:"
    find "$REPORTS_DIR" -name "*.md" -mtime -7 | head -5 | while read report; do
        echo "  $(basename "$report" .md): $(dirname "$report" | xargs basename)"
    done
}

# Main execution
main() {
    local command="${1:-full}"
    
    case "$command" in
        "full"|"")
            check_dependencies
            if fetch_data && analyze_positions && optimize_portfolio; then
                log_success "Full workflow completed. Reports saved to: $REPORT_DIR"
            else
                log_error "Workflow failed. Check the error messages above."
                exit 1
            fi
            ;;
        "fetch")
            check_dependencies
            fetch_data || exit 1
            ;;
        "analyze")
            check_dependencies
            analyze_positions
            ;;
        "decide")
            check_dependencies
            optimize_portfolio
            ;;
        "setup")
            setup_powens_connection
            ;;
        "callback")
            process_callback "$2"
            ;;
        "status")
            show_status
            ;;
        "help"|"-h"|"--help")
            usage
            ;;
        *)
            echo "Unknown command: $command"
            usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"