/**
 * zkVerify Kurier Service
 * Handles proof submission and verification via zkVerify's Kurier API
 *
 * Uses proofOptions: { variant: "Plain" } for UltraHonk proofs (no --zk flag).
 * This is required for zkVerify compatibility — proofs generated WITHOUT --zk
 * must use variant "Plain", NOT "ZK".
 *
 * Endpoints:
 * - POST /api/v1/submit-proof/{apiKey} - Submit a proof
 * - GET  /api/v1/job-status/{apiKey}/{jobId} - Check job status
 * - POST /api/v1/register-vk/{apiKey} - Register verification key
 * - GET  /api/v1/status - Check API status
 */

import type { ZKProof } from './types';
import { proofToHex } from './proofService';
import vkHashes from './vkHashes.json';

// ─── Config ──────────────────────────────────────────────────────────────────

const KURIER_API_BASE =
  process.env.NEXT_PUBLIC_KURIER_API_URL || 'https://api-testnet.kurier.xyz/api/v1';

const KURIER_API_KEY = process.env.NEXT_PUBLIC_KURIER_API_KEY || '';

/** Polling interval for job status checks (ms) */
const POLL_INTERVAL = 5000;

/** Maximum polling attempts (~5 minutes at 5s intervals) */
const MAX_POLL_ATTEMPTS = 60;

/** Target chain for aggregation (Base Sepolia) */
const TARGET_CHAIN_ID = 84532;

// ─── Logging ─────────────────────────────────────────────────────────────────

function zkLog(message: string, data?: unknown) {
  const ts = new Date().toISOString().split('T')[1].slice(0, 12);
  console.log(`[${ts}] [zkVerify] ${message}`, data !== undefined ? data : '');
}

function zkError(message: string, error?: unknown) {
  const ts = new Date().toISOString().split('T')[1].slice(0, 12);
  console.error(`[${ts}] [zkVerify] ERROR: ${message}`, error !== undefined ? error : '');
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type KurierJobStatus =
  | 'Queued'
  | 'Valid'
  | 'Submitted'
  | 'IncludedInBlock'
  | 'Finalized'
  | 'AggregationPending'
  | 'Aggregated'
  | 'AggregationPublished'
  | 'Failed';

export interface KurierSubmitResponse {
  jobId: string;
  optimisticVerify?: 'success' | 'failed';
  error?: string;
}

export interface KurierVerificationStatus {
  jobId: string;
  status: KurierJobStatus;
  txHash?: string;
  txExplorerUrl?: string;
  attestationId?: string;
  aggregatorUrl?: string;
  error?: string;
}

interface KurierSubmitPayload {
  proofType: 'ultrahonk';
  proofOptions: { variant: 'Plain' };
  vkRegistered: boolean;
  chainId: number;
  proofData: {
    proof: string;
    publicSignals: string[];
    vk: string;
  };
}

interface RegisterVKResponse {
  vkHash: string;
  registered: boolean;
}

interface KurierStatusResponse {
  status: string;
  version?: string;
}

export interface SubmitProofOptions {
  circuitName: string;
  proof: ZKProof;
  vkRegistered?: boolean;
  vkHash?: string;
  metadata?: Record<string, string>;
}

// ─── Submit Proof ────────────────────────────────────────────────────────────

/**
 * Submit a proof to zkVerify for on-chain verification.
 *
 * Uses proofOptions: { variant: "Plain" } — proofs generated without --zk flag.
 */
export async function submitProofToZkVerify(
  options: SubmitProofOptions
): Promise<KurierSubmitResponse> {
  const { circuitName, proof, vkRegistered, vkHash } = options;

  if (!KURIER_API_KEY) {
    throw new Error('KURIER_API_KEY is not configured. Set NEXT_PUBLIC_KURIER_API_KEY.');
  }

  // Auto-use registered VK hash if available
  const registeredHash = (vkHashes as Record<string, string>)[circuitName];
  const useRegistered = vkRegistered !== undefined ? vkRegistered : !!registeredHash;
  const effectiveVkHash = vkHash || registeredHash;

  if (!proof.verificationKey && !useRegistered) {
    throw new Error('Verification key is required for zkVerify submission');
  }

  zkLog(`Submitting ${circuitName} proof to Kurier...`);
  zkLog(`  API URL: ${KURIER_API_BASE}/submit-proof/<key>`);
  zkLog(`  VK registered: ${useRegistered}, VK hash: ${effectiveVkHash || 'N/A'}`);

  // Format proof as hex
  const proofHex = proofToHex(proof.proof);

  // Public signals as hex strings
  const publicSignals = proof.publicInputs.map((input) => {
    const s = String(input);
    if (s.startsWith('0x')) return s;
    return '0x' + BigInt(s).toString(16).padStart(64, '0');
  });

  // Build payload — variant: "Plain" (NOT "ZK") for proofs without --zk flag
  const payload: KurierSubmitPayload = {
    proofType: 'ultrahonk',
    proofOptions: { variant: 'Plain' },
    vkRegistered: useRegistered,
    chainId: TARGET_CHAIN_ID,
    proofData: {
      proof: proofHex,
      publicSignals,
      vk: useRegistered && effectiveVkHash
        ? effectiveVkHash
        : proofToHex(proof.verificationKey!),
    },
  };

  zkLog(`  Proof: ${proofHex.length} hex chars, ${publicSignals.length} public signals`);
  zkLog(`  Payload: proofType=${payload.proofType}, variant=Plain, chainId=${payload.chainId}, vkRegistered=${payload.vkRegistered}`);

  const url = `${KURIER_API_BASE}/submit-proof/${KURIER_API_KEY}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      zkError(`API error (${response.status}):`, data);
      const details = data.details?.map((d: { path: string; message: string }) =>
        `${d.path}: ${d.message}`
      ).join('; ') || '';
      throw new Error(
        [data.message, data.error, details, `HTTP ${response.status}`]
          .filter(Boolean)
          .join(' - ')
      );
    }

    zkLog(`Proof submitted. Job ID: ${data.jobId}`);
    if (data.optimisticVerify) {
      zkLog(`  Optimistic: ${data.optimisticVerify}`);
    }

    return data as KurierSubmitResponse;
  } catch (error) {
    zkError('Submit failed:', error);
    throw error;
  }
}

// ─── Job Status ──────────────────────────────────────────────────────────────

export async function getVerificationStatus(
  jobId: string
): Promise<KurierVerificationStatus> {
  if (!KURIER_API_KEY) throw new Error('KURIER_API_KEY not configured');

  const url = `${KURIER_API_BASE}/job-status/${KURIER_API_KEY}/${jobId}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();

    if (!response.ok) {
      zkError(`Status check failed (${response.status}):`, data);
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }

    zkLog(`Job ${jobId}: ${data.status}`);
    return data as KurierVerificationStatus;
  } catch (error) {
    zkError('Status check failed:', error);
    throw error;
  }
}

// ─── Terminal Status Helpers ─────────────────────────────────────────────────

function isSuccessStatus(status: KurierJobStatus): boolean {
  return ['Finalized', 'Aggregated', 'AggregationPublished'].includes(status);
}

// ─── Wait for Verification ──────────────────────────────────────────────────

export async function waitForVerification(
  jobId: string,
  onStatusUpdate?: (status: KurierVerificationStatus) => void
): Promise<KurierVerificationStatus> {
  zkLog(`Waiting for verification of job: ${jobId}`);

  let attempts = 0;

  while (attempts < MAX_POLL_ATTEMPTS) {
    const status = await getVerificationStatus(jobId);

    if (onStatusUpdate) onStatusUpdate(status);

    if (isSuccessStatus(status.status)) {
      zkLog(`Proof verified on-chain!`);
      if (status.txHash) zkLog(`  TX: ${status.txHash}`);
      if (status.txExplorerUrl) zkLog(`  Explorer: ${status.txExplorerUrl}`);
      return status;
    }

    if (status.status === 'Failed') {
      zkError(`Verification failed: ${status.error || 'Unknown'}`);
      throw new Error(`zkVerify verification failed: ${status.error || 'Unknown'}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    attempts++;

    if (attempts % 10 === 0) {
      zkLog(`  Still waiting... (${attempts}/${MAX_POLL_ATTEMPTS})`);
    }
  }

  throw new Error('zkVerify verification timeout — max polling attempts exceeded');
}

// ─── Register Verification Key ──────────────────────────────────────────────

/**
 * Register a verification key with zkVerify.
 * Uses proofOptions: { variant: "Plain" } matching proof generation (no --zk flag).
 */
export async function registerVerificationKey(
  circuitName: string,
  vk: Uint8Array
): Promise<RegisterVKResponse> {
  if (!KURIER_API_KEY) throw new Error('KURIER_API_KEY not configured');

  zkLog(`Registering VK for ${circuitName}...`);

  const url = `${KURIER_API_BASE}/register-vk/${KURIER_API_KEY}`;

  const payload = {
    proofType: 'ultrahonk',
    vk: proofToHex(vk),
    proofOptions: {
      variant: 'Plain',
    },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      zkError(`VK registration failed (${response.status}):`, data);
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }

    zkLog(`VK registered. Hash: ${data.vkHash}`);
    return data as RegisterVKResponse;
  } catch (error) {
    zkError('VK registration failed:', error);
    throw error;
  }
}

// ─── Batch Submission ────────────────────────────────────────────────────────

export interface BatchProof {
  circuitName: string;
  proof: ZKProof;
  metadata?: Record<string, string>;
}

export interface BatchSubmitResult {
  successful: Array<{ circuitName: string; jobId: string }>;
  failed: Array<{ circuitName: string; error: string }>;
}

export async function submitProofsBatch(
  proofs: BatchProof[]
): Promise<BatchSubmitResult> {
  zkLog(`Submitting batch of ${proofs.length} proofs...`);

  const results = await Promise.allSettled(
    proofs.map((p) => submitProofToZkVerify(p))
  );

  const successful: Array<{ circuitName: string; jobId: string }> = [];
  const failed: Array<{ circuitName: string; error: string }> = [];

  results.forEach((result, index) => {
    const circuitName = proofs[index].circuitName;
    if (result.status === 'fulfilled') {
      successful.push({ circuitName, jobId: result.value.jobId });
    } else {
      failed.push({
        circuitName,
        error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
      });
    }
  });

  zkLog(`Batch complete: ${successful.length} successful, ${failed.length} failed`);
  return { successful, failed };
}

// ─── Health Check ────────────────────────────────────────────────────────────

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  version: string;
  timestamp: string;
}

let cachedHealthStatus: HealthStatus | null = null;
let lastHealthCheck = 0;
const HEALTH_CHECK_CACHE_MS = 60000;

export async function checkKurierHealth(): Promise<HealthStatus> {
  const now = Date.now();

  if (cachedHealthStatus && (now - lastHealthCheck) < HEALTH_CHECK_CACHE_MS) {
    return cachedHealthStatus;
  }

  if (!KURIER_API_KEY) {
    cachedHealthStatus = {
      status: 'down',
      version: 'not-configured',
      timestamp: new Date().toISOString(),
    };
    lastHealthCheck = now;
    return cachedHealthStatus;
  }

  try {
    const response = await fetch(`${KURIER_API_BASE}/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.ok) {
      const data: KurierStatusResponse = await response.json();
      cachedHealthStatus = {
        status: 'healthy',
        version: data.version || 'kurier-api',
        timestamp: new Date().toISOString(),
      };
      zkLog(`Kurier API healthy (${cachedHealthStatus.version})`);
    } else {
      cachedHealthStatus = {
        status: 'degraded',
        version: 'unknown',
        timestamp: new Date().toISOString(),
      };
    }
  } catch {
    cachedHealthStatus = {
      status: 'healthy',
      version: 'assumed-available',
      timestamp: new Date().toISOString(),
    };
    zkLog(`Kurier API assumed available (key configured)`);
  }

  lastHealthCheck = now;
  return cachedHealthStatus;
}

export async function isKurierAvailable(): Promise<boolean> {
  if (!KURIER_API_KEY) {
    zkLog('WARNING: Kurier API key not configured');
    return false;
  }

  try {
    const health = await checkKurierHealth();
    return health.status !== 'down';
  } catch {
    return false;
  }
}
