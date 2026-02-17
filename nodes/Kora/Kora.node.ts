import {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError,
} from 'n8n-workflow';

import {
  parseAgentSecret,
  buildSignedHeaders,
  deriveIntentId,
  generateNonce,
} from './transport/koraClient';

async function doSpend(
  ctx: IExecuteFunctions,
  itemIndex: number,
  credentials: any,
  apiUrl: string,
  mandateId: string,
): Promise<Record<string, any>> {
  const keys = parseAgentSecret(credentials.agentSecret as string);
  const executionId = ctx.getExecutionId() ?? 'unknown';
  const amountCents = ctx.getNodeParameter('amountCents', itemIndex) as number;
  const currency = ctx.getNodeParameter('currency', itemIndex) as string;
  const vendor = ctx.getNodeParameter('vendor', itemIndex) as string;
  const category = ctx.getNodeParameter('category', itemIndex) as string;
  const purpose = ctx.getNodeParameter('purpose', itemIndex) as string;

  if (amountCents <= 0) {
    throw new NodeOperationError(ctx.getNode(), 'Amount must be greater than 0', { itemIndex });
  }

  // Signed fields must match server's verify_signature_with_key exactly:
  // intent_id, agent_id, mandate_id, amount_cents, currency, vendor_id, nonce, ttl_seconds
  // (plus payment_instruction and metadata only when non-empty)
  const signedFields: Record<string, any> = {
    intent_id: deriveIntentId(executionId, itemIndex, 'authorize'),
    agent_id: keys.agentId,
    mandate_id: mandateId,
    amount_cents: amountCents,
    currency: currency,
    vendor_id: vendor,
    nonce: generateNonce(),
    ttl_seconds: 300,
  };

  const { headers } = buildSignedHeaders(signedFields, keys);

  // Full HTTP body may include extra fields the server processes but does not sign
  const body: Record<string, any> = { ...signedFields };
  if (category) body.category = category;
  if (purpose) body.purpose = purpose;

  const response = await ctx.helpers.httpRequest({
    method: 'POST',
    url: `${apiUrl}/v1/authorize`,
    headers,
    body: JSON.stringify(body),
    returnFullResponse: true,
  });

  const data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;

  return {
    decision: data.decision,
    decision_id: data.decision_id,
    reason_code: data.reason_code,
    amount_cents: data.amount_cents,
    currency: data.currency,
    executable: data.executable,
    seal_signature: data.seal?.signature ?? null,
    seal_algorithm: data.seal?.algorithm ?? null,
    payment_iban: data.payment_instruction?.recipient_iban ?? null,
    payment_name: data.payment_instruction?.recipient_name ?? null,
    payment_bic: data.payment_instruction?.recipient_bic ?? null,
    denial_message: data.denial?.message ?? null,
    denial_hint: data.denial?.hint ?? null,
    denial_available_cents: data.denial?.actionable?.available_cents ?? null,
    daily_remaining_cents: data.limits_after_approval?.daily_remaining_cents ?? null,
    monthly_remaining_cents: data.limits_after_approval?.monthly_remaining_cents ?? null,
  };
}

async function doBudget(
  ctx: IExecuteFunctions,
  itemIndex: number,
  credentials: any,
  apiUrl: string,
  mandateId: string,
): Promise<Record<string, any>> {
  const keys = parseAgentSecret(credentials.agentSecret as string);

  const body = { mandate_id: mandateId };
  const { canonicalBody, headers } = buildSignedHeaders(body, keys);

  const response = await ctx.helpers.httpRequest({
    method: 'POST',
    url: `${apiUrl}/v1/mandates/${mandateId}/budget`,
    headers,
    body: canonicalBody,
    returnFullResponse: true,
  });

  const data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
  const dailyLimit = data.daily?.limit_cents ?? 0;
  const dailySpent = data.daily?.spent_cents ?? 0;

  return {
    mandate_id: data.mandate_id,
    currency: data.currency,
    status: data.status,
    daily_limit_cents: dailyLimit,
    daily_spent_cents: dailySpent,
    daily_remaining_cents: data.daily?.remaining_cents ?? 0,
    monthly_limit_cents: data.monthly?.limit_cents ?? 0,
    monthly_spent_cents: data.monthly?.spent_cents ?? 0,
    monthly_remaining_cents: data.monthly?.remaining_cents ?? 0,
    can_spend: data.spend_allowed ?? false,
    percent_daily_used: dailyLimit > 0 ? Math.round((dailySpent / dailyLimit) * 100) : 0,
  };
}

async function doHealth(
  ctx: IExecuteFunctions,
  apiUrl: string,
): Promise<Record<string, any>> {
  try {
    const response = await ctx.helpers.httpRequest({
      method: 'GET',
      url: `${apiUrl}/health`,
      returnFullResponse: true,
    });
    const data = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
    return { healthy: true, version: data.version ?? 'unknown', database: data.database ?? 'unknown' };
  } catch (error: any) {
    return { healthy: false, error: error.message };
  }
}

export class Kora implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Kora',
    name: 'kora',
    icon: 'file:kora.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Deterministic financial authorization for AI agent spending. APPROVED or DENIED with Ed25519 cryptographic seal.',
    defaults: {
      name: 'Kora',
    },
    inputs: ['main'],
    outputs: ['main', 'main'],
    outputNames: ['Approved', 'Denied'],
    credentials: [
      {
        name: 'koraApi',
        required: true,
      },
    ],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Authorize Spend',
            value: 'spend',
            description: 'Request authorization to spend. Returns APPROVED or DENIED.',
            action: 'Authorize a spend request',
          },
          {
            name: 'Check Budget',
            value: 'checkBudget',
            description: 'Check remaining budget without spending.',
            action: 'Check remaining budget',
          },
          {
            name: 'Health Check',
            value: 'health',
            description: 'Check if Kora is available.',
            action: 'Check service health',
          },
        ],
        default: 'spend',
      },
      {
        displayName: 'Amount (Cents)',
        name: 'amountCents',
        type: 'number',
        default: 0,
        required: true,
        description: 'Amount in cents. 5000 = €50.00.',
        displayOptions: { show: { operation: ['spend'] } },
      },
      {
        displayName: 'Currency',
        name: 'currency',
        type: 'options',
        options: [
          { name: 'EUR', value: 'EUR' },
          { name: 'USD', value: 'USD' },
          { name: 'GBP', value: 'GBP' },
          { name: 'SEK', value: 'SEK' },
        ],
        default: 'EUR',
        required: true,
        displayOptions: { show: { operation: ['spend'] } },
      },
      {
        displayName: 'Vendor',
        name: 'vendor',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'aws',
        description: 'Lowercase vendor identifier.',
        displayOptions: { show: { operation: ['spend'] } },
      },
      {
        displayName: 'Category',
        name: 'category',
        type: 'string',
        default: '',
        placeholder: 'cloud_compute',
        description: 'Spending category (optional).',
        displayOptions: { show: { operation: ['spend'] } },
      },
      {
        displayName: 'Purpose',
        name: 'purpose',
        type: 'string',
        default: '',
        placeholder: 'Monthly server hosting',
        description: 'Why this spend is needed (optional).',
        displayOptions: { show: { operation: ['spend'] } },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const operation = this.getNodeParameter('operation', 0) as string;
    const credentials = await this.getCredentials('koraApi');

    const apiUrl = (credentials.apiUrl as string) || 'https://api.koraprotocol.com';
    const mandateId = credentials.mandateId as string;

    const approved: INodeExecutionData[] = [];
    const denied: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        if (operation === 'spend') {
          const result = await doSpend(this, i, credentials, apiUrl, mandateId);
          if (result.decision === 'APPROVED') {
            approved.push({ json: result, pairedItem: { item: i } });
          } else {
            denied.push({ json: result, pairedItem: { item: i } });
          }
        } else if (operation === 'checkBudget') {
          const result = await doBudget(this, i, credentials, apiUrl, mandateId);
          approved.push({ json: result, pairedItem: { item: i } });
        } else if (operation === 'health') {
          const result = await doHealth(this, apiUrl);
          approved.push({ json: result, pairedItem: { item: i } });
        }
      } catch (error: any) {
        if (this.continueOnFail()) {
          denied.push({ json: { error: error.message }, pairedItem: { item: i } });
          continue;
        }
        if (error instanceof NodeOperationError) throw error;
        const status = Number(error?.httpCode ?? error?.response?.status ?? error?.statusCode ?? 0);
        const body = error?.response?.body;
        let serverMsg = '';
        if (body) {
          try {
            const parsed = typeof body === 'string' ? JSON.parse(body) : body;
            serverMsg = parsed.message ?? parsed.error?.message ?? parsed.detail ?? '';
          } catch {}
        }
        if (status === 400) {
          throw new NodeOperationError(this.getNode(), `Bad request: ${serverMsg || error.message}`, { itemIndex: i });
        }
        if (status === 401) {
          throw new NodeOperationError(this.getNode(), 'Invalid credentials', { itemIndex: i });
        }
        if (status === 403) {
          throw new NodeOperationError(this.getNode(), 'Forbidden', { itemIndex: i });
        }
        if (status === 404) {
          throw new NodeOperationError(this.getNode(), `Not found: ${serverMsg || error.message}`, { itemIndex: i });
        }
        if (status === 429) {
          throw new NodeOperationError(this.getNode(), 'Rate limited — retry later', { itemIndex: i });
        }
        if (status >= 500) {
          throw new NodeOperationError(
            this.getNode(),
            `Kora returned ${status}. Workflow stopped — no authorization = no payment.`,
            { itemIndex: i },
          );
        }
        throw new NodeOperationError(
          this.getNode(),
          `Kora unavailable: ${error.message}. No authorization = no payment.`,
          { itemIndex: i },
        );
      }
    }

    return [approved, denied];
  }
}
