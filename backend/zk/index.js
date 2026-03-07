/**
 * ZK Crypto Module for UNO Game
 * 
 * Uses @aztec/bb.js Barretenberg Pedersen hashing to match
 * the Noir circuits (std::hash::pedersen_hash).
 * 
 * Provides:
 * - Dynamic card UID computation via Pedersen hash
 * - Card commitment generation
 * - Merkle tree construction & proof generation
 * - ZK game state management
 * 
 * All hash functions are ASYNC because Barretenberg WASM is async.
 * 
 * Compatible with:
 *   - Noir v1.0.0-beta.6
 *   - @aztec/bb.js v0.84.0
 *   - UltraHonk proof system
 */

const crypto = require('crypto');

//  Constants (must match circuits/lib/src/constants.nr) 

const DOMAIN_CARD_UID = 1n;
const DOMAIN_CARD_COMMITMENT = 2n;

const MERKLE_DEPTH = 7;       // 2^7 = 128 leaves (for 108 UNO cards)
const DECK_SIZE = 108;         // Standard UNO deck

//  Barretenberg Singleton 

let bbApi = null;
let FrClass = null;
let initPromise = null;

/**
 * Initialize the Barretenberg WASM instance (lazy, singleton).
 */
async function initBarretenberg() {
  if (bbApi && FrClass) return { api: bbApi, Fr: FrClass };

  if (initPromise) {
    await initPromise;
    return { api: bbApi, Fr: FrClass };
  }

  initPromise = (async () => {
    console.log('[ZK] Initializing Barretenberg WASM...');
    const { Barretenberg, Fr } = await import('@aztec/bb.js');
    bbApi = await Barretenberg.new({ threads: 1 });
    FrClass = Fr;
    console.log('[ZK] Barretenberg initialized');
  })();

  await initPromise;
  return { api: bbApi, Fr: FrClass };
}

//  Pedersen Hash Primitives 

/**
 * Pedersen hash of an array of bigint field elements.
 * Matches Noir's `std::hash::pedersen_hash(inputs)`.
 * @param {bigint[]} inputs
 * @returns {Promise<bigint>}
 */
async function pedersenHash(inputs) {
  const { api, Fr } = await initBarretenberg();
  const frInputs = inputs.map(v => new Fr(v));
  const result = await api.pedersenHash(frInputs, 0);
  if (typeof result === 'bigint') return result;
  if (result && typeof result.toString === 'function') {
    const s = result.toString();
    return s.startsWith('0x') ? BigInt(s) : BigInt('0x' + s);
  }
  throw new Error('Unexpected pedersenHash return type');
}

//  Domain-Separated Hash Functions (match circuits/lib/src/utils/hash.nr) 

/**
 * Hash a card UID.
 * card_uid = pedersen_hash([DOMAIN_CARD_UID, color, type, copy_index])
 */
async function hashCardUID(color, cardType, copyIndex) {
  return pedersenHash([DOMAIN_CARD_UID, BigInt(color), BigInt(cardType), BigInt(copyIndex)]);
}

/**
 * Hash a card commitment (Merkle leaf).
 * commitment = pedersen_hash([DOMAIN_CARD_COMMITMENT, card_uid, nonce])
 */
async function hashCardCommitment(cardUID, nonce) {
  return pedersenHash([DOMAIN_CARD_COMMITMENT, BigInt(cardUID), BigInt(nonce)]);
}

/**
 * Hash two Merkle tree nodes.
 * node = pedersen_hash([left, right])
 */
async function hashMerkleNode(left, right) {
  return pedersenHash([BigInt(left), BigInt(right)]);
}

/**
 * Hash 4 field elements (used for move commitments).
 * result = pedersen_hash([a, b, c, d])
 */
async function hash4(a, b, c, d) {
  return pedersenHash([BigInt(a), BigInt(b), BigInt(c), BigInt(d)]);
}

//  Card UID Generation 

/**
 * Get a card's UID by computing Pedersen hash dynamically.
 * @param {number} color - 0=Wild, 1=Red, 2=Green, 3=Blue, 4=Yellow
 * @param {number} cardType - 0-9=Number, 10=Skip, 11=Reverse, 12=Draw2, 13=Wild, 14=WildDraw4
 * @param {number} copyIndex - 0 or 1
 * @returns {Promise<bigint>}
 */
async function getCardUID(color, cardType, copyIndex) {
  return hashCardUID(color, cardType, copyIndex);
}

//  Nonce Generation 

/**
 * Generate a cryptographically random nonce as a field element (bigint).
 * @returns {bigint}
 */
function generateNonce() {
  const bytes = crypto.randomBytes(31);
  return BigInt('0x' + bytes.toString('hex'));
}

//  Card String Parsing 

// Color mapping - MUST match circuit constants.nr
// COLOR_WILD=0, COLOR_RED=1, COLOR_GREEN=2, COLOR_BLUE=3, COLOR_YELLOW=4
const COLORS = {
  'R': 1, 'Red': 1,
  'G': 2, 'Green': 2,
  'B': 3, 'Blue': 3,
  'Y': 4, 'Yellow': 4,
  'W': 0, 'Wild': 0,
};

// Type mapping - MUST match circuit constants.nr
// TYPE_ZERO=0, 1-9=same, TYPE_SKIP=10, TYPE_REVERSE=11, TYPE_DRAW_TWO=12,
// TYPE_WILD=13, TYPE_WILD_DRAW_FOUR=14
const TYPES = {
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4,
  '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  'Skip': 10, 'skip': 10, 'S': 10,
  'Reverse': 11, 'reverse': 11, '_': 11,
  'Draw2': 12, 'D2': 12, '+2': 12, 'draw2': 12,
  'Wild': 13, 'wild': 13,
  'WildDraw4': 14, 'WD4': 14, '+4': 14, 'D4': 14, 'Wild Draw 4': 14, 'wild_draw4': 14,
};

/**
 * Parse a card string into color, type, and copy index.
 * 
 * Supports ALL formats used by the game:
 *   packOfCards.js format: "1R", "skipG", "D2R", "_B", "W", "D4W"
 *   dash-separated format: "Red-5", "B-Skip", "Wild", "WildDraw4"
 *   hashMapEntry format:   same as packOfCards
 */
function parseCard(cardStr) {
  if (!cardStr || typeof cardStr !== 'string') return null;

  const str = cardStr.trim();

  // --- Wild cards ---
  if (str === 'W' || str === 'Wild') {
    return { color: 0, type: 13, copy: 0 };
  }
  if (str === 'D4W' || str === 'WD4' || str === 'WildDraw4' || str === 'Wild Draw 4' || str === 'Wild-Draw4') {
    return { color: 0, type: 14, copy: 0 };
  }

  // --- packOfCards.js / hashMapEntry format ---
  // Number cards: "0R", "1R", ..., "9Y"  (digit + color letter)
  const numMatch = str.match(/^(\d)([RGBY])$/);
  if (numMatch) {
    const type = parseInt(numMatch[1], 10);
    const color = COLORS[numMatch[2]];
    if (color !== undefined) return { color, type, copy: 0 };
  }

  // Skip cards: "skipR", "skipG", etc.
  const skipMatch = str.match(/^skip([RGBY])$/i);
  if (skipMatch) {
    const color = COLORS[skipMatch[1].toUpperCase()];
    if (color !== undefined) return { color, type: 10, copy: 0 };
  }

  // Reverse cards: "_R", "_G", etc. (underscore prefix)
  const reverseMatch = str.match(/^_([RGBY])$/i);
  if (reverseMatch) {
    const color = COLORS[reverseMatch[1].toUpperCase()];
    if (color !== undefined) return { color, type: 11, copy: 0 };
  }

  // Draw Two cards: "D2R", "D2G", etc.
  const d2Match = str.match(/^D2([RGBY])$/i);
  if (d2Match) {
    const color = COLORS[d2Match[1].toUpperCase()];
    if (color !== undefined) return { color, type: 12, copy: 0 };
  }

  // --- Dash/space-separated format: "Red-5", "B-Skip", "Green-Draw2" ---
  const parts = str.split(/[-\s]+/);
  if (parts.length >= 2) {
    const colorStr = parts[0];
    const typeStr = parts.slice(1).join('');
    const color = COLORS[colorStr];
    const type = TYPES[typeStr];
    if (color !== undefined && type !== undefined) {
      return { color, type, copy: 0 };
    }
  }

  console.warn(`[ZK] Could not parse card: "${cardStr}"`);
  return null;
}

//  Merkle Tree 

/**
 * Build a Merkle tree from leaf commitments.
 * Pads with zeros to 2^MERKLE_DEPTH (128 for depth=7).
 */
async function buildMerkleTree(leaves) {
  const totalLeaves = 1 << MERKLE_DEPTH;

  const paddedLeaves = [...leaves];
  while (paddedLeaves.length < totalLeaves) {
    paddedLeaves.push(0n);
  }

  const layers = [paddedLeaves];
  let currentLayer = paddedLeaves;

  for (let depth = 0; depth < MERKLE_DEPTH; depth++) {
    const nextLayer = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i];
      const right = currentLayer[i + 1] || 0n;
      const node = await hashMerkleNode(left, right);
      nextLayer.push(node);
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  return {
    root: currentLayer[0],
    layers,
  };
}

/**
 * Generate a Merkle proof for a leaf at a given index.
 */
function generateMerkleProof(layers, leafIndex) {
  const path = [];
  const indices = [];
  let idx = leafIndex;

  for (let depth = 0; depth < MERKLE_DEPTH; depth++) {
    const layer = layers[depth];
    const isLeft = idx % 2 === 0;
    const siblingIdx = isLeft ? idx + 1 : idx - 1;
    const sibling = siblingIdx < layer.length ? layer[siblingIdx] : 0n;

    path.push(sibling);
    indices.push(isLeft ? 0 : 1);
    idx = Math.floor(idx / 2);
  }

  return { path, indices };
}

//  ZK Game State 

class ZKGameState {
  constructor(gameId) {
    this.gameId = gameId;
    this.deck = [];
    this.cards = new Map();
    this.merkleTree = null;
    this.copyCounters = {};
  }

  /**
   * Initialize deck state from shuffled card strings.
   * Computes UIDs, nonces, commitments, and builds Merkle tree.
   */
  async initializeDeck(shuffledDeck) {
    this.deck = shuffledDeck;
    this.cards.clear();
    this.copyCounters = {};

    const leaves = [];

    for (let i = 0; i < shuffledDeck.length; i++) {
      const cardStr = shuffledDeck[i];
      const parsed = parseCard(cardStr);
      if (!parsed) {
        console.warn(`[ZK] Skipping unparseable card at index ${i}: "${cardStr}"`);
        continue;
      }

      const cardKey = `${parsed.color}-${parsed.type}`;
      const copyIndex = this.copyCounters[cardKey] || 0;
      this.copyCounters[cardKey] = copyIndex + 1;

      const uid = await getCardUID(parsed.color, parsed.type, copyIndex);
      const nonce = generateNonce();
      const commitment = await hashCardCommitment(uid, nonce);

      const key = `${i}-${cardStr}`;
      this.cards.set(key, {
        cardStr,
        index: i,
        color: parsed.color,
        type: parsed.type,
        copy: copyIndex,
        uid,
        nonce,
        commitment,
        consumed: false,
      });

      leaves.push(commitment);
    }

    this.merkleTree = await buildMerkleTree(leaves);

    return {
      merkleRoot: this.merkleTree.root.toString(),
      cardCount: this.cards.size,
      cardData: this._getCardDataArray(),
    };
  }

  getCardZKData(cardStr) {
    for (const [key, data] of this.cards.entries()) {
      if (data.cardStr === cardStr && !data.consumed) {
        return this._buildCardZKData(key, data);
      }
    }
    return null;
  }

  getCardZKDataByKey(key) {
    const data = this.cards.get(key);
    if (!data) return null;
    return this._buildCardZKData(key, data);
  }

  _buildCardZKData(key, data) {
    const proof = generateMerkleProof(this.merkleTree.layers, data.index);
    return {
      cardUID: data.uid.toString(),
      nonce: data.nonce.toString(),
      commitment: data.commitment.toString(),
      color: data.color,
      cardType: data.type,
      copyIndex: data.copy,
      position: data.index,
      merkleProof: {
        path: proof.path.map(p => p.toString()),
        indices: proof.indices,
      },
      merkleRoot: this.getMerkleRoot(),
    };
  }

  consumeCard(cardStr) {
    for (const [key, data] of this.cards.entries()) {
      if (data.cardStr === cardStr && !data.consumed) {
        data.consumed = true;
        return this._buildCardZKData(key, data);
      }
    }
    return null;
  }

  getMerkleRoot() {
    return this.merkleTree?.root?.toString() || '0';
  }

  _getCardDataArray() {
    const arr = [];
    for (const [key, data] of this.cards.entries()) {
      arr.push({
        key,
        cardStr: data.cardStr,
        uid: data.uid.toString(),
        commitment: data.commitment.toString(),
        consumed: data.consumed,
      });
    }
    return arr;
  }

  toJSON() {
    const cardsArray = [];
    for (const [key, value] of this.cards.entries()) {
      cardsArray.push({
        key,
        cardStr: value.cardStr,
        index: value.index,
        color: value.color,
        type: value.type,
        copy: value.copy,
        uid: value.uid.toString(),
        nonce: value.nonce.toString(),
        commitment: value.commitment.toString(),
        consumed: value.consumed,
      });
    }

    return {
      gameId: this.gameId,
      deck: this.deck,
      cards: cardsArray,
      merkleRoot: this.merkleTree?.root?.toString() || '0',
      copyCounters: this.copyCounters,
    };
  }

  static async fromJSON(json) {
    const state = new ZKGameState(json.gameId);
    state.deck = json.deck || [];
    state.copyCounters = json.copyCounters || {};

    const leaves = [];
    for (const card of json.cards || []) {
      const commitment = BigInt(card.commitment);
      state.cards.set(card.key, {
        cardStr: card.cardStr,
        index: card.index,
        color: card.color,
        type: card.type,
        copy: card.copy,
        uid: BigInt(card.uid),
        nonce: BigInt(card.nonce),
        commitment,
        consumed: card.consumed || false,
      });
      leaves.push(commitment);
    }

    if (leaves.length > 0) {
      state.merkleTree = await buildMerkleTree(leaves);
    }

    return state;
  }
}

//  Game State Store 

const zkGameStates = new Map();

function getZKGameState(gameId) {
  if (!zkGameStates.has(gameId)) {
    zkGameStates.set(gameId, new ZKGameState(gameId));
  }
  return zkGameStates.get(gameId);
}

/**
 * Initialize ZK state for a new game.
 */
async function initializeZKGame(gameId, shuffledDeck) {
  const zkState = new ZKGameState(gameId);
  const result = await zkState.initializeDeck(shuffledDeck);
  zkGameStates.set(gameId, zkState);
  return {
    ...result,
    zkState: zkState.toJSON(),
  };
}

//  Player ID Parsing 

function parsePlayerId(playerId) {
  if (typeof playerId === 'number') return playerId;
  if (!playerId) return 0;

  const str = String(playerId);
  const match = str.match(/(\d+)/);
  if (match) return parseInt(match[1], 10);

  if (str.startsWith('0x') && str.length > 10) {
    const lastBytes = str.slice(-8);
    return parseInt(lastBytes, 16) % 1000000;
  }

  return 0;
}

//  Proof Data Generators 

/**
 * Get ZK proof data for playing a card.
 */
async function getPlayProofData(gameId, playedCard, topCard, playerHand, playerId) {
  const zkState = zkGameStates.get(gameId);
  if (!zkState) {
    return { error: 'ZK state not found for game' };
  }

  const numericPlayerId = parsePlayerId(playerId);

  let playedCardData = null;
  for (const [key, data] of zkState.cards.entries()) {
    if (data.cardStr === playedCard && !data.consumed) {
      playedCardData = zkState.getCardZKDataByKey(key);
      break;
    }
  }

  if (!playedCardData) {
    return { error: 'Played card not found in ZK state' };
  }

  let topCardData = null;
  for (const [key, data] of zkState.cards.entries()) {
    if (data.cardStr === topCard) {
      topCardData = zkState.getCardZKDataByKey(key);
      break;
    }
  }

  // Compute move commitment: pedersen_hash([game_id, player_id, card_uid, nonce])
  const gameIdBigInt = BigInt(gameId || 0);
  const playerIdBigInt = BigInt(numericPlayerId);
  const cardUID = BigInt(playedCardData.cardUID);
  const nonce = BigInt(playedCardData.nonce);
  const moveCommitment = await hash4(gameIdBigInt, playerIdBigInt, cardUID, nonce);

  return {
    gameId: String(gameId),
    playerId: numericPlayerId,
    playedCard: {
      cardStr: playedCard,
      ...playedCardData,
      commitment: moveCommitment.toString(),
    },
    topCard: topCardData ? {
      cardStr: topCard,
      ...topCardData,
    } : null,
    merkleRoot: zkState.getMerkleRoot(),
    handMerkleRoot: zkState.getMerkleRoot(),
  };
}

/**
 * Get ZK proof data for drawing a card.
 */
async function getDrawProofData(gameId, drawnCard, deckPosition) {
  const zkState = zkGameStates.get(gameId);
  if (!zkState) {
    return { error: 'ZK state not found for game' };
  }

  const consumeData = zkState.consumeCard(drawnCard);
  if (!consumeData) {
    return { error: 'Failed to consume card' };
  }

  return {
    gameId,
    drawnCard: {
      cardStr: drawnCard,
      ...consumeData,
    },
    merkleRoot: zkState.getMerkleRoot(),
  };
}

/**
 * Get ZK proof data for a shuffle action.
 * Returns canonical (sorted) UIDs and shuffled UIDs for the shuffle circuit.
 */
async function getShuffleProofData(gameId) {
  const zkState = zkGameStates.get(gameId);
  if (!zkState) {
    return { error: 'ZK state not found for game' };
  }

  // Collect actual UIDs from the shuffled deck
  const shuffledUIDs = [];
  for (let i = 0; i < zkState.deck.length; i++) {
    const key = `${i}-${zkState.deck[i]}`;
    const cardData = zkState.cards.get(key);
    if (cardData) {
      shuffledUIDs.push(cardData.uid.toString());
    }
  }

  // Canonical UIDs = same UIDs sorted numerically (proves valid permutation)
  // This works regardless of deck size (54, 108, etc.)
  const canonicalUIDs = [...shuffledUIDs].sort((a, b) => {
    const ai = BigInt(a);
    const bi = BigInt(b);
    if (ai < bi) return -1;
    if (ai > bi) return 1;
    return 0;
  });

  return {
    gameId: String(gameId),
    canonicalUIDs,
    shuffledUIDs,
    merkleRoot: zkState.getMerkleRoot(),
    cardCount: zkState.deck.length,
  };
}

/**
 * Get ZK proof data for a deal action.
 * Proves that specific cards were dealt from the shuffled deck to a player.
 */
function getDealProofData(gameId, playerCards, playerId) {
  const zkState = zkGameStates.get(gameId);
  if (!zkState) {
    return { error: 'ZK state not found for game' };
  }

  const numericPlayerId = parsePlayerId(playerId);
  const positions = [];
  const cardUIDs = [];
  const nonces = [];
  const merklePaths = [];

  // Track which keys we've already used in this request (handles duplicate card strings)
  const usedKeys = new Set();
  for (const cardStr of playerCards) {
    let found = false;
    for (const [key, data] of zkState.cards.entries()) {
      if (data.cardStr === cardStr && !usedKeys.has(key)) {
        const proof = generateMerkleProof(zkState.merkleTree.layers, data.index);
        positions.push(data.index);
        cardUIDs.push(data.uid.toString());
        nonces.push(data.nonce.toString());
        merklePaths.push({
          path: proof.path.map(p => p.toString()),
          indices: proof.indices,
        });
        usedKeys.add(key); // Track within this request only (not persistent)
        found = true;
        break;
      }
    }
    if (!found) {
      console.warn(`[ZK] Card ${cardStr} not found for deal proof`);
    }
  }

  return {
    gameId: String(gameId),
    playerId: numericPlayerId,
    merkleRoot: zkState.getMerkleRoot(),
    positions,
    cardUIDs,
    nonces,
    merklePaths,
    cardCount: positions.length,
  };
}

//  Exports 

module.exports = {
  initBarretenberg,
  pedersenHash,
  hashCardUID,
  hashCardCommitment,
  hashMerkleNode,
  hash4,
  getCardUID,
  parseCard,
  generateNonce,
  buildMerkleTree,
  generateMerkleProof,
  ZKGameState,
  getZKGameState,
  initializeZKGame,
  getPlayProofData,
  getDrawProofData,
  getShuffleProofData,
  getDealProofData,
  parsePlayerId,
  DOMAIN_CARD_UID,
  DOMAIN_CARD_COMMITMENT,
  MERKLE_DEPTH,
  DECK_SIZE,
};
