/** Kora agent credentials from n8n credential store. */
export interface KoraAgentCredentials {
	agentSecret: string;
	apiUrl: string;
}

/** Kora admin credentials from n8n credential store. */
export interface KoraAdminCredentials {
	adminKey: string;
	apiUrl: string;
}

/** Normalized authorize response for n8n output. */
export interface AuthorizeOutput {
	decision: 'APPROVED' | 'DENIED';
	decision_id: string;
	reason_code: string;
	amount_cents: number;
	currency: string;
	vendor_id: string;
	seal?: object;
	payment?: {
		recipient_iban: string;
		recipient_name: string;
		recipient_bic: string;
		payment_reference?: string;
	};
	daily_remaining_cents?: number;
	monthly_remaining_cents?: number;
	message?: string;
	suggestion?: string;
	retry_with_cents?: number;
}

/** Normalized budget check output for n8n. */
export interface BudgetOutput {
	mandate_id: string;
	currency: string;
	daily_limit_cents: number;
	daily_spent_cents: number;
	daily_remaining_cents: number;
	monthly_limit_cents: number;
	monthly_spent_cents: number;
	monthly_remaining_cents: number;
	status: string;
	can_spend: boolean;
	percent_daily_used: number;
}
