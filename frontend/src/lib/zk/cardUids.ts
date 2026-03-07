/**
 * Card UID generation for UNO deck
 * Computes card UIDs dynamically using Pedersen hash via @aztec/bb.js
 * No precomputed lookup table needed - matches circuits/lib/src/card_uids.nr
 * 
 * card_uid = pedersen_hash([DOMAIN_CARD_UID, color, type, copy_index])
 */

import { hashCardUID, DOMAIN_CARD_UID, generateNonce as cryptoGenerateNonce } from './crypto';

// Re-export for convenience
export { generateNonce } from './crypto';

/**
 * Get card UID from components using Pedersen hash (async)
 * Matches the Noir circuits get_card_uid function exactly
 * 
 * @param color 0=Wild, 1=Red, 2=Green, 3=Blue, 4=Yellow
 * @param cardType 0-9=Number, 10=Skip, 11=Reverse, 12=Draw2, 13=Wild, 14=WildDraw4
 * @param copyIndex 0 or 1 (distinguishes duplicate cards)
 * @returns Promise<string> hex string of the UID
 */
export async function getCardUID(color: number, cardType: number, copyIndex: number = 0): Promise<string> {
  const uid = await hashCardUID(color, cardType, copyIndex);
  return '0x' + uid.toString(16).padStart(64, '0');
}

/**
 * Get card UID as bigint
 */
export async function getCardUIDBigInt(color: number, cardType: number, copyIndex: number = 0): Promise<bigint> {
  return hashCardUID(color, cardType, copyIndex);
}

/**
 * Parsed card details
 */
export interface ParsedCard {
  color: number;
  type: number;
  copyIndex: number;
}

/**
 * Parse a card code string into its components
 * Handles packOfCards format: "5R", "skipG", "D2R", "_B", "W", "D4W"
 * @param code Card code string
 * @returns ParsedCard object or undefined if invalid
 */
export function parseCardCode(code: string): ParsedCard | undefined {
  if (!code || code.length === 0) return undefined;

  const str = code.trim();

  // Wild cards
  if (str === 'W' || str === 'Wild') {
    return { color: 0, type: 13, copyIndex: 0 };
  }
  if (str === 'D4W' || str === 'WD4' || str === 'WildDraw4') {
    return { color: 0, type: 14, copyIndex: 0 };
  }

  // Color map (last character for colored cards)
  const colorMap: Record<string, number> = { R: 1, G: 2, B: 3, Y: 4 };

  // Skip cards: "skipR", "skipG", etc.
  const skipMatch = str.match(/^skip([RGBY])$/i);
  if (skipMatch) {
    const c = colorMap[skipMatch[1].toUpperCase()];
    return c !== undefined ? { color: c, type: 10, copyIndex: 0 } : undefined;
  }

  // Reverse cards: "_R", "_G", etc.
  const reverseMatch = str.match(/^_([RGBY])$/i);
  if (reverseMatch) {
    const c = colorMap[reverseMatch[1].toUpperCase()];
    return c !== undefined ? { color: c, type: 11, copyIndex: 0 } : undefined;
  }

  // Draw Two cards: "D2R", "D2G", etc.
  const d2Match = str.match(/^D2([RGBY])$/i);
  if (d2Match) {
    const c = colorMap[d2Match[1].toUpperCase()];
    return c !== undefined ? { color: c, type: 12, copyIndex: 0 } : undefined;
  }

  // Number cards: "5R", "0G", "9B", etc.
  const numMatch = str.match(/^(\d)([RGBY])$/i);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    const c = colorMap[numMatch[2].toUpperCase()];
    return c !== undefined ? { color: c, type: num, copyIndex: 0 } : undefined;
  }

  return undefined;
}

/**
 * Get card UID from card string (e.g., "R5", "G_Skip", "W", "W4")
 * Returns a Promise since Pedersen hashing is async
 */
export async function getCardUIDFromString(cardStr: string): Promise<string | undefined> {
  const parsed = parseCardCode(cardStr);
  if (!parsed) return undefined;
  return getCardUID(parsed.color, parsed.type, 0);
}
