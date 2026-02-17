# Kora n8n Node (@idkasam/n8n-nodes-kora)

Autonomous software is starting to make irreversible economic decisions: Payments, Procurement, and Commitments. The problem isn't that the money isn't there — it's that the financial system is built to trust humans, not machines. 

**Kora authorizes irreversible economic actions by autonomous software.**

This n8n node allows you to integrate the Kora Authority Layer directly into your automated workflows. Before your workflow moves money, hits a paid API, or commits to a vendor, it asks Kora for permission.

## How it Works in n8n
1. **The Request:** Your n8n workflow sends a request to Kora (Vendor, Amount, Currency, Reason).
2. **The Evaluation:** Kora evaluates the request against admin-defined **Mandates** (budgets, allowed vendors, time windows).
3. **The Decision:** Kora returns a deterministic `APPROVED` or `DENIED` decision.
4. **The Seal:** Every approval is sealed with a verifiable **Ed25519 cryptographic signature**.

> **Note:** Kora authorizes intent. It does not move money or hold funds. It provides the "Go/No-Go" decision and the notary seal required for the next step in your workflow.

## Core Features
* **Deterministic Pipeline:** No ML, no guessing. Same inputs → same decision. Every time.
* **Mandate Enforcement:** Apply velocity caps and department-level procurement rules to your agents.
* **Cryptographic Notary Seal:** Every approval includes an Ed25519 seal, verifiable offline.
* **Task Budget Envelopes:** Scope n8n executions to specific spending limits (e.g., "This research task has a $20 API budget").

## Installation
1. In n8n, go to **Settings > Community Nodes**.
2. Install `@idkasam/n8n-nodes-kora`.
3. Create a **Kora API** credential using your Secret Key and Mandate ID.

## Technical Details
* **License:** AGPL-3.0
* **Patent:** PCT/EP2025/053553
* **Author:** [idkasam](https://koraprotocol.com)

---
*Kora: The Authority Layer for Autonomous Agents.*
