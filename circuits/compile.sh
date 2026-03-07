#!/bin/bash
# ZK UNO Circuit Build Pipeline
# Compatible with Noir 1.0.0-beta.6, bb 0.84.0, zkVerify UltraHonk
set -euo pipefail

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly NC='\033[0m'

readonly NOIR_VERSION="1.0.0-beta.6"
readonly BB_VERSION="0.84.0"

NARGO_BIN="$HOME/.nargo/bin"
BB_BIN="$HOME/.bb"
export PATH="${NARGO_BIN}:${BB_BIN}:${PATH}"

cd "$(dirname "$0")"

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Verify tool versions
verify_versions() {
    log_info "Checking tool versions..."
    local nargo_ver=$(nargo --version 2>/dev/null || echo "not found")
    local bb_ver=$(bb --version 2>/dev/null || echo "not found")
    echo "  nargo: $nargo_ver"
    echo "  bb:    $bb_ver"
}

# Step 1: Compile all circuits
compile_circuits() {
    log_info "=== Step 1: Compiling all circuits ==="
    nargo compile --workspace
    log_info "Compilation complete"
}

# Step 2: Generate verification keys (UltraHonk for zkVerify)
generate_vks() {
    log_info "=== Step 2: Generating verification keys (UltraHonk) ==="
    mkdir -p target

    for circuit in shuffle_circuit deal_circuit draw_circuit play_circuit; do
        if [ -f "target/${circuit}.json" ]; then
            log_info "Generating VK for ${circuit}..."
            bb write_vk -b "target/${circuit}.json" -o "target/${circuit}_vk" -s ultra_honk --oracle_hash keccak
        else
            log_error "target/${circuit}.json not found!"
        fi
    done
}

# Step 3: Convert VK to hex for zkVerify registration
convert_vk_to_hex() {
    log_info "=== Step 3: Converting VK to hex for zkVerify ==="
    mkdir -p target/hex

    for circuit in shuffle_circuit deal_circuit draw_circuit play_circuit; do
        local vk_path="target/${circuit}_vk/vk"
        if [ -f "$vk_path" ]; then
            local hex_content=$(xxd -p "$vk_path" | tr -d '\n')
            echo "0x${hex_content}" > "target/hex/${circuit}_vk.hex"
            log_info "VK hex saved: target/hex/${circuit}_vk.hex"
        else
            log_warn "VK not found for ${circuit}"
        fi
    done
}

# Step 4: Generate Solidity verifiers (optional, for on-chain verification)
generate_solidity_verifiers() {
    log_info "=== Step 4: Generating Solidity verifiers ==="
    mkdir -p target/verifiers

    for circuit in shuffle_circuit deal_circuit draw_circuit play_circuit; do
        local vk_path="target/${circuit}_vk/vk"
        if [ -f "$vk_path" ]; then
            log_info "Generating Solidity verifier for ${circuit}..."
            bb write_solidity_verifier -k "$vk_path" -o "target/verifiers/${circuit}Verifier.sol" -s ultra_honk
        else
            log_warn "VK not found for ${circuit}, skipping Solidity verifier"
        fi
    done
}

# Step 5: Generate test proofs (optional)
generate_test_proofs() {
    log_info "=== Step 5: Generating test proofs ==="
    mkdir -p target/proofs

    for circuit in shuffle_circuit deal_circuit draw_circuit play_circuit; do
        if [ -f "target/${circuit}.json" ]; then
            local witness_path="target/${circuit}.gz"
            if [ -f "$witness_path" ]; then
                log_info "Generating proof for ${circuit}..."
                bb prove -b "target/${circuit}.json" -w "$witness_path" -o "target/proofs/${circuit}_proof" -s ultra_honk --oracle_hash keccak
            else
                log_warn "No witness found for ${circuit}, skipping proof generation"
            fi
        fi
    done
}

# Step 6: Convert proofs to hex for zkVerify submission
convert_proofs_to_hex() {
    log_info "=== Step 6: Converting proofs to hex for zkVerify ==="

    for circuit in shuffle_circuit deal_circuit draw_circuit play_circuit; do
        local proof_path="target/proofs/${circuit}_proof"
        if [ -f "$proof_path" ]; then
            local hex_content=$(xxd -p "$proof_path" | tr -d '\n')
            echo "0x${hex_content}" > "target/hex/${circuit}_proof.hex"
            log_info "Proof hex saved: target/hex/${circuit}_proof.hex"
        fi
    done
}

# Main pipeline
main() {
    echo "============================================"
    echo "  ZK UNO Circuit Build Pipeline"
    echo "  Noir ${NOIR_VERSION} | BB ${BB_VERSION}"
    echo "  Target: zkVerify UltraHonk (Plain variant)"
    echo "============================================"
    echo ""

    verify_versions
    compile_circuits
    generate_vks
    convert_vk_to_hex
    generate_solidity_verifiers

    echo ""
    log_info "=== Build complete ==="
    echo ""
    echo "Output files:"
    ls -la target/*.json 2>/dev/null || true
    ls -la target/hex/ 2>/dev/null || true
    ls -la target/verifiers/ 2>/dev/null || true
}

main "$@"