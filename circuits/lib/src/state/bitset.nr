// Bitset operations for tracking consumed cards
// Simplified - uses Pedersen hashing from Noir stdlib

use crate::utils::hash::hash_2;

/// Verify that a bitset has exactly one bit flipped from 0 to 1
pub fn verify_single_bit_flip<let N: u32>(
    old_bits: [u1; N],
    new_bits: [u1; N],
    flip_index: u32
) -> bool {
    let index_valid = flip_index < N;
    let flip_valid = (old_bits[flip_index] == 0) & (new_bits[flip_index] == 1);

    let mut other_bits_valid = true;
    for i in 0..N {
        if (i != flip_index) & (old_bits[i] != new_bits[i]) {
            other_bits_valid = false;
        }
    }

    index_valid & flip_valid & other_bits_valid
}

/// Count the number of set bits in a bitset
pub fn count_set_bits<let N: u32>(bits: [u1; N]) -> u32 {
    let mut count: u32 = 0;
    for i in 0..N {
        if bits[i] == 1 {
            count += 1;
        }
    }
    count
}

/// Check if a position is already consumed
pub fn is_position_consumed<let N: u32>(bits: [u1; N], position: u32) -> bool {
    assert(position < N, "Position out of bounds");
    bits[position] == 1
}

#[test]
fn test_verify_single_bit_flip() {
    let old: [u1; 8] = [0, 0, 0, 0, 0, 0, 0, 0];
    let new: [u1; 8] = [0, 0, 0, 1, 0, 0, 0, 0];
    assert(verify_single_bit_flip(old, new, 3));
    assert(!verify_single_bit_flip(old, new, 2));
}

#[test]
fn test_count_set_bits() {
    let bits: [u1; 8] = [0, 1, 0, 1, 0, 1, 0, 0];
    assert(count_set_bits(bits) == 3);
}