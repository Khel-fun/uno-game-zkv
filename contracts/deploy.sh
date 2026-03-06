#!/bin/bash
# Deploy UNO Game Contracts to Base Sepolia
# Usage: ./deploy.sh
# Required env: PRIVATE_KEY, BASE_SEPOLIA_RPC_URL (optional)
set -euo pipefail

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly NC='\033[0m'

FOUNDRY_BIN="$HOME/.foundry/bin"
export PATH="${FOUNDRY_BIN}:${PATH}"

cd "$(dirname "$0")"

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_success() { echo -e "${GREEN}✅${NC} $1"; }

# Load .env if present
if [ -f .env ]; then
    set -a
    source .env
    set +a
    log_info "Loaded .env file"
fi

# Validate required env
if [ -z "${PRIVATE_KEY:-}" ]; then
    log_error "PRIVATE_KEY environment variable is required"
    exit 1
fi

RPC_URL="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
log_info "RPC URL: $RPC_URL"

# Step 1: Build all contracts
log_info "=== Step 1: Building contracts ==="
forge build
log_success "Build complete"

# Step 2: Deploy each verifier separately (they share library names)
log_info "=== Step 2: Deploying verifiers ==="

deploy_verifier() {
    local contract_path="$1"
    local contract_name="$2"
    
    log_info "Deploying ${contract_name}..."
    
    local output
    output=$(forge create \
        --rpc-url "$RPC_URL" \
        --private-key "$PRIVATE_KEY" \
        "${contract_path}:${contract_name}" \
        2>&1)
    
    local address
    address=$(echo "$output" | grep "Deployed to:" | awk '{print $3}')
    
    if [ -z "$address" ]; then
        log_error "Failed to deploy ${contract_name}"
        echo "$output"
        exit 1
    fi
    
    log_success "${contract_name} deployed at: ${address}"
    echo "$address"
}

SHUFFLE_ADDR=$(deploy_verifier "src/verifiers/shuffle_circuitVerifier.sol" "ShuffleVerifier")
DEAL_ADDR=$(deploy_verifier "src/verifiers/deal_circuitVerifier.sol" "DealVerifier")
DRAW_ADDR=$(deploy_verifier "src/verifiers/draw_circuitVerifier.sol" "DrawVerifier")
PLAY_ADDR=$(deploy_verifier "src/verifiers/play_circuitVerifier.sol" "PlayVerifier")

# Step 3: Update deploy script with verifier addresses and deploy UnoGame
log_info "=== Step 3: Deploying UnoGame contract ==="

# Use forge create for UnoGame too (simpler than updating deploy.s.sol)
log_info "Deploying UnoGame with verifiers..."
UNOGAME_OUTPUT=$(forge create \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    "src/UnoGame.sol:UnoGame" \
    --constructor-args "$SHUFFLE_ADDR" "$DEAL_ADDR" "$DRAW_ADDR" "$PLAY_ADDR" \
    2>&1)

UNOGAME_ADDR=$(echo "$UNOGAME_OUTPUT" | grep "Deployed to:" | awk '{print $3}')

if [ -z "$UNOGAME_ADDR" ]; then
    log_error "Failed to deploy UnoGame"
    echo "$UNOGAME_OUTPUT"
    exit 1
fi

log_success "UnoGame deployed at: ${UNOGAME_ADDR}"

# Step 4: Print summary
echo ""
echo "========================================"
echo "  DEPLOYMENT SUMMARY"
echo "  Network: Base Sepolia (84532)"
echo "  bb: 0.84.0 | Noir: 1.0.0-beta.6"
echo "========================================"
echo "  ShuffleVerifier: ${SHUFFLE_ADDR}"
echo "  DealVerifier:    ${DEAL_ADDR}"
echo "  DrawVerifier:    ${DRAW_ADDR}"
echo "  PlayVerifier:    ${PLAY_ADDR}"
echo "  UnoGame:         ${UNOGAME_ADDR}"
echo "========================================"
echo ""

# Step 5: Save addresses to file
ADDRESSES_FILE="deployed_addresses.json"
cat > "$ADDRESSES_FILE" <<EOF
{
  "network": "baseSepolia",
  "chainId": 84532,
  "contracts": {
    "shuffleVerifier": "${SHUFFLE_ADDR}",
    "dealVerifier": "${DEAL_ADDR}",
    "drawVerifier": "${DRAW_ADDR}",
    "playVerifier": "${PLAY_ADDR}",
    "unoGame": "${UNOGAME_ADDR}"
  },
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

log_success "Addresses saved to ${ADDRESSES_FILE}"
log_info "Update frontend .env and constants with these addresses!"
