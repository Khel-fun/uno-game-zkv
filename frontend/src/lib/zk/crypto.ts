/**
 * ZK Cryptography Utilities
 * Uses Pedersen hash via @aztec/bb.js to match Noir's std::hash::pedersen_hash
 * Compatible with Noir v1.0.0-beta.6 and bb v0.84.0
 */

// Domain separation constants (must match circuits/lib/src/constants.nr)
export const DOMAIN_CARD_UID = 1n;
export const DOMAIN_CARD_COMMITMENT = 2n;

export const MERKLE_DEPTH = 7;
export const DECK_SIZE = 108;

// BN254 field modulus
export const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

//  Barretenberg Singleton 

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let bbInstance: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let FrClass: any = null;
let bbLoadPromise: Promise<void> | null = null;

/**
 * Initialize Barretenberg WASM (singleton)
 */
export async function initBarretenberg(): Promise<typeof bbInstance> {
  if (bbInstance) return bbInstance;

  if (!bbLoadPromise) {
    bbLoadPromise = (async () => {
      if (typeof window === 'undefined') {
        throw new Error('Barretenberg can only be initialized in the browser');
      }

      const { Barretenberg, Fr } = await import('@aztec/bb.js');
      bbInstance = await Barretenberg.new({ threads: 1 });
      FrClass = Fr;
      console.log('[ZK Crypto] Barretenberg initialized (bb.js v0.84.0)');
    })();
  }

  await bbLoadPromise;
  return bbInstance;
}

/**
 * Set the Barretenberg API instance (shared with proofService)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setBarretenberg(api: any): void {
  bbInstance = api;
}

//  Pedersen Hash Primitives 

/**
 * Pedersen hash of an array of bigint field elements.
 * Matches Noir's `std::hash::pedersen_hash(inputs)`.
 */
export async function pedersenHash(inputs: bigint[]): Promise<bigint> {
  const api = await initBarretenberg();
  if (!FrClass) {
    const { Fr } = await import('@aztec/bb.js');
    FrClass = Fr;
  }
  const frInputs = inputs.map((v: bigint) => new FrClass(v));
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
export async function hashCardUID(color: number, cardType: number, copyIndex: number): Promise<bigint> {
  return pedersenHash([DOMAIN_CARD_UID, BigInt(color), BigInt(cardType), BigInt(copyIndex)]);
}

/**
 * Hash a card commitment (Merkle leaf).
 * commitment = pedersen_hash([DOMAIN_CARD_COMMITMENT, card_uid, nonce])
 */
export async function hashCardCommitment(cardUID: bigint, nonce: bigint): Promise<bigint> {
  return pedersenHash([DOMAIN_CARD_COMMITMENT, cardUID, nonce]);
}

/**
 * Hash two Merkle tree nodes.
 * node = pedersen_hash([left, right])
 */
export async function hashMerkleNode(left: bigint, right: bigint): Promise<bigint> {
  return pedersenHash([left, right]);
}

/**
 * Hash 4 field elements (used for move commitments).
 * result = pedersen_hash([a, b, c, d])
 */
export async function hash4(a: bigint, b: bigint, c: bigint, d: bigint): Promise<bigint> {
  return pedersenHash([a, b, c, d]);
}

//  Merkle Tree 

/**
 * Build a Merkle tree from leaves (async - uses Pedersen hashing)
 */
export async function buildMerkleTree(leaves: bigint[]): Promise<{
  root: bigint;
  layers: bigint[][];
}> {
  const targetSize = Math.pow(2, MERKLE_DEPTH);
  const paddedLeaves = [...leaves];
  while (paddedLeaves.length < targetSize) {
    paddedLeaves.push(0n);
  }

  const layers: bigint[][] = [paddedLeaves];
  let currentLayer = paddedLeaves;

  for (let depth = 0; depth < MERKLE_DEPTH; depth++) {
    const nextLayer: bigint[] = [];
    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i];
      const right = currentLayer[i + 1] ?? 0n;
      const parent = await hashMerkleNode(left, right);
      nextLayer.push(parent);
    }
    layers.push(nextLayer);
    currentLayer = nextLayer;
  }

  return {
    root: currentLayer[0] ?? 0n,
    layers,
  };
}

/**
 * Generate a Merkle proof for a leaf at a given index
 */
export function generateMerkleProof(layers: bigint[][], index: number): {
  path: bigint[];
  indices: number[];
} {
  const path: bigint[] = [];
  const indices: number[] = [];

  let currentIndex = index;

  for (let i = 0; i < MERKLE_DEPTH; i++) {
    const layer = layers[i];
    const isRight = currentIndex % 2 === 1;
    const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

    path.push(layer[siblingIndex] ?? 0n);
    indices.push(isRight ? 1 : 0);

    currentIndex = Math.floor(currentIndex / 2);
  }

  return { path, indices };
}

//  Nonce & Field Utilities 

/**
 * Generate a random nonce
 */
export function generateNonce(): bigint {
  if (typeof window !== 'undefined' && window.crypto) {
    const bytes = new Uint8Array(31); // 31 bytes to stay under BN254 field
    window.crypto.getRandomValues(bytes);
    let hex = '0x';
    bytes.forEach(b => hex += b.toString(16).padStart(2, '0'));
    return BigInt(hex) % FIELD_MODULUS;
  }
  return BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)) % FIELD_MODULUS;
}

/**
 * Convert a field element to hex string
 */
export function fieldToHex(field: bigint): string {
  return '0x' + field.toString(16).padStart(64, '0');
}

/**
 * Convert hex string to field element
 */
export function hexToField(hex: string): bigint {
  if (!hex || hex === '0x' || hex === '') {
    return 0n;
  }
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!cleanHex || cleanHex.length === 0) {
    return 0n;
  }
  try {
    return BigInt('0x' + cleanHex);
  } catch {
    console.error('[ZK Crypto] hexToField failed to parse:', hex);
    return 0n;
  }
}

/**
 * Convert a Field (hex/bigint/number) to a decimal string for Noir circuit inputs
 */
export function fieldToDecimalString(field: string | bigint | number | null | undefined): string {
  if (field === undefined || field === null) return '0';
  if (typeof field === 'bigint') return field.toString();
  if (typeof field === 'number') return field.toString();
  if (typeof field === 'string') {
    if (!field || field === '0x' || field === '') return '0';
    if (field.startsWith('0x') || field.startsWith('0X')) {
      try {
        return BigInt(field).toString();
      } catch {
        return '0';
      }
    }
    return field;
  }
  return '0';
}
