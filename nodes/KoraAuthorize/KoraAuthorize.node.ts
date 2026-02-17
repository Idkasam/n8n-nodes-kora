import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { authorizeSpend, deriveIntentId, handleKoraError } from '../../src/shared/koraClient';
import type { KoraAgentCredentials } from '../../src/shared/types';

export class KoraAuthorize implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Kora Authorize',
		name: 'koraAuthorize',
		icon: 'file:kora.svg',
		group: ['transform'],
		version: 1,
		subtitle: 'Authorize Spend',
		description: 'Authorize a financial transaction via Kora. Two outputs: APPROVED / DENIED.',
		defaults: { name: 'Kora Authorize' },
		inputs: ['main'],
		outputs: ['main', 'main'],
		outputNames: ['Approved', 'Denied'],
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
				placeholder: 'mandate_abc123def456',
				description: 'The mandate governing this spend request',
			},
			{
				displayName: 'Amount (cents)',
				name: 'amountCents',
				type: 'number',
				required: true,
				default: 0,
				description: 'Amount in cents (integer). E.g. 5000 = 50.00',
			},
			{
				displayName: 'Currency',
				name: 'currency',
				type: 'options',
				required: true,
				options: [
					{ name: 'EUR', value: 'EUR' },
					{ name: 'USD', value: 'USD' },
					{ name: 'GBP', value: 'GBP' },
					{ name: 'SEK', value: 'SEK' },
				],
				default: 'EUR',
			},
			{
				displayName: 'Vendor',
				name: 'vendorId',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'aws',
				description: 'Lowercase vendor identifier',
			},
			{
				displayName: 'Category',
				name: 'category',
				type: 'options',
				options: [
					{ name: 'None', value: '' },
					{ name: 'Compute', value: 'compute' },
					{ name: 'API Services', value: 'api_services' },
					{ name: 'Infrastructure', value: 'infrastructure' },
					{ name: 'Software Licenses', value: 'software_licenses' },
					{ name: 'Office Supplies', value: 'office_supplies' },
					{ name: 'Professional Services', value: 'professional_services' },
					{ name: 'Travel', value: 'travel' },
					{ name: 'Logistics', value: 'logistics' },
					{ name: 'Marketing', value: 'marketing' },
					{ name: 'Data Services', value: 'data_services' },
					{ name: 'Communication', value: 'communication' },
					{ name: 'Other', value: 'other' },
				],
				default: '',
			},
			{
				displayName: 'Purpose',
				name: 'purpose',
				type: 'string',
				default: '',
				description: 'Human-readable description of why this money is being spent',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const approvedItems: INodeExecutionData[] = [];
		const deniedItems: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('koraAgentApi') as unknown as KoraAgentCredentials;
		const executionId = this.getExecutionId();

		for (let i = 0; i < items.length; i++) {
			const mandateId = this.getNodeParameter('mandateId', i) as string;
			const amountCents = this.getNodeParameter('amountCents', i) as number;
			const currency = this.getNodeParameter('currency', i) as string;
			const vendorId = this.getNodeParameter('vendorId', i) as string;
			const category = this.getNodeParameter('category', i, '') as string;
			const purpose = this.getNodeParameter('purpose', i, '') as string;

			const intentId = deriveIntentId(executionId, i, 'authorize');

			let result: Record<string, any>;
			try {
				result = await authorizeSpend({
					agentSecret: credentials.agentSecret,
					apiUrl: credentials.apiUrl,
					mandateId,
					intentId,
					amountCents,
					currency,
					vendorId,
					category: category || undefined,
					purpose: purpose || undefined,
				});
			} catch (error) {
				// Fail-closed: 5xx, timeout, network error → stop workflow
				handleKoraError(error, this.getNode());
			}

			const decision = result.decision ?? result.status;

			if (decision === 'APPROVED') {
				approvedItems.push({
					json: {
						decision: 'APPROVED',
						decision_id: result.decision_id ?? result.authorization_id,
						amount_cents: amountCents,
						currency,
						vendor_id: vendorId,
						seal: result.notary_seal ?? null,
						payment: result.payment_instruction ?? null,
						daily_remaining_cents: result.limits_after_approval?.daily_remaining_cents,
						monthly_remaining_cents: result.limits_after_approval?.monthly_remaining_cents,
					},
				});
			} else {
				deniedItems.push({
					json: {
						decision: 'DENIED',
						decision_id: result.decision_id ?? result.authorization_id,
						reason_code: result.reason_code,
						message: `Denied: ${result.reason_code}`,
						daily_remaining_cents: result.limits_current?.daily_remaining_cents,
					},
				});
			}
		}

		return [approvedItems, deniedItems];
	}
}
