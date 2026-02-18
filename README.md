# n8n-nodes-kora

**n8n community node for Kora — deterministic authorization for AI agent spending.**

**Financial authorization gate for AI agent workflows.** Drop one node into any n8n workflow — every spend gets an APPROVED or DENIED decision with a cryptographic Ed25519 seal before money moves.

No Kora approval → no payment. By design.

---

## What It Does

Kora sits between your AI agent and any payment. The agent asks "can I spend €50 on AWS?" — Kora checks the mandate (daily limits, monthly limits, vendor allowlist, time windows) and returns a deterministic yes or no. Not probabilistic. Not ML. Pure rule evaluation with cryptographic proof.

**Three operations, one node:**

| Operation | What happens |
|---|---|
| **Authorize Spend** | Agent requests permission → APPROVED with seal, or DENIED with reason + suggestion |
| **Check Budget** | Read-only: how much is left today/this month, percent used |
| **Health Check** | Is Kora reachable? Check before attempting a spend |

**Two outputs on Authorize Spend:**
- **Output 0 (Approved)** → connect your payment node here
- **Output 1 (Denied)** → connect your notification/log node here

No separate IF node needed. The Kora node branches for you.

## Fail-Closed

If Kora is down (5xx, timeout, unreachable), the workflow **stops**. The node throws an error. Your payment node never fires.

This is not configurable. No "continue on error" workaround. If you can't verify authorization, you can't spend money.

## Install

**n8n Community Nodes:**
Settings → Community Nodes → Install → `n8n-nodes-kora`

**Self-hosted n8n:**
```bash
cd ~/.n8n
npm install n8n-nodes-kora
# restart n8n
```

## Setup

1. Go to **Credentials** → **New Credential** → **Kora API**
2. Enter:
   - **Agent Secret Key**: `kora_agent_sk_...` (from Kora admin API)
   - **Mandate ID**: `mandate_abc123def456` (the spending mandate for this agent)
   - **API URL**: `https://api.koraprotocol.com` (default)
3. Add a **Kora** node to any workflow
4. Select operation: Authorize Spend / Check Budget / Health Check
5. Connect Approved output to your payment step, Denied output to your alert step

## Example: AI Agent with Spending Controls

```
[Webhook Trigger] → [Kora: Authorize Spend] → Approved → [Stripe: Create Payment]
                                              → Denied  → [Slack: Notify "Spend denied"]
```

The agent submits a spend request. Kora checks:
- Is the amount within the daily limit?
- Is the vendor on the allowlist?
- Is the monthly budget exhausted?
- Is it within the allowed time window?

If everything passes → APPROVED with Ed25519 seal + payment routing.
If anything fails → DENIED with machine-readable reason + human-readable suggestion.

## What Kora Returns

**Approved:**
```json
{
  "decision": "APPROVED",
  "seal_signature": "dGVzdF9zaWduYXR1cmU=",
  "seal_algorithm": "Ed25519",
  "payment_iban": "DE89370400440532013000",
  "payment_name": "Amazon Web Services EMEA SARL",
  "daily_remaining_cents": 45000
}
```

**Denied:**
```json
{
  "decision": "DENIED",
  "reason_code": "DAILY_LIMIT_EXCEEDED",
  "denial_message": "Transaction would exceed daily limit",
  "denial_hint": "Daily limit is €1,000. Current spend: €960.",
  "denial_available_cents": 4000
}
```

## Zero External Dependencies

This node uses zero production npm dependencies. All cryptographic operations (Ed25519 signing, canonical JSON, nonce generation) use Node.js built-in `crypto`. HTTP calls use n8n's native `this.helpers.httpRequest`. This passes n8n's security scanner for Cloud deployment.

## Links

- **Kora**: [github.com/Idkasam/Kora](https://github.com/Idkasam/Kora)
- **API Reference**: [API_REFERENCE.md](https://github.com/Idkasam/Kora/blob/main/docs/API_REFERENCE.md)
- **MCP Server**: [github.com/Idkasam/kora-mcp-server](https://github.com/Idkasam/kora-mcp-server)
- **Patent**: PCT/EP2025/053553

## License

MIT — see [LICENSE](./LICENSE)
