import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import {
	authorizeSpend,
	createKoraClient,
	deriveIntentId,
	handleKoraError,
} from '../../src/shared/koraClient';
import type { KoraAgentCredentials } from '../../src/shared/types';

export class KoraGate implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Kora Gate',
		name: 'koraGate',
		icon: 'file:kora.svg',
		group: ['transform'],
		version: 1,
		subtitle: 'Budget Check + Authorize + Branch',
		description: 'Combined gate: check budget, authorize, and branch. Drop-in financial control.',
		defaults: { name: 'Kora Gate' },
		inputs: ['main'],
		outputs: ['main', 'main', 'main'],
		outputNames: ['Approved', 'Denied', 'Insufficient'],
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
			},
			{
				displayName: 'Amount (cents)',
				name: 'amountCents',
				type: 'number',
				required: true,
				default: 0,
				description: 'Amount in cents (integer)',
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
			},
			{
				displayName: 'Pre-check Budget',
				name: 'preCheckBudget',
				type: 'boolean',
				default: true,
				description: 'Check budget before authorizing. Skips authorize call if budget is insufficient.',
			},
			{
				displayName: 'Minimum Required (cents)',
				name: 'minimumRequired',
				type: 'number',
				default: 0,
				displayOptions: { show: { preCheckBudget: [true] } },
				description: 'Skip authorization if daily remaining is below this amount. 0 = use the request amount.',
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
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const approvedItems: INodeExecutionData[] = [];
		const deniedItems: INodeExecutionData[] = [];
		const insufficientItems: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('koraAgentApi') as unknown as KoraAgentCredentials;
		const executionId = this.getExecutionId();

		for (let i = 0; i < items.length; i++) {
			const mandateId = this.getNodeParameter('mandateId', i) as string;
			const amountCents = this.getNodeParameter('amountCents', i) as number;
			const currency = this.getNodeParameter('currency', i) as string;
			const vendorId = this.getNodeParameter('vendorId', i) as string;
			const preCheck = this.getNodeParameter('preCheckBudget', i) as boolean;
			const category = this.getNodeParameter('category', i, '') as string;
			const purpose = this.getNodeParameter('purpose', i, '') as string;

			try {
				// Step 1: Optional budget pre-check
				if (preCheck) {
					const kora = createKoraClient(
						credentials.agentSecret,
						mandateId,
						credentials.apiUrl,
					);

					const budget = await kora.checkBudget();
					const minimumRaw = this.getNodeParameter('minimumRequired', i, 0) as number;
					const threshold = minimumRaw > 0 ? minimumRaw : amountCents;

					if (budget.daily.remainingCents < threshold || !budget.spendAllowed) {
						insufficientItems.push({
							json: {
								decision: 'INSUFFICIENT',
								mandate_id: mandateId,
								daily_remaining_cents: budget.daily.remainingCents,
								daily_limit_cents: budget.daily.limitCents,
								requested_cents: amountCents,
								message: `Budget insufficient: ${budget.daily.remainingCents} cents remaining, ${threshold} required`,
							},
						});
						continue;
					}
				}

				// Step 2: Authorize
				const intentId = deriveIntentId(executionId, i, 'gate');

				const result = await authorizeSpend({
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
						},
					});
				}
			} catch (error) {
				handleKoraError(error, this.getNode());
			}
		}

		return [approvedItems, deniedItems, insufficientItems];
	}
}
