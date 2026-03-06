// Merkle tree utilities for ZK UNO
// Self-implemented using Pedersen hash from Noir stdlib
// Compatible with bb 0.84.0 and zkVerify UltraHonk

use crate::types::{MERKLE_DEPTH, MerkleProof};
use crate::utils::hash::hash_merkle_node;

/// Compute Merkle root from a leaf and its proof path
/// Walks up the tree using sibling hashes and direction indices
pub fn compute_merkle_root(
    leaf: Field,
    depth: u32,
    indices: [u1; MERKLE_DEPTH],
    siblings: [Field; MERKLE_DEPTH]
) -> Field {
    let mut current = leaf;
    for i in 0..MERKLE_DEPTH {
        if i < depth {
            if indices[i] == 0 {
                // Current node is on the left
                current = hash_merkle_node(current, siblings[i]);
            } else {
                // Current node is on the right
                current = hash_merkle_node(siblings[i], current);
            }
        }
    }
    current
}

/// Verify a Merkle inclusion proof
pub fn verify_merkle_proof(
    leaf: Field,
    proof: MerkleProof,
    root: Field
) -> bool {
    let computed_root = compute_merkle_root(leaf, MERKLE_DEPTH, proof.indices, proof.path);
    computed_root == root
}

/// Assert that a Merkle proof is valid
pub fn assert_merkle_proof(
    leaf: Field,
    proof: MerkleProof,
    root: Field
) {
    let computed_root = compute_merkle_root(leaf, MERKLE_DEPTH, proof.indices, proof.path);
    assert(computed_root == root, "Invalid Merkle proof");
}

/// Verify multiple Merkle proofs against the same root
pub fn assert_multiple_proofs<let N: u32>(
    leaves: [Field; N],
    proofs: [MerkleProof; N],
    root: Field
) {
    for i in 0..N {
        assert_merkle_proof(leaves[i], proofs[i], root);
    }
}

#[test]
fn test_merkle_proof_two_leaves() {
    let leaf0: Field = 100;
    let leaf1: Field = 200;
    
    let root = hash_merkle_node(leaf0, leaf1);
    
    // Proof for leaf0 (index 0, left side)
    let proof0 = MerkleProof {
        path: [leaf1, 0, 0, 0, 0, 0, 0],
        indices: [0, 0, 0, 0, 0, 0, 0]
    };
    
    let computed_root = compute_merkle_root(leaf0, 1, proof0.indices, proof0.path);
    assert(computed_root == root, "Merkle root computation failed");
}

#[test]
fn test_merkle_proof_four_leaves() {
    let leaf0: Field = 100;
    let leaf1: Field = 200;
    let leaf2: Field = 300;
    let leaf3: Field = 400;
    
    let hash01 = hash_merkle_node(leaf0, leaf1);
    let hash23 = hash_merkle_node(leaf2, leaf3);
    let root = hash_merkle_node(hash01, hash23);
    
    // Proof for leaf0 (index 0)
    let proof0 = MerkleProof {
        path: [leaf1, hash23, 0, 0, 0, 0, 0],
        indices: [0, 0, 0, 0, 0, 0, 0]
    };
    
    let computed_root = compute_merkle_root(leaf0, 2, proof0.indices, proof0.path);
    assert(computed_root == root, "Merkle root computation failed for leaf0");
}
