/**
 * Shared Kora SDK wrapper for n8n nodes.
 *
 * Uses @kora-protocol/sdk for all crypto (parseAgentKey, buildSignedFields,
 * canonicalize, sign). Makes HTTP calls directly to support deterministic
 * intent_id derived from n8n execution context.
 */
import { randomBytes } from 'node:crypto';
import { v5 as uuidv5 } from 'uuid';
import { INode, NodeOperationError } from 'n8n-workflow';
import {
	Kora,
	parseAgentKey,
	buildSignedFields,
	canonicalize,
	sign,
} from '@kora-protocol/sdk';
import type { SpendResult, BudgetResult } from '@kora-protocol/sdk';

export type { SpendResult, BudgetResult };

// Stable namespace for deterministic intent_id generation
const KORA_N8N_NAMESPACE = 'b7e23ec2-9c4f-4a1d-8e6b-f3a5d7c9e1b0';

/**
 * Derive a deterministic intent_id from n8n execution context.
 * Same execution + same item index + same operation = same intent_id.
 * Ensures n8n retries are idempotent.
 */
export function deriveIntentId(
	executionId: string,
	itemIndex: number,
	operation: string,
): string {
	const seed = `${executionId}:${itemIndex}:${operation}`;
	return uuidv5(seed, KORA_N8N_NAMESPACE);
}

/**
 * Create a Kora SDK client for budget checks.
 * The simple Kora class requires mandate at construction.
 */
export function createKoraClient(
	agentSecret: string,
	mandateId: string,
	apiUrl: string,
): Kora {
	return new Kora({
		secret: agentSecret,
		mandate: mandateId,
		baseUrl: apiUrl,
		logDenials: false,
	});
}

/**
 * Submit an authorization request with deterministic intent_id.
 *
 * Uses SDK crypto (parseAgentKey, buildSignedFields, canonicalize, sign)
 * but makes the HTTP call directly so we can inject the deterministic
 * intent_id from n8n's execution context.
 */
export async function authorizeSpend(params: {
	agentSecret: string;
	apiUrl: string;
	mandateId: string;
	intentId: string;
	amountCents: number;
	currency: string;
	vendorId: string;
	category?: string;
	purpose?: string;
	ttlSeconds?: number;
}): Promise<Record<string, any>> {
	const { agentId, signingKey } = parseAgentKey(params.agentSecret);
	const nonce = randomBytes(16).toString('base64');
	const ttl = params.ttlSeconds ?? 300;

	const signedFields = buildSignedFields({
		intentId: params.intentId,
		agentId,
		mandateId: params.mandateId,
		amountCents: params.amountCents,
		currency: params.currency.toUpperCase(),
		vendorId: params.vendorId,
		nonce,
		ttlSeconds: ttl,
	});

	const canonical = canonicalize(signedFields as Record<string, unknown>);
	const signature = sign(canonical, signingKey);

	const body: Record<string, any> = { ...signedFields, signature };
	if (params.category) body.category = params.category;
	if (params.purpose) body.purpose = params.purpose;

	const baseUrl = params.apiUrl.replace(/\/$/, '');

	// Single attempt — SDK crypto handles signing, we handle the call
	const response = await fetch(`${baseUrl}/v1/authorize`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Agent-Signature': signature,
			'X-Agent-Id': agentId,
		},
		body: JSON.stringify(body),
	});

	// 5xx = fail-closed (caller must throw NodeOperationError)
	if (response.status >= 500) {
		const err: any = new Error(`Kora server error: HTTP ${response.status}`);
		err.statusCode = response.status;
		throw err;
	}

	// 409 = INTENT_REPLAY_MISMATCH (the only non-200 denial)
	// 200 = APPROVED or DENIED
	return response.json() as Promise<Record<string, any>>;
}

/**
 * Fail-closed error handler.
 * Throws NodeOperationError for server errors and network failures.
 * Workflow MUST stop — no authorization means no payment.
 */
export function handleKoraError(error: any, node: INode): never {
	if (error.statusCode >= 500 || error.response?.status >= 500) {
		throw new NodeOperationError(
			node,
			`Kora unavailable (${error.statusCode ?? error.response?.status}). Workflow stopped. No authorization = no payment.`,
			{
				description:
					'Kora returned a server error. The workflow has been stopped to prevent unauthorized spending.',
			},
		);
	}

	if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.cause?.code === 'ECONNREFUSED') {
		throw new NodeOperationError(
			node,
			'Cannot reach Kora. Workflow stopped.',
			{
				description:
					'Kora is unreachable. The workflow has been stopped. Fail-closed: no authorization means no payment.',
			},
		);
	}

	throw new NodeOperationError(node, error.message ?? 'Unknown Kora error');
}
