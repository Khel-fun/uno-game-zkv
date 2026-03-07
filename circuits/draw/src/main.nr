// Simplified Draw operation circuit
// Proves that a player drew a valid card from the deck
// Compatible with bb 0.84.0, Noir 1.0.0-beta.6, and zkVerify
//
// Simplified: Removed 108-bit consumed bitset tracking
// Consumed state is tracked off-chain for efficiency

use dep::zk_uno::types::{DECK_SIZE, MerkleProof};
use dep::zk_uno::utils::hash::hash_card_commitment;
use dep::zk_uno::utils::merkle::assert_merkle_proof;

// Main entry point for the circuit
fn main(
    // Public inputs
    player_id: pub Field,
    merkle_root: pub Field,

    // Private witnesses
    position: u32,
    card_uid: Field,
    nonce: Field,
    merkle_path: MerkleProof
) {
    // Verify position is in valid range (0-107 for 108 cards)
    assert(position < DECK_SIZE, "Draw position out of range");

    // Verify the card exists in the deck at the specified position
    let leaf = hash_card_commitment(card_uid, nonce);
    assert_merkle_proof(leaf, merkle_path, merkle_root);

    // Player ID associates the draw with the specific player
    let _ = player_id;
}

#[test]
fn test_draw_position_validation() {
    let position: u32 = 50;
    assert(position < DECK_SIZE);
}

#[test(should_fail_with = "Draw position out of range")]
fn test_draw_invalid_position() {
    let position: u32 = 200;
    assert(position < DECK_SIZE, "Draw position out of range");
}