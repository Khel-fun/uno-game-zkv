/**
 * ZK Game Utilities
 * Maps between frontend card codes and ZK circuit formats
 */

import { getCardUID, generateNonce, parseCardCode } from './cardUids';
import { CardColor, CardType } from './types';
import type { Field } from './types';

// Re-export parseCardCode from cardUids for convenience
export { parseCardCode } from './cardUids';

/**
 * Track copy indices for duplicate cards in a deck
 */
export class CardCopyTracker {
  private counts: Map<string, number> = new Map();
  
  /**
   * Get the next copy index for a card and increment the counter
   */
  getNextCopyIndex(color: CardColor, type: CardType): number {
    const key = `${color}-${type}`;
    const current = this.counts.get(key) || 0;
    this.counts.set(key, current + 1);
    return current;
  }
  
  /**
   * Reset all counters
   */
  reset(): void {
    this.counts.clear();
  }
}

/**
 * Convert a frontend card code to its ZK UID (async - uses Pedersen hash)
 */
export async function cardCodeToUID(code: string, copyTracker: CardCopyTracker): Promise<Field | null> {
  const parsed = parseCardCode(code);
  if (!parsed) return null;
  
  const { color, type } = parsed;
  const copyIndex = copyTracker.getNextCopyIndex(color, type);
  return getCardUID(color, type, copyIndex);
}

// ============================================================================
// Deck Conversion
// ============================================================================

/**
 * Convert an array of frontend card codes to ZK UIDs (async)
 */
export async function deckToUIDs(cards: string[]): Promise<Field[]> {
  const tracker = new CardCopyTracker();
  const uids: Field[] = [];
  
  for (const code of cards) {
    const uid = await cardCodeToUID(code, tracker);
    if (uid) {
      uids.push(uid);
    }
  }
  
  return uids;
}

/**
 * Pad an array to a fixed length with zeros
 */
export function padArray(arr: Field[], length: number, padValue: Field = '0'): Field[] {
  const result = [...arr];
  while (result.length < length) {
    result.push(padValue);
  }
  return result.slice(0, length);
}

// ============================================================================
// Merkle Tree Helpers
// ============================================================================

/**
 * Placeholder for Merkle proof structure
 * In production, this would compute actual Merkle proofs
 */
export interface MerkleProofData {
  root: Field;
  path: Field[];
  indices: Field[];
}

/**
 * Create a placeholder Merkle proof (for development)
 * In production, this would compute actual proofs
 */
export function createPlaceholderMerkleProof(depth: number = 7): MerkleProofData {
  return {
    root: '0x0',
    path: Array(depth).fill('0x0'),
    indices: Array(depth).fill('0'),
  };
}

// ============================================================================
// Game State Helpers
// ============================================================================

export interface ZKGameState {
  /** Deck UIDs after shuffle */
  shuffledDeck: Field[];
  /** Current Merkle root of the deck */
  deckRoot: Field;
  /** Nonces used for shuffle */
  shuffleNonces: Field[];
  /** Player hand UIDs */
  playerHands: Field[][];
  /** Discard pile UIDs */
  discardPile: Field[];
  /** Draw pile UIDs */
  drawPile: Field[];
}

/**
 * Initialize ZK game state from frontend state (async)
 */
export async function initializeZKGameState(
  drawPile: string[],
  playerDecks: string[][],
  playedCards: string[]
): Promise<ZKGameState> {
  const shuffleNonces = Array(108).fill(null).map(() => generateNonce());
  
  return {
    shuffledDeck: await deckToUIDs(drawPile),
    deckRoot: '0x0', // Would be computed from Merkle tree
    shuffleNonces,
    playerHands: await Promise.all(playerDecks.map(deck => deckToUIDs(deck))),
    discardPile: await deckToUIDs(playedCards),
    drawPile: await deckToUIDs(drawPile),
  };
}

// ============================================================================
// Proof Input Builders
// ============================================================================

import type {
  ShuffleCircuitInput,
  DealCircuitInput,
  DrawCircuitInput,
  PlayCircuitInput,
  MerkleProof,
} from './types';
import { DECK_SIZE, MERKLE_DEPTH } from './types';

/**
 * Build shuffle circuit input
 */
export function buildShuffleInput(
  uidsIn: Field[],
  uidsOut: Field[]
): ShuffleCircuitInput {
  return {
    uids_in: padArray(uidsIn, DECK_SIZE),
    uids_out: padArray(uidsOut, DECK_SIZE),
  };
}

/**
 * Build deal circuit input
 */
export function buildDealInput(
  playerId: Field,
  merkleRoot: Field,
  positions: number[],
  cardUids: Field[],
  nonces: Field[],
  merklePaths: MerkleProof[]
): DealCircuitInput {
  return {
    player_id: playerId,
    merkle_root: merkleRoot,
    positions,
    card_uids: cardUids,
    nonces,
    merkle_paths: merklePaths,
  };
}

/**
 * Build draw circuit input (simplified - no consumed bitset)
 */
export function buildDrawInput(
  playerId: Field,
  merkleRoot: Field,
  position: number,
  cardUid: Field,
  nonce: Field,
  merklePath: MerkleProof
): DrawCircuitInput {
  return {
    player_id: playerId,
    merkle_root: merkleRoot,
    position,
    card_uid: cardUid,
    nonce,
    merkle_path: merklePath,
  };
}

/**
 * Build play circuit input
 */
export function buildPlayInput(
  gameId: Field,
  playerId: Field,
  moveCommitment: Field,
  handMerkleRoot: Field,
  topCardCommitment: Field,
  playedCardColor: number,
  playedCardType: number,
  playedCardCopy: number,
  playedCardNonce: Field,
  merklePath: MerkleProof,
  topCardColor: number,
  topCardType: number,
  topCardCopy: number,
  topCardNonce: Field,
  commitmentNonce: Field
): PlayCircuitInput {
  return {
    game_id: gameId,
    player_id: playerId,
    move_commitment: moveCommitment,
    hand_merkle_root: handMerkleRoot,
    top_card_commitment: topCardCommitment,
    played_card_color: playedCardColor,
    played_card_type: playedCardType,
    played_card_copy: playedCardCopy,
    played_card_nonce: playedCardNonce,
    played_card_merkle_path: merklePath,
    top_card_color: topCardColor,
    top_card_type: topCardType,
    top_card_copy: topCardCopy,
    top_card_nonce: topCardNonce,
    commitment_nonce: commitmentNonce,
  };
}

// ============================================================================
// Proof Verification Results
// ============================================================================

export interface ProofVerificationResult {
  isValid: boolean;
  circuitName: string;
  timestamp: Date;
  error?: string;
}

export interface ZkVerifyResult {
  jobId: string;
  status: 'pending' | 'verified' | 'failed';
  blockNumber?: number;
  transactionHash?: string;
}
