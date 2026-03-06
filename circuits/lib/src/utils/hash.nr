// Pedersen hashing utilities for ZK UNO
// Uses Noir stdlib pedersen_hash (compatible with bb 0.84.0 + zkVerify)
// Matches teen-patti implementation pattern

use std::hash::pedersen_hash;

use crate::constants::{DOMAIN_CARD_UID, DOMAIN_CARD_COMMITMENT};

/// Pedersen hash wrapper for 2 elements
pub fn hash_2(a: Field, b: Field) -> Field {
    pedersen_hash([a, b])
}

/// Pedersen hash wrapper for 3 elements
pub fn hash_3(a: Field, b: Field, c: Field) -> Field {
    pedersen_hash([a, b, c])
}

/// Pedersen hash wrapper for 4 elements
pub fn hash_4(a: Field, b: Field, c: Field, d: Field) -> Field {
    pedersen_hash([a, b, c, d])
}

/// Hash a card to generate unique identifier
/// card_uid = pedersen_hash(domain, color, type, copy_index)
pub fn hash_card_uid(color: u8, card_type: u8, copy_index: u8) -> Field {
    hash_4(
        DOMAIN_CARD_UID,
        color as Field,
        card_type as Field,
        copy_index as Field
    )
}

/// Create card commitment (Merkle leaf)
/// commitment = pedersen_hash(DOMAIN_CARD_COMMITMENT, card_uid, nonce)
pub fn hash_card_commitment(card_uid: Field, nonce: Field) -> Field {
    hash_3(DOMAIN_CARD_COMMITMENT, card_uid, nonce)
}

/// Hash two Merkle tree nodes
/// node = pedersen_hash(left, right)
pub fn hash_merkle_node(left: Field, right: Field) -> Field {
    hash_2(left, right)
}

/// Aggregate sum of field elements
pub fn aggregate_sum<let N: u32>(values: [Field; N]) -> Field {
    let mut sum: Field = 0;
    for i in 0..N {
        sum += values[i];
    }
    sum
}

/// Aggregate product of field elements with offset to avoid zero
pub fn aggregate_product<let N: u32>(values: [Field; N], offset: Field) -> Field {
    let mut product: Field = 1;
    for i in 0..N {
        product *= (offset + values[i]);
    }
    product
}

#[test]
fn test_hash_card_uid() {
    let uid1 = hash_card_uid(1, 5, 0);  // Red 5, copy 0
    let uid2 = hash_card_uid(1, 5, 1);  // Red 5, copy 1
    let uid3 = hash_card_uid(2, 5, 0);  // Green 5, copy 0
    
    assert(uid1 != uid2);
    assert(uid1 != uid3);
}

#[test]
fn test_hash_card_commitment() {
    let uid = hash_card_uid(1, 5, 0);
    let nonce1: Field = 12345;
    let nonce2: Field = 54321;
    
    let commit1 = hash_card_commitment(uid, nonce1);
    let commit2 = hash_card_commitment(uid, nonce2);
    
    assert(commit1 != commit2);
}

#[test]
fn test_hash_merkle_node() {
    let left: Field = 123;
    let right: Field = 456;
    
    let node1 = hash_merkle_node(left, right);
    let node2 = hash_merkle_node(right, left);
    
    assert(node1 != node2);
}
