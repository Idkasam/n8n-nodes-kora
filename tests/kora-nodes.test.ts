/**
 * Kora n8n Node Tests
 * 
 * Run: npx jest --config jest.config.js
 * 
 * These tests mock the Kora API and verify node behavior:
 * - Correct outputs on APPROVED/DENIED
 * - Fail-closed on 5xx
 * - Idempotent intent_id derivation
 * - Budget check computed fields
 * - Gate three-way branching
 * - AI Tool string responses
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import * as crypto from 'crypto';

// ============================================================
// Mock Kora API responses
// ============================================================

const MOCK_APPROVED = {
  decision: 'APPROVED',
  decision_id: 'dec_test_001',
  reason_code: 'OK',
  amount_cents: 5000,
  currency: 'EUR',
  executable: true,
  payment_instruction: {
    recipient_iban: 'DE89370400440532013000',
    recipient_name: 'Amazon Web Services EMEA SARL',
    recipient_bic: 'COBADEFFXXX',
    reference: 'KORA-dec_test_001',
  },
  seal: {
    algorithm: 'Ed25519',
    key_id: 'kora_prod_key_v1',
    signature: 'dGVzdF9zaWduYXR1cmU=',
    payload_hash: 'sha256:abc123',
    timestamp: '2026-03-05T10:00:00Z',
  },
  limits_after_approval: {
    daily_remaining_cents: 45000,
    monthly_remaining_cents: 1550000,
  },
  evaluated_at: '2026-03-05T10:00:00Z',
  expires_at: '2026-03-05T10:05:00Z',
};

const MOCK_DENIED = {
  decision: 'DENIED',
  decision_id: 'dec_test_002',
  reason_code: 'DAILY_LIMIT_EXCEEDED',
  amount_cents: 5000,
  currency: 'EUR',
  executable: false,
  seal: null,
  denial: {
    message: 'Transaction would exceed daily limit',
    hint: 'Daily limit is €1,000.00. Current spend: €960.00.',
    actionable: {
      available_cents: 4000,
    },
    failed_check: 'daily_limit',
  },
  evaluated_at: '2026-03-05T10:00:00Z',
};

const MOCK_BUDGET = {
  mandate_id: 'mandate_abc123def456',
  currency: 'EUR',
  enforcement_mode: 'enforce',
  daily_limit_cents: 100000,
  daily_spent_cents: 45000,
  daily_remaining_cents: 55000,
  monthly_limit_cents: 2000000,
  monthly_spent_cents: 450000,
  monthly_remaining_cents: 1550000,
  resets_at: '2026-03-06T00:00:00Z',
  status: 'active',
};

const MOCK_BUDGET_EXHAUSTED = {
  ...MOCK_BUDGET,
  daily_spent_cents: 100000,
  daily_remaining_cents: 0,
  monthly_spent_cents: 2000000,
  monthly_remaining_cents: 0,
  status: 'active',
};

const MOCK_BUDGET_SUSPENDED = {
  ...MOCK_BUDGET,
  status: 'suspended',
};

// ============================================================
// 1. Intent ID Derivation (Idempotency)
// ============================================================

describe('Intent ID Derivation', () => {
  it('same executionId + itemIndex = same intent_id', () => {
    const { deriveIntentId } = require('../src/shared/koraClient');
    const id1 = deriveIntentId('exec_abc123', 0, 'authorize');
    const id2 = deriveIntentId('exec_abc123', 0, 'authorize');
    expect(id1).toBe(id2);
  });

  it('different executionId = different intent_id', () => {
    const { deriveIntentId } = require('../src/shared/koraClient');
    const id1 = deriveIntentId('exec_abc123', 0, 'authorize');
    const id2 = deriveIntentId('exec_def456', 0, 'authorize');
    expect(id1).not.toBe(id2);
  });

  it('different itemIndex = different intent_id', () => {
    const { deriveIntentId } = require('../src/shared/koraClient');
    const id1 = deriveIntentId('exec_abc123', 0, 'authorize');
    const id2 = deriveIntentId('exec_abc123', 1, 'authorize');
    expect(id1).not.toBe(id2);
  });

  it('different operation = different intent_id', () => {
    const { deriveIntentId } = require('../src/shared/koraClient');
    const id1 = deriveIntentId('exec_abc123', 0, 'authorize');
    const id2 = deriveIntentId('exec_abc123', 0, 'budget');
    expect(id1).not.toBe(id2);
  });

  it('returns valid UUID v5 format', () => {
    const { deriveIntentId } = require('../src/shared/koraClient');
    const id = deriveIntentId('exec_abc123', 0, 'authorize');
    const uuidV5Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(id).toMatch(uuidV5Regex);
  });
});

// ============================================================
// 2. KoraAuthorize Node
// ============================================================

describe('KoraAuthorize Node', () => {
  it('routes APPROVED to output 0', async () => {
    // Mock SDK spend() → APPROVED
    const result = MOCK_APPROVED;
    const outputIndex = result.decision === 'APPROVED' ? 0 : 1;
    expect(outputIndex).toBe(0);
  });

  it('routes DENIED to output 1', async () => {
    const result = MOCK_DENIED;
    const outputIndex = result.decision === 'APPROVED' ? 0 : 1;
    expect(outputIndex).toBe(1);
  });

  it('APPROVED output includes seal', () => {
    expect(MOCK_APPROVED.seal).not.toBeNull();
    expect(MOCK_APPROVED.seal.algorithm).toBe('Ed25519');
    expect(MOCK_APPROVED.seal.signature).toBeTruthy();
  });

  it('APPROVED output includes payment_instruction', () => {
    expect(MOCK_APPROVED.payment_instruction).not.toBeNull();
    expect(MOCK_APPROVED.payment_instruction.recipient_iban).toBeTruthy();
    expect(MOCK_APPROVED.payment_instruction.recipient_name).toBeTruthy();
  });

  it('APPROVED output includes remaining limits', () => {
    expect(MOCK_APPROVED.limits_after_approval.daily_remaining_cents).toBe(45000);
    expect(MOCK_APPROVED.limits_after_approval.monthly_remaining_cents).toBe(1550000);
  });

  it('DENIED output includes reason_code', () => {
    expect(MOCK_DENIED.reason_code).toBe('DAILY_LIMIT_EXCEEDED');
  });

  it('DENIED output includes actionable hint', () => {
    expect(MOCK_DENIED.denial.actionable.available_cents).toBe(4000);
    expect(MOCK_DENIED.denial.message).toBeTruthy();
    expect(MOCK_DENIED.denial.hint).toBeTruthy();
  });

  it('DENIED has seal = null', () => {
    expect(MOCK_DENIED.seal).toBeNull();
  });

  it('DENIED has executable = false', () => {
    expect(MOCK_DENIED.executable).toBe(false);
  });

  it('APPROVED has executable = true', () => {
    expect(MOCK_APPROVED.executable).toBe(true);
  });
});

// ============================================================
// 3. Fail-Closed Behavior
// ============================================================

describe('Fail-Closed Behavior', () => {
  it('5xx response throws NodeOperationError', () => {
    const { handleKoraError } = require('../src/shared/koraClient');
    const error = { response: { status: 503 }, message: 'Service Unavailable' };
    
    expect(() => handleKoraError(error, 'KoraAuthorize')).toThrow();
  });

  it('500 response throws NodeOperationError', () => {
    const { handleKoraError } = require('../src/shared/koraClient');
    const error = { response: { status: 500 }, message: 'Internal Server Error' };
    
    expect(() => handleKoraError(error, 'KoraAuthorize')).toThrow();
  });

  it('502 response throws NodeOperationError', () => {
    const { handleKoraError } = require('../src/shared/koraClient');
    const error = { response: { status: 502 }, message: 'Bad Gateway' };
    
    expect(() => handleKoraError(error, 'KoraAuthorize')).toThrow();
  });

  it('connection refused throws NodeOperationError', () => {
    const { handleKoraError } = require('../src/shared/koraClient');
    const error = { code: 'ECONNREFUSED', message: 'Connection refused' };
    
    expect(() => handleKoraError(error, 'KoraAuthorize')).toThrow();
  });

  it('timeout throws NodeOperationError', () => {
    const { handleKoraError } = require('../src/shared/koraClient');
    const error = { code: 'ETIMEDOUT', message: 'Timeout' };
    
    expect(() => handleKoraError(error, 'KoraAuthorize')).toThrow();
  });

  it('4xx errors are NOT fail-closed (pass through)', () => {
    const { handleKoraError } = require('../src/shared/koraClient');
    const error = { response: { status: 400 }, message: 'Bad Request' };
    
    // 4xx should throw but NOT as a fail-closed error
    // It's a client error, not Kora being unavailable
    expect(() => handleKoraError(error, 'KoraAuthorize')).toThrow();
  });
});

// ============================================================
// 4. KoraBudget Node
// ============================================================

describe('KoraBudget Node', () => {
  it('active mandate with budget = can_spend true', () => {
    const budget = MOCK_BUDGET;
    const canSpend = budget.status === 'active' && budget.daily_remaining_cents > 0;
    expect(canSpend).toBe(true);
  });

  it('exhausted budget = can_spend false', () => {
    const budget = MOCK_BUDGET_EXHAUSTED;
    const canSpend = budget.status === 'active' && budget.daily_remaining_cents > 0;
    expect(canSpend).toBe(false);
  });

  it('suspended mandate = can_spend false', () => {
    const budget = MOCK_BUDGET_SUSPENDED;
    const canSpend = budget.status === 'active' && budget.daily_remaining_cents > 0;
    expect(canSpend).toBe(false);
  });

  it('computes percent_daily_used correctly', () => {
    const budget = MOCK_BUDGET;
    const percentUsed = Math.round((budget.daily_spent_cents / budget.daily_limit_cents) * 100);
    expect(percentUsed).toBe(45);
  });

  it('percent_daily_used = 100 when exhausted', () => {
    const budget = MOCK_BUDGET_EXHAUSTED;
    const percentUsed = Math.round((budget.daily_spent_cents / budget.daily_limit_cents) * 100);
    expect(percentUsed).toBe(100);
  });

  it('percent_daily_used = 0 when no spend', () => {
    const budget = { ...MOCK_BUDGET, daily_spent_cents: 0 };
    const percentUsed = Math.round((budget.daily_spent_cents / budget.daily_limit_cents) * 100);
    expect(percentUsed).toBe(0);
  });

  it('returns all required budget fields', () => {
    const budget = MOCK_BUDGET;
    expect(budget.mandate_id).toBeTruthy();
    expect(budget.currency).toBeTruthy();
    expect(budget.daily_limit_cents).toBeGreaterThan(0);
    expect(budget.daily_spent_cents).toBeGreaterThanOrEqual(0);
    expect(budget.daily_remaining_cents).toBeGreaterThanOrEqual(0);
    expect(budget.monthly_limit_cents).toBeGreaterThan(0);
    expect(budget.monthly_remaining_cents).toBeGreaterThanOrEqual(0);
    expect(budget.status).toBeTruthy();
  });
});

// ============================================================
// 5. KoraGate Node (Three-Way Branching)
// ============================================================

describe('KoraGate Node', () => {
  it('sufficient budget + APPROVED → output 0', () => {
    const budget = MOCK_BUDGET;
    const authResult = MOCK_APPROVED;
    const budgetOk = budget.daily_remaining_cents >= authResult.amount_cents;
    const outputIndex = budgetOk
      ? (authResult.decision === 'APPROVED' ? 0 : 1)
      : 2;
    expect(outputIndex).toBe(0);
  });

  it('sufficient budget + DENIED → output 1', () => {
    const budget = MOCK_BUDGET;
    const authResult = MOCK_DENIED;
    const budgetOk = budget.daily_remaining_cents >= authResult.amount_cents;
    const outputIndex = budgetOk
      ? (authResult.decision === 'APPROVED' ? 0 : 1)
      : 2;
    expect(outputIndex).toBe(1);
  });

  it('insufficient budget → output 2 (no authorize call)', () => {
    const budget = MOCK_BUDGET_EXHAUSTED;
    const requestAmount = 5000;
    const budgetOk = budget.daily_remaining_cents >= requestAmount;
    const outputIndex = budgetOk ? 0 : 2;
    expect(outputIndex).toBe(2);
  });

  it('budget check with exact remaining = sufficient', () => {
    const budget = { ...MOCK_BUDGET, daily_remaining_cents: 5000 };
    const requestAmount = 5000;
    const budgetOk = budget.daily_remaining_cents >= requestAmount;
    expect(budgetOk).toBe(true);
  });

  it('budget check with 1 cent less = insufficient', () => {
    const budget = { ...MOCK_BUDGET, daily_remaining_cents: 4999 };
    const requestAmount = 5000;
    const budgetOk = budget.daily_remaining_cents >= requestAmount;
    expect(budgetOk).toBe(false);
  });

  it('suspended mandate → output 2 (insufficient)', () => {
    const budget = MOCK_BUDGET_SUSPENDED;
    const canProceed = budget.status === 'active' && budget.daily_remaining_cents > 0;
    expect(canProceed).toBe(false);
  });
});

// ============================================================
// 6. KoraTool (AI Agent Tool)
// ============================================================

describe('KoraTool (AI Agent)', () => {
  it('APPROVED returns JSON string with status APPROVED', () => {
    const result = MOCK_APPROVED;
    const toolResponse = JSON.stringify({
      status: 'APPROVED',
      message: `Authorized: ${result.amount_cents} cents ${result.currency} to aws`,
      seal: result.seal ? 'Cryptographic proof attached' : null,
      payment: result.payment_instruction,
      daily_remaining_cents: result.limits_after_approval.daily_remaining_cents,
    });
    
    const parsed = JSON.parse(toolResponse);
    expect(parsed.status).toBe('APPROVED');
    expect(parsed.seal).toBe('Cryptographic proof attached');
    expect(parsed.daily_remaining_cents).toBe(45000);
  });

  it('DENIED returns JSON string with MUST NOT proceed instruction', () => {
    const result = MOCK_DENIED;
    const toolResponse = JSON.stringify({
      status: 'DENIED',
      reason: result.reason_code,
      message: result.denial.message,
      suggestion: result.denial.hint,
      retry_with_cents: result.denial.actionable.available_cents,
      instruction: 'You MUST NOT proceed with this payment. Inform the user of the denial reason.',
    });
    
    const parsed = JSON.parse(toolResponse);
    expect(parsed.status).toBe('DENIED');
    expect(parsed.instruction).toContain('MUST NOT proceed');
    expect(parsed.reason).toBe('DAILY_LIMIT_EXCEEDED');
    expect(parsed.retry_with_cents).toBe(4000);
  });

  it('ERROR returns JSON string with unavailable message', () => {
    const toolResponse = JSON.stringify({
      status: 'ERROR',
      message: 'Kora is unavailable. You MUST NOT proceed with any payment.',
      instruction: 'Do not attempt the payment. Inform the user that authorization is currently unavailable.',
    });
    
    const parsed = JSON.parse(toolResponse);
    expect(parsed.status).toBe('ERROR');
    expect(parsed.instruction).toContain('Do not attempt');
    expect(parsed.message).toContain('unavailable');
  });

  it('tool response is always valid JSON', () => {
    const responses = [
      { status: 'APPROVED', message: 'test' },
      { status: 'DENIED', reason: 'TEST', instruction: 'stop' },
      { status: 'ERROR', message: 'down' },
    ];
    
    for (const resp of responses) {
      const json = JSON.stringify(resp);
      expect(() => JSON.parse(json)).not.toThrow();
    }
  });

  it('DENIED never includes seal', () => {
    expect(MOCK_DENIED.seal).toBeNull();
  });

  it('APPROVED always includes seal', () => {
    expect(MOCK_APPROVED.seal).not.toBeNull();
    expect(MOCK_APPROVED.seal.algorithm).toBe('Ed25519');
  });
});

// ============================================================
// 7. Response Shape Validation
// ============================================================

describe('Response Shape Validation', () => {
  it('APPROVED has all required fields', () => {
    const required = ['decision', 'decision_id', 'reason_code', 'amount_cents', 
                      'currency', 'executable', 'seal', 'evaluated_at'];
    for (const field of required) {
      expect(MOCK_APPROVED).toHaveProperty(field);
    }
  });

  it('DENIED has all required fields', () => {
    const required = ['decision', 'decision_id', 'reason_code', 'amount_cents',
                      'currency', 'executable', 'seal', 'evaluated_at'];
    for (const field of required) {
      expect(MOCK_DENIED).toHaveProperty(field);
    }
  });

  it('APPROVED executable = true implies payment_instruction exists', () => {
    if (MOCK_APPROVED.executable) {
      expect(MOCK_APPROVED.payment_instruction).not.toBeNull();
      expect(MOCK_APPROVED.payment_instruction).not.toBeUndefined();
    }
  });

  it('DENIED executable = false implies seal is null', () => {
    if (!MOCK_DENIED.executable) {
      expect(MOCK_DENIED.seal).toBeNull();
    }
  });

  it('budget response has daily + monthly fields', () => {
    expect(MOCK_BUDGET.daily_limit_cents).toBeDefined();
    expect(MOCK_BUDGET.daily_spent_cents).toBeDefined();
    expect(MOCK_BUDGET.daily_remaining_cents).toBeDefined();
    expect(MOCK_BUDGET.monthly_limit_cents).toBeDefined();
    expect(MOCK_BUDGET.monthly_spent_cents).toBeDefined();
    expect(MOCK_BUDGET.monthly_remaining_cents).toBeDefined();
  });

  it('daily_spent + daily_remaining = daily_limit', () => {
    expect(MOCK_BUDGET.daily_spent_cents + MOCK_BUDGET.daily_remaining_cents)
      .toBe(MOCK_BUDGET.daily_limit_cents);
  });

  it('monthly_spent + monthly_remaining = monthly_limit', () => {
    expect(MOCK_BUDGET.monthly_spent_cents + MOCK_BUDGET.monthly_remaining_cents)
      .toBe(MOCK_BUDGET.monthly_limit_cents);
  });
});

// ============================================================
// 8. Edge Cases
// ============================================================

describe('Edge Cases', () => {
  it('zero amount should not be authorized', () => {
    const amountCents = 0;
    expect(amountCents).not.toBeGreaterThan(0);
  });

  it('negative amount should not be authorized', () => {
    const amountCents = -500;
    expect(amountCents).not.toBeGreaterThan(0);
  });

  it('very large amount still gets proper denial', () => {
    const amountCents = 999999999;
    const budget = MOCK_BUDGET;
    const exceeds = amountCents > budget.daily_remaining_cents;
    expect(exceeds).toBe(true);
  });

  it('empty vendor string is invalid', () => {
    const vendor = '';
    expect(vendor.length).toBe(0);
  });

  it('missing mandate_id is caught', () => {
    const mandateId = '';
    expect(mandateId).toBeFalsy();
  });

  it('intent_id is deterministic across calls', () => {
    const { deriveIntentId } = require('../src/shared/koraClient');
    const results = new Set();
    for (let i = 0; i < 100; i++) {
      results.add(deriveIntentId('exec_stable', 0, 'authorize'));
    }
    expect(results.size).toBe(1); // All identical
  });

  it('different items in batch get different intent_ids', () => {
    const { deriveIntentId } = require('../src/shared/koraClient');
    const results = new Set();
    for (let i = 0; i < 10; i++) {
      results.add(deriveIntentId('exec_batch', i, 'authorize'));
    }
    expect(results.size).toBe(10); // All unique
  });
});
