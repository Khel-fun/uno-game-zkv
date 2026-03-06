#!/bin/bash
set -euo pipefail

export PATH="/home/naveen/.foundry/bin:/usr/bin:/bin:/usr/local/bin:$PATH"

cd "/mnt/c/Users/hemav/OneDrive/Desktop/unogame/uno-game copy/contracts"
source .env

echo "=== Deploying to Base Sepolia ==="
echo "RPC: $BASE_SEPOLIA_RPC_URL"

echo ""
echo "--- Deploying ShuffleVerifier ---"
SHUFFLE_OUT=$(forge create --broadcast --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY" "src/verifiers/shuffle_circuitVerifier.sol:ShuffleVerifier" 2>&1)
echo "$SHUFFLE_OUT"
SHUFFLE_ADDR=$(echo "$SHUFFLE_OUT" | grep "Deployed to:" | awk '{print $3}')
echo "ShuffleVerifier: $SHUFFLE_ADDR"

echo ""
echo "--- Deploying DealVerifier ---"
DEAL_OUT=$(forge create --broadcast --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY" "src/verifiers/deal_circuitVerifier.sol:DealVerifier" 2>&1)
echo "$DEAL_OUT"
DEAL_ADDR=$(echo "$DEAL_OUT" | grep "Deployed to:" | awk '{print $3}')
echo "DealVerifier: $DEAL_ADDR"

echo ""
echo "--- Deploying DrawVerifier ---"
DRAW_OUT=$(forge create --broadcast --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY" "src/verifiers/draw_circuitVerifier.sol:DrawVerifier" 2>&1)
echo "$DRAW_OUT"
DRAW_ADDR=$(echo "$DRAW_OUT" | grep "Deployed to:" | awk '{print $3}')
echo "DrawVerifier: $DRAW_ADDR"

echo ""
echo "--- Deploying PlayVerifier ---"
PLAY_OUT=$(forge create --broadcast --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY" "src/verifiers/play_circuitVerifier.sol:PlayVerifier" 2>&1)
echo "$PLAY_OUT"
PLAY_ADDR=$(echo "$PLAY_OUT" | grep "Deployed to:" | awk '{print $3}')
echo "PlayVerifier: $PLAY_ADDR"

echo ""
echo "--- Deploying UnoGame ---"
UNOGAME_OUT=$(forge create --broadcast --rpc-url "$BASE_SEPOLIA_RPC_URL" --private-key "$PRIVATE_KEY" "src/UnoGame.sol:UnoGame" --constructor-args "$SHUFFLE_ADDR" "$DEAL_ADDR" "$DRAW_ADDR" "$PLAY_ADDR" 2>&1)
echo "$UNOGAME_OUT"
UNOGAME_ADDR=$(echo "$UNOGAME_OUT" | grep "Deployed to:" | awk '{print $3}')
echo "UnoGame: $UNOGAME_ADDR"

echo ""
echo "========================================"
echo "  DEPLOYMENT SUMMARY"
echo "  Network: Base Sepolia (84532)"
echo "========================================"
echo "  ShuffleVerifier: $SHUFFLE_ADDR"
echo "  DealVerifier:    $DEAL_ADDR"
echo "  DrawVerifier:    $DRAW_ADDR"
echo "  PlayVerifier:    $PLAY_ADDR"
echo "  UnoGame:         $UNOGAME_ADDR"
echo "========================================"

# Save addresses
cat > deployed_addresses.json <<EOF
{
  "network": "baseSepolia",
  "chainId": 84532,
  "contracts": {
    "shuffleVerifier": "$SHUFFLE_ADDR",
    "dealVerifier": "$DEAL_ADDR",
    "drawVerifier": "$DRAW_ADDR",
    "playVerifier": "$PLAY_ADDR",
    "unoGame": "$UNOGAME_ADDR"
  }
}
EOF
echo "Addresses saved to deployed_addresses.json"
