import {
	ISupplyDataFunctions,
	INodeType,
	INodeTypeDescription,
	SupplyData,
} from 'n8n-workflow';

import { z } from 'zod';
import { createKoraClient } from '../../src/shared/koraClient';
import type { KoraAgentCredentials } from '../../src/shared/types';

const DEFAULT_TOOL_DESCRIPTION =
	'Authorize a financial transaction. You MUST call this tool before making any payment, purchase, or financial commitment. ' +
	'If the result is DENIED, you MUST NOT proceed with the payment. ' +
	'Provide: amount_cents (integer, in cents), currency (ISO 4217, e.g. EUR), vendor_id (lowercase service name), ' +
	'and purpose (why you are spending this money).';

export class KoraTool implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Kora Authorize Spend',
		name: 'koraTool',
		icon: 'file:kora.svg',
		group: ['transform'],
		version: 1,
		description: 'Authorize financial transactions before spending. The AI agent MUST call this tool before any payment.',
		defaults: { name: 'Kora Authorize' },
		codex: {
			categories: ['AI'],
			subcategories: { AI: ['Tools'] },
		},
		inputs: [],
		outputs: [],
		credentials: [
			{ name: 'koraAgentApi', required: true },
		],
		properties: [
			{
				displayName: 'Mandate ID',
				name: 'mandateId',
				type: 'string',
				required: true,
				default: '',
				description: "The mandate ID that governs this agent's spending",
			},
			{
				displayName: 'Tool Description Override',
				name: 'toolDescription',
				type: 'string',
				default: '',
				description: 'Override the default tool description sent to the AI. Leave empty for default.',
				typeOptions: { rows: 3 },
			},
		],
	};

	async supplyData(this: ISupplyDataFunctions): Promise<SupplyData> {
		const credentials = await this.getCredentials('koraAgentApi') as unknown as KoraAgentCredentials;
		const mandateId = this.getNodeParameter('mandateId', 0) as string;
		const descOverride = this.getNodeParameter('toolDescription', 0) as string;

		const kora = createKoraClient(
			credentials.agentSecret,
			mandateId,
			credentials.apiUrl,
		);

		const toolDescription = descOverride || DEFAULT_TOOL_DESCRIPTION;

		// Dynamic import — @langchain/core is available at runtime in n8n
		const { DynamicStructuredTool } = await (Function('return import("@langchain/core/tools")')() as Promise<any>);

		const tool = new DynamicStructuredTool({
			name: 'kora_authorize_spend',
			description: toolDescription,
			schema: z.object({
				amount_cents: z
					.number()
					.int()
					.positive()
					.describe('Amount in cents (e.g., 5000 = 50.00)'),
				currency: z
					.string()
					.length(3)
					.describe('ISO 4217 currency code (EUR, USD, GBP, SEK)'),
				vendor_id: z
					.string()
					.describe('Lowercase vendor identifier (e.g., aws, stripe, twilio)'),
				purpose: z
					.string()
					.optional()
					.describe('Why this money is being spent'),
				category: z
					.string()
					.optional()
					.describe('Spending category'),
			}),
			func: async (input: { amount_cents: number; currency: string; vendor_id: string; purpose?: string; category?: string }) => {
				try {
					const result = await kora.spend(
						input.vendor_id,
						input.amount_cents,
						input.currency,
						input.purpose,
					);

					if (result.approved) {
						return JSON.stringify({
							status: 'APPROVED',
							message: result.message,
							seal: result.seal ? 'Cryptographic proof attached' : null,
							payment: result.payment,
							daily_remaining_cents: result.raw
								? (result.raw as any).limits_after_approval?.daily_remaining_cents
								: undefined,
						});
					} else {
						return JSON.stringify({
							status: 'DENIED',
							reason: result.reasonCode,
							message: result.message,
							suggestion: result.suggestion,
							retry_with_cents: result.retryWith?.amount_cents ?? null,
							instruction:
								'You MUST NOT proceed with this payment. Inform the user of the denial reason.',
						});
					}
				} catch (error: any) {
					// Fail-closed: AI gets a clear "cannot proceed" message
					return JSON.stringify({
						status: 'ERROR',
						message: 'Kora is unavailable. You MUST NOT proceed with any payment.',
						instruction:
							'Do not attempt the payment. Inform the user that authorization is currently unavailable.',
					});
				}
			},
		});

		return { response: tool };
	}
}
