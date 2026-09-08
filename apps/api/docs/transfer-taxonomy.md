# Global Trade Treasury Transfer Taxonomy

This document is the human-readable companion to the machine-readable OpenAPI taxonomy under `x-gtt-transfer-taxonomy`.

Scope:
- Product and business readers
- Shared language for transfer scenarios
- Alignment with API behavior and error contracts

Source of truth:
- Machine-readable: OpenAPI extension field `x-gtt-transfer-taxonomy`
- Human-readable: this markdown document

## 1) Transfer Type Enum

The umbrella concept is `transfer` with three canonical types:

1. `funding_instruction`
2. `transfer_instruction`
3. `payment_instruction`

Definitions:
- `funding_instruction`: Fiat-to-ADA funding. Used when liquidity originates from a verified fiat-linked route and funds an ADA.
- `transfer_instruction`: ADA-to-ADA transfer for ADAs owned by the same business client.
- `payment_instruction`: ADA-to-ADA payment for ADAs owned by different business clients.

Consumer integration disambiguation:
- `transferSubtype` must be provided for ADA-to-ADA instruction requests.
- Allowed values: `transfer_instruction` or `payment_instruction`.

Sprint 7-3 business client consumer cases:
1. Same business client ADA-to-ADA: `transferSubtype=transfer_instruction` (implementation improvement)
2. Different business clients, same tenancy/site: `transferSubtype=payment_instruction` (implementation improvement)
3. Different business clients across tenancy/site: `transferSubtype=payment_instruction` (new construction)

Payment instruction scope variants:
1. Different clients, same tenancy/site: supported
2. Different clients across different tenancy or GTT site: planned (requires dedicated cross-site orchestration flow)

## 2) Required Fields Per Type

### Funding Instruction
Endpoint:
- `POST /business/me/funding-instructions`

Required body fields:
1. `sourceAccountOfDigitalAssetId`
2. `destinationAccountOfDigitalAssetId`
3. `amountMinorUnits`

Common optional fields:
1. `fundingType`
2. `provider`
3. `assetCode`
4. `currency`

Auth:
- Supabase business user bearer token, or
- Business API key with `payment-instruction.create`

### Payment Instruction
Endpoint:
- `POST /internal/treasury/payment-instructions`

Required body fields:
1. `sourceAccountOfDigitalAssetId`
2. `destinationAccountOfDigitalAssetId`
3. `amountMinorUnits`
4. `transferSubtype`
5. `instructionType`

Common optional fields:
1. `externalizationIntent`

Auth:
- Service API key with treasury write permissions

### Transfer Instruction
Endpoint:
- `POST /internal/treasury/payment-instructions`

Required body fields:
1. `sourceAccountOfDigitalAssetId`
2. `destinationAccountOfDigitalAssetId`
3. `amountMinorUnits`
4. `transferSubtype`
5. `instructionType`

Common optional fields:
1. `externalizationIntent`

Auth:
- Service API key with treasury write permissions

## 3) Validation Rules Per Scenario

### Scenario A: Fiat -> ADA Funding
Transfer type:
- `funding_instruction`

Rules:
1. Source and destination IDs must be UUID.
2. `amountMinorUnits` must be a positive integer string.
3. Both ADAs must be active and owned by the authenticated business client.
4. Source must have a verified fiat route.
5. Destination must have a verified USDC-capable route.

Common errors:
- `source_destination_and_amount_required`
- `source_and_destination_must_be_uuid`
- `amount_must_be_positive`
- `account_not_authorized_for_business_client`
- `active_source_and_destination_required`
- `verified_source_fiat_route_required`
- `verified_destination_usdc_route_required`
- `business_user_auth_required`

### Scenario B: ADA -> ADA Virtual Transfer
Transfer type:
- `transfer_instruction`
Scope variant:
- Same client, same tenancy/site

Rules:
1. `transferSubtype` is required and must equal `transfer_instruction`.
1. `instructionType` must map to a deterministic policy class.
2. Unknown `instructionType` is rejected before persistence.
3. Ambiguous `externalizationIntent` values are rejected.
4. If `externalizationIntent=wallet`, destination must have verified wallet route.
5. If `externalizationIntent=fiat`, relevant fiat route requirements must be satisfied.

Common errors:
- `instruction_type_policy_unmapped`
- `instruction_policy_ambiguous`
- `verified_destination_wallet_route_required`
- `verified_destination_fiat_route_required`
- `verified_source_fiat_route_required`

### Scenario C: Cross-Client ADA Transfer
Transfer type:
- `payment_instruction`
Scope variant:
- Different clients, same tenancy/site

Rules:
1. `transferSubtype` is required and must equal `payment_instruction`.
1. Both ADAs must exist and be policy-eligible for selected `instructionType`.
2. Routing selection should produce deterministic route evidence before execution.
3. Execution should emit settlement and audit events linked to the instruction.

### Scenario D: Cross-Tenancy or Cross-Site ADA Transfer
Transfer type:
- `payment_instruction`
Scope variant:
- Different clients across different tenancy or GTT site
Support status:
- Planned

Rules:
1. `transferSubtype` is required and must equal `payment_instruction`.
1. Do not treat this as a standard same-tenancy payment instruction.
2. Require explicit source tenancy/site and destination tenancy/site identity context.
3. Require inter-site routing policy and reconciliation boundary.
4. Require settlement evidence trail per tenancy/site boundary.
5. Recommended temporary approach: bridge-style orchestrated flow until dedicated APIs are published.

## 4) Example Request/Response Per Scenario

### Example 1: Funding Instruction (Fiat -> ADA)
Request:
```http
POST /business/me/funding-instructions
Authorization: Bearer gtt_live_example.readwrite
Idempotency-Key: idem-funding-001
Content-Type: application/json

{
  "sourceAccountOfDigitalAssetId": "00000000-0000-4000-8000-000000000301",
  "destinationAccountOfDigitalAssetId": "00000000-0000-4000-8000-000000000302",
  "amountMinorUnits": "2500000"
}
```

Response (201):
```json
{
  "fundingInstruction": {
    "id": "uuid",
    "sourceAccountOfDigitalAssetId": "uuid",
    "destinationAccountOfDigitalAssetId": "uuid",
    "amountMinorUnits": "2500000",
    "status": "pending_usdc_reserved"
  },
  "orders": [
    {
      "orderKind": "ada_wire_transfer",
      "stage": "fiat_received",
      "status": "created"
    },
    {
      "orderKind": "ada_usdc_transfer",
      "stage": "usdc_delivered",
      "status": "blocked_dependency"
    }
  ]
}
```

### Example 2: Payment Instruction (ADA -> ADA Virtual Transfer)
Request:
```http
POST /internal/treasury/payment-instructions
Content-Type: application/json

{
  "sourceAccountOfDigitalAssetId": "00000000-0000-4000-8000-000000000111",
  "destinationAccountOfDigitalAssetId": "00000000-0000-4000-8000-000000000222",
  "amountMinorUnits": "2500000",
  "transferSubtype": "transfer_instruction",
  "instructionType": "internal_ada_settlement"
}
```

### Example 2b: Payment Instruction (ADA -> ADA Across Different Clients, Same Tenancy)
Request:
```http
POST /internal/treasury/payment-instructions
Content-Type: application/json

{
  "sourceAccountOfDigitalAssetId": "00000000-0000-4000-8000-000000000333",
  "destinationAccountOfDigitalAssetId": "00000000-0000-4000-8000-000000000444",
  "amountMinorUnits": "500000",
  "transferSubtype": "payment_instruction",
  "instructionType": "internal_ada_settlement"
}
```

Response (201):
```json
{
  "instruction": {
    "id": "uuid",
    "instructionType": "internal_ada_settlement",
    "routeType": "unrouted",
    "status": "draft"
  }
}
```

Classification note:
- This example is `transfer_instruction` because source and destination ADAs are owned by the same business client.

Response (201):
```json
{
  "instruction": {
    "id": "uuid",
    "instructionType": "internal_ada_settlement",
    "routeType": "unrouted",
    "status": "draft"
  }
}
```

### Example 3: Payment Instruction Rejected for Missing Wallet Route
Request:
```http
POST /internal/treasury/payment-instructions
Content-Type: application/json

{
  "sourceAccountOfDigitalAssetId": "00000000-0000-4000-8000-000000000111",
  "destinationAccountOfDigitalAssetId": "00000000-0000-4000-8000-000000000222",
  "amountMinorUnits": "2500000",
  "instructionType": "internal_ada_settlement",
  "externalizationIntent": "wallet"
}
```

Response (409):
```json
{
  "error": "verified_destination_wallet_route_required"
}
```

### Example 4: Cross-Tenancy/Cross-Site ADA Transfer (Planned)
Current behavior:
- Treat as planned scope, not a standard same-tenancy payment instruction contract.

Recommended near-term pattern:
1. Origin site performs policy checks and reserves funds.
2. Inter-site orchestration route is selected with explicit source and destination tenancy/site IDs.
3. Destination site confirms credit and emits settlement evidence.
4. Both sites reconcile using correlated instruction identifiers.

## Practical Decision Rule

Ask first:
- Is the source rail fiat or ADA?

Decision:
1. Fiat source -> use `funding_instruction`
2. ADA source and same business client -> use `transfer_instruction`
3. ADA source and different business clients -> use `payment_instruction`

## Notes

- Keep `transfer` as umbrella language only.
- For implementation and contract automation, always use the OpenAPI `x-gtt-transfer-taxonomy` extension as the machine-readable source of truth.
