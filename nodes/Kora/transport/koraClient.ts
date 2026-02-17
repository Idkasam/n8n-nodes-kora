import * as crypto from 'crypto';

// ===========================================
// Parse agent secret key
// ===========================================
// Format: kora_agent_sk_{base64(agentId:hexSeed)}

export interface AgentKeys {
  agentId: string;
  privateKey: Buffer;
}

export function parseAgentSecret(secret: string): AgentKeys {
  if (!secret.startsWith('kora_agent_sk_')) {
    throw new Error('Invalid agent secret: must start with kora_agent_sk_');
  }

  const b64 = secret.slice('kora_agent_sk_'.length);
  const decoded = Buffer.from(b64, 'base64').toString('utf-8');
  const colonIndex = decoded.indexOf(':');

  if (colonIndex === -1) {
    throw new Error('Invalid agent secret format: missing key separator');
  }

  const agentId = decoded.slice(0, colonIndex);
  const hexSeed = decoded.slice(colonIndex + 1);
  const privateKey = Buffer.from(hexSeed, 'hex');

  if (privateKey.length !== 32) {
    throw new Error('Invalid key seed: expected 32 bytes, got ' + privateKey.length);
  }

  return { agentId, privateKey };
}

// ===========================================
// Canonical JSON (deterministic serialization)
// ===========================================
// Recursively sort all object keys. Arrays stay ordered.
// Output: compact JSON, no whitespace.
// Must match server's canonicalize_json() exactly.

function sortKeys(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (typeof obj !== 'object') return obj;

  const sorted: Record<string, any> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key]);
  }
  return sorted;
}

export function canonicalize(obj: Record<string, any>): string {
  return JSON.stringify(sortKeys(obj));
}

// ===========================================
// Ed25519 signing (Node.js built-in crypto)
// ===========================================

export function signPayload(payload: string, seed: Buffer): string {
  // DER-encoded PKCS8 prefix for Ed25519 private key (32-byte seed)
  const derPrefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const derKey = Buffer.concat([derPrefix, seed]);

  const privateKey = crypto.createPrivateKey({
    key: derKey,
    format: 'der',
    type: 'pkcs8',
  });

  const signature = crypto.sign(null, Buffer.from(payload, 'utf-8'), privateKey);
  return signature.toString('base64');
}

// ===========================================
// Deterministic intent ID (no uuid package)
// ===========================================
// SHA-256 hash of execution context, formatted as UUID-like string.
// Same execution + same item index = same intent_id (idempotent retries).

export function deriveIntentId(executionId: string, itemIndex: number, operation: string): string {
  const input = `kora:${executionId}:${itemIndex}:${operation}`;
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    hash.slice(12, 16),
    hash.slice(16, 20),
    hash.slice(20, 32),
  ].join('-');
}

// ===========================================
// Nonce generation (no uuid package)
// ===========================================

export function generateNonce(): string {
  return crypto.randomBytes(16).toString('base64');
}

// ===========================================
// Build signed request
// ===========================================
// Returns canonical JSON body + auth headers.
// The node passes these to this.helpers.httpRequest.

export function buildSignedHeaders(body: Record<string, any>, keys: AgentKeys): {
  canonicalBody: string;
  headers: Record<string, string>;
} {
  const canonicalBody = canonicalize(body);
  const signature = signPayload(canonicalBody, keys.privateKey);

  return {
    canonicalBody,
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Id': keys.agentId,
      'X-Agent-Signature': signature,
    },
  };
}
