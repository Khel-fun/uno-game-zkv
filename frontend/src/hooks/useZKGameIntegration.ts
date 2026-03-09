'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ZKProof } from '../lib/zk/types';

// Configuration
const ENABLE_REAL_PROOFS = true; // Set to false for simulation mode
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

// Callback type for proof tracking
export type OnProofGeneratedCallback = (circuitName: string, proof: ZKProof) => void;

// Types
interface GameState {
  gameId?: string;
  roomId?: string;
  turn: string;
  currentColor: string;
  currentNumber: string | number;
  playedCardsPile: string[];
  drawCardPile: string[];
  player1Deck: string[];
  player2Deck: string[];
  player3Deck?: string[];
  player4Deck?: string[];
  player5Deck?: string[];
  player6Deck?: string[];
  gameOver: boolean;
  totalPlayers: number;
}

interface ZKGameStats {
  proofsGenerated: number;
  proofsVerified: number;
  proofsSimulated: number;
  totalGenerationTime: number;
  lastProofType?: string;
  lastProofTime?: number;
  errors: number;
}

interface BackendPlayProofData {
  gameId: string;
  playerId: number;  // Backend returns numeric player ID
  playedCard: {
    cardStr: string;
    cardUID: string;
    nonce: string;
    commitment: string;
    merkleRoot: string;
    merkleProof: {
      path: string[];
      indices: number[];
    };
    color: number;
    cardType: number;
    copyIndex: number;
  };
  topCard?: {
    cardStr: string;
    cardUID: string;
    nonce: string;
    commitment: string;
    merkleRoot?: string;
    merkleProof?: {
      path: string[];
      indices: number[];
    };
    color: number;
    cardType: number;
    copyIndex: number;
  };
  merkleRoot: string;
  error?: string;
}

interface BackendDrawProofData {
  gameId: string;
  playerId?: number;
  drawnCard: {
    cardStr: string;
    cardUID: string;
    nonce: string;
    commitment: string;
    merkleRoot: string;
    merkleProof: {
      path: string[];
      indices: number[];
    };
    position: number;
  };
  merkleRoot: string;
  error?: string;
}

interface BackendShuffleProofData {
  gameId: string;
  canonicalUIDs: string[];
  shuffledUIDs: string[];
  merkleRoot: string;
  cardCount: number;
  error?: string;
}

interface BackendDealProofData {
  gameId: string;
  playerId: number;
  merkleRoot: string;
  positions: number[];
  cardUIDs: string[];
  nonces: string[];
  merklePaths: {
    path: string[];
    indices: number[];
  }[];
  cardCount: number;
  error?: string;
}

// Notification helper
function notifyZK(
  type: 'generating' | 'success' | 'error' | 'submitting' | 'info',
  circuit: string,
  message: string
) {
  const zkNotify = (window as unknown as { 
    zkNotify?: (type: string, circuit: string, message: string) => void 
  }).zkNotify;
  
  if (zkNotify) {
    zkNotify(type, circuit, message);
  }
  
  if (type === 'error') {
    console.warn(`[ZK] ${circuit}: ${message}`);
  } else {
    console.log(`[ZK] [${type}] ${circuit}: ${message}`);
  }
}

interface UseZKGameIntegrationOptions {
  /** Callback when a proof is generated (for tracking in ZKContext) */
  onProofGenerated?: OnProofGeneratedCallback;
}

export function useZKGameIntegration(options: UseZKGameIntegrationOptions = {}) {
  const { onProofGenerated } = options;
  
  const [stats, setStats] = useState<ZKGameStats>({
    proofsGenerated: 0,
    proofsVerified: 0,
    proofsSimulated: 0,
    totalGenerationTime: 0,
    errors: 0,
  });
  
  // Store callback in ref to avoid dependency issues
  const onProofGeneratedRef = useRef<OnProofGeneratedCallback | undefined>(onProofGenerated);
  useEffect(() => {
    onProofGeneratedRef.current = onProofGenerated;
  }, [onProofGenerated]);
  
  // Refs
  const prevGameStateRef = useRef<Partial<GameState>>({});
  const isGeneratingRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const gameIdRef = useRef<string | null>(null);
  
  // Initialize socket connection for ZK data requests
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Dynamic import to avoid SSR issues
    import('socket.io-client').then(({ io }) => {
      // Create a dedicated socket for ZK data
      const socket = io(BACKEND_URL, {
        transports: ['websocket', 'polling'],
        autoConnect: true,
      });
      
      socketRef.current = socket;
      
      socket.on('connect', () => {
        console.log('[ZK] Connected to backend for proof data');
      });
      
      socket.on('disconnect', () => {
        console.log('[ZK] Disconnected from backend');
      });
    }).catch((err) => {
      console.error('[ZK] Failed to load socket.io-client:', err);
    });
    
    return () => {
      socketRef.current?.disconnect();
    };
  }, []);
  
  /**
   * Request play proof data from backend and generate proof
   */
  const generatePlayProof = useCallback(async (
    playedCard: string,
    playerHand: string[],
    topCard: string,
    playerId: string,
    gameId?: string
  ) => {
    if (isGeneratingRef.current) return null;
    isGeneratingRef.current = true;
    const startTime = performance.now();
    
    const effectiveGameId = gameId || gameIdRef.current;
    
    try {
      if (!ENABLE_REAL_PROOFS || !socketRef.current?.connected || !effectiveGameId) {
        // Simulation mode
        notifyZK('info', 'play', `[Sim] Would prove: ${playedCard} played on ${topCard}`);
        
        setStats(prev => ({
          ...prev,
          proofsSimulated: prev.proofsSimulated + 1,
          lastProofType: 'play',
          lastProofTime: performance.now() - startTime,
        }));
        
        return { simulated: true, card: playedCard };
      }
      
      notifyZK('generating', 'play', `Requesting proof data for ${playedCard}...`);
      
      // Request proof data from backend
      const proofData = await new Promise<BackendPlayProofData>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout requesting proof data')), 10000);
        
        socketRef.current!.emit('requestPlayProofData', {
          gameId: effectiveGameId,
          playedCard,
          topCard,
          playerHand,
          playerId,
        });
        
        socketRef.current!.once('playProofData', (data: BackendPlayProofData) => {
          clearTimeout(timeout);
          if (data.error) {
            reject(new Error(data.error));
          } else {
            resolve(data);
          }
        });
      });
      
      notifyZK('generating', 'play', 'Generating ZK proof...');
      
      // Import proof service and crypto module dynamically
      const [proofService, crypto] = await Promise.all([
        import('../lib/zk/proofService'),
        import('../lib/zk/crypto'),
      ]);
      
      // Import card UIDs for lookup
      const { getCardUID } = await import('../lib/zk/cardUids');
      
      // Log backend data for debugging
      console.log('[ZK] Play proof data from backend:', {
        playedCard: proofData.playedCard,
        topCard: proofData.topCard,
        gameId: proofData.gameId,
        playerId: proofData.playerId,
      });
      
      // Validate backend data
      if (!proofData.playedCard || proofData.playedCard.color === undefined || proofData.playedCard.cardType === undefined) {
        throw new Error('Invalid played card data from backend');
      }
      
      // Get card UIDs using Pedersen hash (async)
      const playedCardUID = await getCardUID(
        proofData.playedCard.color,
        proofData.playedCard.cardType,
        proofData.playedCard.copyIndex || 0
      );
      
      if (!playedCardUID || playedCardUID === '0x' || playedCardUID.length < 10) {
        throw new Error(`Invalid card UID returned: ${playedCardUID}`);
      }
      
      const playedCardUIDField = crypto.hexToField(playedCardUID);
      
      // Use the actual nonce and commitment from the backend
      const playedCardNonce = proofData.playedCard.nonce || crypto.generateNonce().toString();
      
      // Use actual Merkle proof data from backend
      const playedCardMerklePath = proofData.playedCard.merkleProof || { path: Array(7).fill('0'), indices: Array(7).fill(0) };
      const topCardMerklePath = proofData.topCard?.merkleProof || { path: Array(7).fill('0'), indices: Array(7).fill(0) };
      
      // Build circuit input with actual backend values
      // All field values must be decimal strings (not hex)
      const input = {
        game_id: String(proofData.gameId || '1'),
        player_id: String(proofData.playerId || '1'),
        move_commitment: proofData.playedCard.commitment || playedCardUIDField.toString(),
        hand_merkle_root: proofData.playedCard.merkleRoot || playedCardUIDField.toString(),
        top_card_commitment: proofData.topCard?.commitment || '1',
        played_card_color: proofData.playedCard.color,
        played_card_type: proofData.playedCard.cardType,
        played_card_copy: proofData.playedCard.copyIndex || 0,
        played_card_nonce: playedCardNonce,
        played_card_merkle_path: {
          path: playedCardMerklePath.path.map(String),
          indices: playedCardMerklePath.indices.map(Number),
        },
        top_card_color: proofData.topCard?.color ?? 0,
        top_card_type: proofData.topCard?.cardType ?? 0,
        top_card_copy: proofData.topCard?.copyIndex ?? 0,
        top_card_nonce: proofData.topCard?.nonce || playedCardNonce,
        commitment_nonce: playedCardNonce,
      };
      
      console.log('[ZK] Play proof input prepared:', {
        game_id: input.game_id,
        player_id: input.player_id,
        played_card_color: input.played_card_color,
        played_card_type: input.played_card_type,
      });
      
      const proof = await proofService.generatePlayProof(input);
      const genDuration = performance.now() - startTime;
      
      notifyZK('success', 'play', `Proof generated in ${Math.round(genDuration)}ms`);
      
      // Track the proof immediately (before verification) so it appears in UI
      if (onProofGeneratedRef.current) {
        onProofGeneratedRef.current('play', proof);
      }
      
      // Verify locally after generation
      const verificationService = await import('../lib/zk/verificationService');
      const verifyResult = await verificationService.verifyLocally('play', proof);
      
      if (verifyResult.valid) {
        notifyZK('success', 'play', `Proof verified locally`);
      } else {
        console.warn('[ZK] Play proof local verification failed:', verifyResult.error);
      }

      // Always submit to zkVerify regardless of local verification result.
      // Local WASM verification is unreliable in multi-tab scenarios; zkVerify
      // is the authoritative verifier.
      verificationService.submitToZkVerify('play', proof)
        .then(result => {
          if (result.submitted) {
            notifyZK('success', 'play', `Submitted to zkVerify (job: ${result.jobId})`);
            console.log('[ZK] zkVerify job ID:', result.jobId);
          } else if (result.error) {
            console.warn('[ZK] zkVerify submission skipped:', result.error);
          }
        })
        .catch(err => {
          console.warn('[ZK] zkVerify submission failed:', err);
        });
      
      const totalDuration = performance.now() - startTime;
      
      setStats(prev => ({
        ...prev,
        proofsGenerated: prev.proofsGenerated + 1,
        proofsVerified: prev.proofsVerified + (verifyResult.valid ? 1 : 0),
        totalGenerationTime: prev.totalGenerationTime + totalDuration,
        lastProofType: 'play',
        lastProofTime: totalDuration,
      }));
      
      return { ...proof, verified: verifyResult.valid };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notifyZK('error', 'play', message);
      
      setStats(prev => ({
        ...prev,
        errors: prev.errors + 1,
        proofsSimulated: prev.proofsSimulated + 1,
        lastProofType: 'play',
        lastProofTime: performance.now() - startTime,
      }));
      
      return { simulated: true, card: playedCard, error: message };
    } finally {
      isGeneratingRef.current = false;
    }
  }, []);
  
  /**
   * Request draw proof data from backend and generate proof
   */
  const generateDrawProof = useCallback(async (
    drawnCard: string,
    deckPosition: number,
    gameId?: string
  ) => {
    if (isGeneratingRef.current) return null;
    isGeneratingRef.current = true;
    const startTime = performance.now();
    
    const effectiveGameId = gameId || gameIdRef.current;
    
    try {
      if (!ENABLE_REAL_PROOFS || !socketRef.current?.connected || !effectiveGameId) {
        // Simulation mode
        notifyZK('info', 'draw', `[Sim] Would prove: drew ${drawnCard} from position ${deckPosition}`);
        
        setStats(prev => ({
          ...prev,
          proofsSimulated: prev.proofsSimulated + 1,
          lastProofType: 'draw',
          lastProofTime: performance.now() - startTime,
        }));
        
        return { simulated: true, card: drawnCard };
      }
      
      notifyZK('generating', 'draw', `Requesting proof data for draw...`);
      
      // Request proof data from backend
      const proofData = await new Promise<BackendDrawProofData>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout requesting proof data')), 10000);
        
        socketRef.current!.emit('requestDrawProofData', {
          gameId: effectiveGameId,
          drawnCard,
          deckPosition,
        });
        
        socketRef.current!.once('drawProofData', (data: BackendDrawProofData) => {
          clearTimeout(timeout);
          if (data.error) {
            reject(new Error(data.error));
          } else {
            resolve(data);
          }
        });
      });
      
      notifyZK('generating', 'draw', 'Generating ZK proof...');
      
      // Import modules dynamically
      const [proofService, crypto] = await Promise.all([
        import('../lib/zk/proofService'),
        import('../lib/zk/crypto'),
      ]);
      
      // Get card UID using Pedersen hash (async)
      const { parseCardCode, getCardUID } = await import('../lib/zk/cardUids');
      
      // Parse the drawn card to get its UID
      const parsedCard = parseCardCode(proofData.drawnCard.cardStr);
      let cardUIDField: bigint;
      if (parsedCard) {
        const cardUIDHex = await getCardUID(parsedCard.color, parsedCard.type, parsedCard.copyIndex);
        cardUIDField = crypto.hexToField(cardUIDHex);
      } else {
        // Fallback to backend UID
        cardUIDField = BigInt(proofData.drawnCard.cardUID || '1');
      }
      
      // Use the actual nonce from the backend
      const nonce = proofData.drawnCard.nonce || crypto.generateNonce().toString();
      
      // Use actual Merkle proof data from backend
      const drawnCardMerklePath = proofData.drawnCard.merkleProof || { path: Array(7).fill('0'), indices: Array(7).fill(0) };
      
      // Build simplified circuit input (no consumed bitset tracking)
      const input = {
        player_id: String(proofData.playerId || '1'),
        merkle_root: proofData.drawnCard.merkleRoot || cardUIDField.toString(),
        position: proofData.drawnCard.position || 0,
        card_uid: proofData.drawnCard.cardUID || cardUIDField.toString(),
        nonce: nonce,
        merkle_path: {
          path: drawnCardMerklePath.path.map(String),
          indices: drawnCardMerklePath.indices.map(Number),
        },
      };
      
      console.log('[ZK] Draw proof input prepared:', {
        player_id: input.player_id,
        position: input.position,
      });
      
      const proof = await proofService.generateDrawProof(input);
      const genDuration = performance.now() - startTime;
      
      notifyZK('success', 'draw', `Proof generated in ${Math.round(genDuration)}ms`);
      
      // Track the proof immediately (before verification) so it appears in UI
      if (onProofGeneratedRef.current) {
        onProofGeneratedRef.current('draw', proof);
      }
      
      // Verify locally after generation
      const verificationService = await import('../lib/zk/verificationService');
      const verifyResult = await verificationService.verifyLocally('draw', proof);
      
      if (verifyResult.valid) {
        notifyZK('success', 'draw', `Proof verified locally`);
      } else {
        console.warn('[ZK] Draw proof local verification failed:', verifyResult.error);
      }

      // Always submit to zkVerify regardless of local verification result
      verificationService.submitToZkVerify('draw', proof)
        .then(result => {
          if (result.submitted) {
            notifyZK('success', 'draw', `Submitted to zkVerify (job: ${result.jobId})`);
            console.log('[ZK] zkVerify job ID:', result.jobId);
          } else if (result.error) {
            console.warn('[ZK] zkVerify submission skipped:', result.error);
          }
        })
        .catch(err => {
          console.warn('[ZK] zkVerify submission failed:', err);
        });
      
      const totalDuration = performance.now() - startTime;
      
      setStats(prev => ({
        ...prev,
        proofsGenerated: prev.proofsGenerated + 1,
        proofsVerified: prev.proofsVerified + (verifyResult.valid ? 1 : 0),
        totalGenerationTime: prev.totalGenerationTime + totalDuration,
        lastProofType: 'draw',
        lastProofTime: totalDuration,
      }));
      
      return { ...proof, verified: verifyResult.valid };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notifyZK('error', 'draw', message);
      
      setStats(prev => ({
        ...prev,
        errors: prev.errors + 1,
        proofsSimulated: prev.proofsSimulated + 1,
        lastProofType: 'draw',
        lastProofTime: performance.now() - startTime,
      }));
      
      return { simulated: true, card: drawnCard, error: message };
    } finally {
      isGeneratingRef.current = false;
    }
  }, []);
  
  /**
   * Generate a shuffle proof - proves the deck was fairly shuffled
   */
  const generateShuffleProof = useCallback(async (gameId: string) => {
    const startTime = performance.now();
    
    try {
      if (!ENABLE_REAL_PROOFS || !socketRef.current?.connected) {
        notifyZK('info', 'shuffle', '[Sim] Would prove shuffle');
        setStats(prev => ({
          ...prev,
          proofsSimulated: prev.proofsSimulated + 1,
          lastProofType: 'shuffle',
          lastProofTime: performance.now() - startTime,
        }));
        return { simulated: true };
      }
      
      notifyZK('generating', 'shuffle', 'Requesting shuffle proof data...');
      
      // Request proof data from backend with retry logic.
      // The game starter's frontend may request proof data before the backend
      // has finished initializing ZK state (async Pedersen hashing), so we
      // retry up to 5 times with increasing delays.
      const MAX_RETRIES = 5;
      let proofData: BackendShuffleProofData | null = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        proofData = await new Promise<BackendShuffleProofData>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout requesting shuffle proof data')), 15000);
          
          socketRef.current!.emit('requestShuffleProofData', { gameId });
          
          socketRef.current!.once('shuffleProofData', (data: BackendShuffleProofData) => {
            clearTimeout(timeout);
            resolve(data);
          });
        });
        
        if (proofData.error && proofData.error.includes('ZK state not found') && attempt < MAX_RETRIES) {
          const delay = 1000 * (attempt + 1);
          console.log(`[ZK] Shuffle: ZK state not ready yet, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        
        if (proofData.error) {
          throw new Error(proofData.error);
        }
        break;
      }
      
      notifyZK('generating', 'shuffle', 'Generating shuffle ZK proof...');
      
      console.log('[ZK] Shuffle proof data received:', {
        canonicalCount: proofData.canonicalUIDs?.length,
        shuffledCount: proofData.shuffledUIDs?.length,
      });
      
      // Pad arrays to 108 if needed
      const uids_in = [...(proofData.canonicalUIDs || [])];
      const uids_out = [...(proofData.shuffledUIDs || [])];
      while (uids_in.length < 108) uids_in.push('0');
      while (uids_out.length < 108) uids_out.push('0');
      
      const proofService = await import('../lib/zk/proofService');
      const proof = await proofService.generateShuffleProof({
        uids_in: uids_in.slice(0, 108),
        uids_out: uids_out.slice(0, 108),
      });
      
      const genDuration = performance.now() - startTime;
      notifyZK('success', 'shuffle', `Proof generated in ${Math.round(genDuration)}ms`);
      
      // Track in UI
      if (onProofGeneratedRef.current) {
        onProofGeneratedRef.current('shuffle', proof);
      }
      
      // Verify locally
      const verificationService = await import('../lib/zk/verificationService');
      const verifyResult = await verificationService.verifyLocally('shuffle', proof);
      
      if (verifyResult.valid) {
        notifyZK('success', 'shuffle', 'Proof verified locally');
      } else {
        console.warn('[ZK] Shuffle proof local verification failed:', verifyResult.error);
      }

      // Always submit to zkVerify regardless of local verification result
      verificationService.submitToZkVerify('shuffle', proof)
        .then(result => {
          if (result.submitted) {
            notifyZK('success', 'shuffle', `Submitted to zkVerify (job: ${result.jobId})`);
            console.log('[ZK] Shuffle zkVerify job ID:', result.jobId);
          }
        })
        .catch(err => console.warn('[ZK] Shuffle zkVerify submission failed:', err));
      
      setStats(prev => ({
        ...prev,
        proofsGenerated: prev.proofsGenerated + 1,
        proofsVerified: prev.proofsVerified + (verifyResult.valid ? 1 : 0),
        totalGenerationTime: prev.totalGenerationTime + (performance.now() - startTime),
        lastProofType: 'shuffle',
        lastProofTime: performance.now() - startTime,
      }));
      
      return { ...proof, verified: verifyResult.valid };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notifyZK('error', 'shuffle', message);
      setStats(prev => ({
        ...prev,
        errors: prev.errors + 1,
        lastProofType: 'shuffle',
        lastProofTime: performance.now() - startTime,
      }));
      return { simulated: true, error: message };
    }
  }, []);
  
  /**
   * Generate a deal proof - proves cards were correctly dealt to a player
   */
  const generateDealProof = useCallback(async (
    gameId: string,
    playerCards: string[],
    playerId: string
  ) => {
    const startTime = performance.now();
    
    try {
      if (!ENABLE_REAL_PROOFS || !socketRef.current?.connected) {
        notifyZK('info', 'deal', '[Sim] Would prove deal');
        setStats(prev => ({
          ...prev,
          proofsSimulated: prev.proofsSimulated + 1,
          lastProofType: 'deal',
          lastProofTime: performance.now() - startTime,
        }));
        return { simulated: true };
      }
      
      notifyZK('generating', 'deal', 'Requesting deal proof data...');
      
      // Request proof data from backend with retry logic.
      // The game starter's frontend may request proof data before the backend
      // has finished initializing ZK state, so we retry with increasing delays.
      const MAX_RETRIES = 5;
      let proofData: BackendDealProofData | null = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        proofData = await new Promise<BackendDealProofData>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout requesting deal proof data')), 15000);
          
          socketRef.current!.emit('requestDealProofData', {
            gameId,
            playerCards,
            playerId,
          });
          
          socketRef.current!.once('dealProofData', (data: BackendDealProofData) => {
            clearTimeout(timeout);
            resolve(data);
          });
        });
        
        if (proofData.error && proofData.error.includes('ZK state not found') && attempt < MAX_RETRIES) {
          const delay = 1000 * (attempt + 1);
          console.log(`[ZK] Deal: ZK state not ready yet, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        
        if (proofData.error) {
          throw new Error(proofData.error);
        }
        break;
      }
      
      notifyZK('generating', 'deal', 'Generating deal ZK proof...');
      
      console.log('[ZK] Deal proof data received:', {
        playerId: proofData.playerId,
        cardCount: proofData.cardCount,
        positions: proofData.positions,
      });
      
      // Deal circuit expects exactly 5 cards
      const positions = [...(proofData.positions || [])];
      const cardUIDs = [...(proofData.cardUIDs || [])];
      const nonces = [...(proofData.nonces || [])];
      const merklePaths = [...(proofData.merklePaths || [])];
      
      // Pad to 5 if we have fewer
      while (positions.length < 5) positions.push(0);
      while (cardUIDs.length < 5) cardUIDs.push('0');
      while (nonces.length < 5) nonces.push('0');
      while (merklePaths.length < 5) merklePaths.push({ path: Array(7).fill('0'), indices: Array(7).fill(0) });
      
      const proofService = await import('../lib/zk/proofService');
      const proof = await proofService.generateDealProof({
        player_id: String(proofData.playerId || '1'),
        merkle_root: proofData.merkleRoot,
        positions: positions.slice(0, 5),
        card_uids: cardUIDs.slice(0, 5),
        nonces: nonces.slice(0, 5),
        merkle_paths: merklePaths.slice(0, 5).map(mp => ({
          path: mp.path.map(String),
          indices: mp.indices.map(Number),
        })),
      });
      
      const genDuration = performance.now() - startTime;
      notifyZK('success', 'deal', `Proof generated in ${Math.round(genDuration)}ms`);
      
      // Track in UI
      if (onProofGeneratedRef.current) {
        onProofGeneratedRef.current('deal', proof);
      }
      
      // Verify locally
      const verificationService = await import('../lib/zk/verificationService');
      const verifyResult = await verificationService.verifyLocally('deal', proof);
      
      if (verifyResult.valid) {
        notifyZK('success', 'deal', 'Proof verified locally');
      } else {
        console.warn('[ZK] Deal proof local verification failed:', verifyResult.error);
      }

      // Always submit to zkVerify regardless of local verification result
      verificationService.submitToZkVerify('deal', proof)
        .then(result => {
          if (result.submitted) {
            notifyZK('success', 'deal', `Submitted to zkVerify (job: ${result.jobId})`);
            console.log('[ZK] Deal zkVerify job ID:', result.jobId);
          }
        })
        .catch(err => console.warn('[ZK] Deal zkVerify submission failed:', err));
      
      setStats(prev => ({
        ...prev,
        proofsGenerated: prev.proofsGenerated + 1,
        proofsVerified: prev.proofsVerified + (verifyResult.valid ? 1 : 0),
        totalGenerationTime: prev.totalGenerationTime + (performance.now() - startTime),
        lastProofType: 'deal',
        lastProofTime: performance.now() - startTime,
      }));
      
      return { ...proof, verified: verifyResult.valid };
      
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      notifyZK('error', 'deal', message);
      setStats(prev => ({
        ...prev,
        errors: prev.errors + 1,
        lastProofType: 'deal',
        lastProofTime: performance.now() - startTime,
      }));
      return { simulated: true, error: message };
    }
  }, []);
  
  /**
   * Handle game state changes and trigger appropriate proofs
   */
  const onGameStateChange = useCallback((
    newState: GameState,
    currentPlayer: string
  ) => {
    const prevState = prevGameStateRef.current;
    
    // Track game ID
    if (newState.gameId || newState.roomId) {
      gameIdRef.current = (newState.gameId || newState.roomId) as string;
    }
    
    // Detect card play (playedCardsPile grew)
    if (
      newState.playedCardsPile &&
      prevState.playedCardsPile &&
      newState.playedCardsPile.length > prevState.playedCardsPile.length
    ) {
      const playedCard = newState.playedCardsPile[newState.playedCardsPile.length - 1];
      const topCard = prevState.playedCardsPile[prevState.playedCardsPile.length - 1] || playedCard;
      
      // Get the player's current hand
      const playerKey = `player${getPlayerNumber(currentPlayer)}Deck` as keyof GameState;
      const playerHand = (newState[playerKey] as string[]) || [];
      
      // Generate play proof
      generatePlayProof(playedCard, playerHand, topCard, currentPlayer, gameIdRef.current || undefined);
    }
    
    // Detect card draw (drawCardPile shrunk)
    if (
      newState.drawCardPile &&
      prevState.drawCardPile &&
      newState.drawCardPile.length < prevState.drawCardPile.length
    ) {
      // Find what was drawn
      const playerNum = getPlayerNumber(currentPlayer);
      const playerDeckKey = `player${playerNum}Deck` as keyof GameState;
      const currentDeck = newState[playerDeckKey] as string[] | undefined;
      const prevDeck = prevState[playerDeckKey] as string[] | undefined;
      
      if (currentDeck && prevDeck && currentDeck.length > prevDeck.length) {
        const drawnCard = currentDeck[currentDeck.length - 1];
        const deckPosition = prevState.drawCardPile?.length || 0;
        
        // Generate draw proof
        generateDrawProof(drawnCard, deckPosition, gameIdRef.current || undefined);
      }
    }
    
    // Store current state for next comparison
    prevGameStateRef.current = { ...newState };
  }, [generatePlayProof, generateDrawProof]);
  
  return {
    isReady: true,
    isLoading: false,
    error: null,
    stats,
    onGameStateChange,
    generatePlayProof,
    generateDrawProof,
    generateShuffleProof,
    generateDealProof,
    realProofsEnabled: ENABLE_REAL_PROOFS,
  };
}

// Helper function
function getPlayerNumber(playerName: string): number {
  const match = playerName.match(/\d+/);
  return match ? parseInt(match[0], 10) : 1;
}

export default useZKGameIntegration;
