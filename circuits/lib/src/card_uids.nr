// Card UID generation for all 108 UNO cards
// Uses dynamic Pedersen hashing (std::hash::pedersen_hash)
// Compatible with bb 0.84.0, Noir 1.0.0-beta.6, and zkVerify

use crate::utils::hash::hash_card_uid;

/// Get card UID from components using dynamic Pedersen hashing
/// card_uid = pedersen_hash([DOMAIN_CARD_UID, color, type, copy_index])
pub fn get_card_uid(color: u8, card_type: u8, copy_index: u8) -> Field {
    hash_card_uid(color, card_type, copy_index)
}

/// Generate all 108 canonical UNO card UIDs
/// Returns the full deck UID array in canonical order
pub fn generate_canonical_deck_uids() -> [Field; 108] {
    let mut uids: [Field; 108] = [0; 108];
    let mut idx: u32 = 0;

    // Wild cards (8 total)
    // 4x Wild (color=0, type=13)
    for i in 0..4 {
        uids[idx] = get_card_uid(0, 13, i as u8);
        idx += 1;
    }
    // 4x Wild Draw Four (color=0, type=14)
    for i in 0..4 {
        uids[idx] = get_card_uid(0, 14, i as u8);
        idx += 1;
    }

    // Colored cards: Red(1), Green(2), Blue(3), Yellow(4) - 25 each
    for color in 1..5 {
        // One 0 card
        uids[idx] = get_card_uid(color as u8, 0, 0);
        idx += 1;

        // Two each of 1-9
        for num in 1..10 {
            for copy in 0..2 {
                uids[idx] = get_card_uid(color as u8, num as u8, copy as u8);
                idx += 1;
            }
        }

        // Two Skip (10), Reverse (11), Draw Two (12)
        for action in 10..13 {
            for copy in 0..2 {
                uids[idx] = get_card_uid(color as u8, action as u8, copy as u8);
                idx += 1;
            }
        }
    }

    uids
}