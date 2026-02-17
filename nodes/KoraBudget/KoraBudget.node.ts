import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import { createKoraClient, handleKoraError } from '../../src/shared/koraClient';
import type { KoraAgentCredentials } from '../../src/shared/types';

export class KoraBudget implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Kora Budget',
		name: 'koraBudget',
		icon: 'file:kora.svg',
		group: ['transform'],
		version: 1,
		subtitle: 'Check Budget',
		description: 'Check remaining budget for a mandate without spending.',
		defaults: { name: 'Kora Budget' },
		inputs: ['main'],
		outputs: ['main'],
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
				description: 'The mandate to check budget for',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('koraAgentApi') as unknown as KoraAgentCredentials;

		for (let i = 0; i < items.length; i++) {
			const mandateId = this.getNodeParameter('mandateId', i) as string;

			try {
				const kora = createKoraClient(
					credentials.agentSecret,
					mandateId,
					credentials.apiUrl,
				);

				const budget = await kora.checkBudget();

				const percentDailyUsed = budget.daily.limitCents > 0
					? Math.round((budget.daily.spentCents / budget.daily.limitCents) * 100)
					: 0;

				const canSpend = budget.status === 'active'
					&& budget.spendAllowed
					&& budget.daily.remainingCents > 0;

				returnData.push({
					json: {
						mandate_id: mandateId,
						currency: budget.currency,
						daily_limit_cents: budget.daily.limitCents,
						daily_spent_cents: budget.daily.spentCents,
						daily_remaining_cents: budget.daily.remainingCents,
						monthly_limit_cents: budget.monthly.limitCents,
						monthly_spent_cents: budget.monthly.spentCents,
						monthly_remaining_cents: budget.monthly.remainingCents,
						status: budget.status,
						can_spend: canSpend,
						percent_daily_used: percentDailyUsed,
					},
				});
			} catch (error) {
				handleKoraError(error, this.getNode());
			}
		}

		return [returnData];
	}
}
