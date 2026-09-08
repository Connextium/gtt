export interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
  security?: Array<Record<string, string[]>>;
  components?: Record<string, unknown>;
  paths: Record<string, unknown>;
  [extension: `x-${string}`]: unknown;
}

const localServer = [{ url: "http://localhost:4000", description: "Local development server" }];

const transferTaxonomy = {
  sectionVersion: "1.3.0",
  umbrella: "transfer",
  transferTypeEnum: [
    "funding_instruction",
    "transfer_instruction",
    "payment_instruction"
  ],
  transferSubtypeEnum: [
    "transfer_instruction",
    "payment_instruction"
  ],
  transferTypes: {
    funding_instruction: {
      canonicalLabel: "Fiat-to-ADA Funding",
      primaryIntent: "Fund an ADA balance from a verified fiat-linked route.",
      canonicalRoutes: [
        "/business/me/funding-instructions",
        "/business/me/funding-instructions/{id}",
        "/business/me/funding-instructions/{id}/orders"
      ]
    },
    transfer_instruction: {
      canonicalLabel: "Fund Transfer Instruction",
      primaryIntent: "Transfer funds between ADAs that are owned by the same business client.",
      canonicalRoutes: [
        "/internal/treasury/payment-instructions",
        "/internal/treasury/payment-instructions/{id}/route",
        "/internal/treasury/payment-instructions/{id}/execute",
        "/internal/treasury/payment-instructions/{id}/retry",
        "/internal/treasury/payment-instructions/{id}/cancel"
      ],
      ownershipBoundary: "same_business_client"
    },
    payment_instruction: {
      canonicalLabel: "Inter-Client Payment Instruction",
      primaryIntent: "Process payments between ADAs that are owned by different business clients.",
      canonicalRoutes: [
        "/internal/treasury/payment-instructions",
        "/internal/treasury/payment-instructions/{id}/route",
        "/internal/treasury/payment-instructions/{id}/execute",
        "/internal/treasury/payment-instructions/{id}/retry",
        "/internal/treasury/payment-instructions/{id}/cancel"
      ],
      paymentScopeVariants: [
        {
          scopeId: "same_client_same_tenancy",
          label: "ADA transfer within same business client",
          supportStatus: "supported",
          description: "Mapped to transfer_instruction semantics in the taxonomy model."
        },
        {
          scopeId: "interclient_same_tenancy",
          label: "ADA transfer between different business clients in same tenancy",
          supportStatus: "supported",
          description: "Source ADA and destination ADA belong to different business clients hosted under the same platform tenancy/site."
        },
        {
          scopeId: "interclient_cross_tenancy_or_site",
          label: "ADA transfer between clients across different tenancy or GTT site",
          supportStatus: "planned",
          description: "Requires explicit cross-tenancy/site routing and settlement orchestration; treat as a separate flow until dedicated APIs are introduced."
        }
      ]
    }
  },
  requiredFieldsPerType: {
    funding_instruction: {
      route: "/business/me/funding-instructions",
      requiredBodyFields: [
        "sourceAccountOfDigitalAssetId",
        "destinationAccountOfDigitalAssetId",
        "amountMinorUnits"
      ],
      optionalBodyFields: [
        "fundingType",
        "provider",
        "assetCode",
        "currency"
      ],
      authRequirements: [
        "Supabase business user bearer token",
        "or business API key with payment-instruction.create scope"
      ]
    },
    payment_instruction: {
      route: "/internal/treasury/payment-instructions",
      requiredBodyFields: [
        "sourceAccountOfDigitalAssetId",
        "destinationAccountOfDigitalAssetId",
        "amountMinorUnits",
        "transferSubtype",
        "instructionType"
      ],
      optionalBodyFields: [
        "externalizationIntent"
      ],
      authRequirements: [
        "service API key with treasury write permissions"
      ]
    },
    transfer_instruction: {
      route: "/internal/treasury/payment-instructions",
      requiredBodyFields: [
        "sourceAccountOfDigitalAssetId",
        "destinationAccountOfDigitalAssetId",
        "amountMinorUnits",
        "transferSubtype",
        "instructionType"
      ],
      optionalBodyFields: [
        "externalizationIntent"
      ],
      authRequirements: [
        "service API key with treasury write permissions"
      ]
    }
  },
  validationRulesPerScenario: [
    {
      scenarioId: "FUNDING_FIAT_TO_ADA",
      transferType: "funding_instruction",
      scenarioLabel: "Fund ADA from fiat-linked source",
      rules: [
        "Source and destination account IDs must be UUID.",
        "amountMinorUnits must parse to a positive integer string.",
        "Both source and destination ADAs must be active and owned by authenticated business client.",
        "Source must have verified fiat capability route.",
        "Destination must have verified USDC-capable route.",
        "Auth must include business user token or business API key with payment-instruction.create for create and payment-instruction.read for list/detail."
      ],
      commonErrors: [
        "source_destination_and_amount_required",
        "source_and_destination_must_be_uuid",
        "amount_must_be_positive",
        "account_not_authorized_for_business_client",
        "active_source_and_destination_required",
        "verified_source_fiat_route_required",
        "verified_destination_usdc_route_required",
        "business_user_auth_required"
      ]
    },
    {
      scenarioId: "TRANSFER_ADA_TO_ADA_SAME_CLIENT",
      transferType: "transfer_instruction",
      transferSubtype: "transfer_instruction",
      scenarioLabel: "Move funds ADA-to-ADA within same business client",
      scopeVariant: "same_client_same_tenancy",
      rules: [
        "transferSubtype is required and must equal transfer_instruction for same-client ADA-to-ADA transfers.",
        "instructionType must map to a deterministic policy class.",
        "Unknown instructionType must be rejected before persistence.",
        "Ambiguous externalizationIntent combinations must be rejected.",
        "When externalizationIntent=wallet, destination must have verified wallet route.",
        "When externalizationIntent=fiat, source and destination fiat route requirements must be satisfied."
      ],
      commonErrors: [
        "instruction_type_policy_unmapped",
        "instruction_policy_ambiguous",
        "verified_destination_wallet_route_required",
        "verified_destination_fiat_route_required",
        "verified_source_fiat_route_required"
      ]
    },
    {
      scenarioId: "PAYMENT_INTERCLIENT_ADA_TRANSFER",
      transferType: "payment_instruction",
      transferSubtype: "payment_instruction",
      scenarioLabel: "Transfer between ADAs owned by different business clients in same tenancy/site",
      scopeVariant: "interclient_same_tenancy",
      rules: [
        "transferSubtype is required and must equal payment_instruction for inter-client ADA-to-ADA transfers.",
        "Both ADAs must exist and be policy-eligible for selected instructionType.",
        "Routing selection must produce deterministic route evidence before execution.",
        "Execution should emit settlement/audit events linked to instruction ID."
      ]
    },
    {
      scenarioId: "PAYMENT_INTERCLIENT_CROSS_TENANCY_OR_SITE",
      transferType: "payment_instruction",
      transferSubtype: "payment_instruction",
      scenarioLabel: "Transfer between ADAs across different tenancy or GTT site",
      scopeVariant: "interclient_cross_tenancy_or_site",
      supportStatus: "planned",
      rules: [
        "transferSubtype is required and must equal payment_instruction.",
        "Do not treat as a normal same-tenancy payment instruction.",
        "Require explicit source tenancy/site and destination tenancy/site identity.",
        "Require inter-site routing policy, reconciliation boundary, and settlement evidence per site.",
        "Recommended implementation is a bridge-style orchestrated workflow until dedicated cross-tenancy payment APIs are available."
      ]
    }
  ],
  consumerCasesBusinessClientSprint73: [
    {
      caseId: "BC_CASE_1",
      caseLabel: "Same business client ADA-to-ADA",
      transferSubtype: "transfer_instruction",
      implementationTrack: "improvement",
      scopeVariant: "same_client_same_tenancy",
      status: "implementation_ready"
    },
    {
      caseId: "BC_CASE_2",
      caseLabel: "Different business clients, same tenancy/site",
      transferSubtype: "payment_instruction",
      implementationTrack: "improvement",
      scopeVariant: "interclient_same_tenancy",
      status: "implementation_ready"
    },
    {
      caseId: "BC_CASE_3",
      caseLabel: "Different business clients across tenancy/site",
      transferSubtype: "payment_instruction",
      implementationTrack: "new_construction",
      scopeVariant: "interclient_cross_tenancy_or_site",
      status: "planned"
    }
  ],
  exampleRequestResponsePerScenario: [
    {
      scenarioId: "FUNDING_FIAT_TO_ADA",
      transferType: "funding_instruction",
      request: {
        method: "POST",
        path: "/business/me/funding-instructions",
        headers: {
          Authorization: "Bearer gtt_live_example.readwrite",
          "Idempotency-Key": "idem-funding-001"
        },
        body: {
          sourceAccountOfDigitalAssetId: "00000000-0000-4000-8000-000000000301",
          destinationAccountOfDigitalAssetId: "00000000-0000-4000-8000-000000000302",
          amountMinorUnits: "2500000"
        }
      },
      response: {
        status: 201,
        bodyShape: {
          fundingInstruction: {
            id: "uuid",
            sourceAccountOfDigitalAssetId: "uuid",
            destinationAccountOfDigitalAssetId: "uuid",
            amountMinorUnits: "2500000",
            status: "pending_usdc_reserved"
          },
          orders: [
            { orderKind: "ada_wire_transfer", stage: "fiat_received", status: "created" },
            { orderKind: "ada_usdc_transfer", stage: "usdc_delivered", status: "blocked_dependency" }
          ]
        }
      }
    },
    {
      scenarioId: "TRANSFER_ADA_TO_ADA_SAME_CLIENT",
      transferType: "transfer_instruction",
      transferSubtype: "transfer_instruction",
      request: {
        method: "POST",
        path: "/internal/treasury/payment-instructions",
        body: {
          sourceAccountOfDigitalAssetId: "00000000-0000-4000-8000-000000000111",
          destinationAccountOfDigitalAssetId: "00000000-0000-4000-8000-000000000222",
          amountMinorUnits: "2500000",
          transferSubtype: "transfer_instruction",
          instructionType: "internal_ada_settlement"
        }
      },
      response: {
        status: 201,
        bodyShape: {
          instruction: {
            id: "uuid",
            instructionType: "internal_ada_settlement",
            routeType: "unrouted",
            status: "draft"
          }
        }
      }
    },
    {
      scenarioId: "PAYMENT_INTERCLIENT_SAME_TENANCY",
      transferType: "payment_instruction",
      transferSubtype: "payment_instruction",
      request: {
        method: "POST",
        path: "/internal/treasury/payment-instructions",
        body: {
          sourceAccountOfDigitalAssetId: "00000000-0000-4000-8000-000000000333",
          destinationAccountOfDigitalAssetId: "00000000-0000-4000-8000-000000000444",
          amountMinorUnits: "500000",
          transferSubtype: "payment_instruction",
          instructionType: "internal_ada_settlement"
        }
      },
      response: {
        status: 201,
        bodyShape: {
          instruction: {
            id: "uuid",
            instructionType: "internal_ada_settlement",
            routeType: "unrouted",
            status: "draft"
          }
        }
      }
    },
    {
      scenarioId: "PAYMENT_INTERCLIENT_CROSS_TENANCY_OR_SITE",
      transferType: "payment_instruction",
      transferSubtype: "payment_instruction",
      supportStatus: "planned",
      request: {
        method: "POST",
        path: "/internal/treasury/payment-instructions",
        body: {
          sourceAccountOfDigitalAssetId: "source-ada-in-site-a",
          destinationAccountOfDigitalAssetId: "destination-ada-in-site-b",
          amountMinorUnits: "500000",
          transferSubtype: "payment_instruction",
          instructionType: "internal_ada_settlement"
        }
      },
      response: {
        status: "planned",
        bodyShape: {
          note: "Cross-tenancy/cross-site payment requires dedicated orchestration contract."
        }
      }
    },
    {
      scenarioId: "PAYMENT_EXTERNALIZATION_WALLET_ROUTE_REQUIRED",
      transferType: "payment_instruction",
      transferSubtype: "payment_instruction",
      request: {
        method: "POST",
        path: "/internal/treasury/payment-instructions",
        body: {
          sourceAccountOfDigitalAssetId: "00000000-0000-4000-8000-000000000111",
          destinationAccountOfDigitalAssetId: "00000000-0000-4000-8000-000000000222",
          amountMinorUnits: "2500000",
          transferSubtype: "payment_instruction",
          instructionType: "internal_ada_settlement",
          externalizationIntent: "wallet"
        }
      },
      response: {
        status: 409,
        bodyShape: {
          error: "verified_destination_wallet_route_required"
        }
      }
    }
  ]
};

export const businessClientOpenApiSpec: OpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Global Trade Treasury Business Client API",
    version: "0.1.0-alpha",
    description: "Business-client-oriented API contract for onboarding, ADA self-service, API keys, and funding instructions."
  },
  servers: localServer,
  tags: [
    { name: "Business Auth", description: "API-first business-user authentication endpoints." },
    { name: "Onboarding", description: "Business user onboarding profile and workflow." },
    { name: "Business ADA Accounts", description: "Business user self-service ADA account operations." },
    { name: "Business API Keys", description: "Scoped business API key lifecycle operations." },
    { name: "Business Funding Instructions", description: "Business funding instruction list/create/detail operations." }
  ],
  security: [
    { BusinessUserBearer: [] },
    { BusinessApiKeyBearer: [] },
    { BusinessApiKeyHeader: [] }
  ],
  components: {
    securitySchemes: {
      BusinessUserBearer: {
        type: "http",
        scheme: "bearer",
        description: "First-party business-user JWT bearer token issued by /business/auth/sign-in."
      },
      BusinessApiKeyBearer: {
        type: "http",
        scheme: "bearer",
        description: "Authorization: Bearer gtt_live_<key_id>.<secret>."
      },
      BusinessApiKeyHeader: {
        type: "apiKey",
        in: "header",
        name: "X-GTT-API-Key",
        description: "X-GTT-API-Key: gtt_live_<key_id>.<secret>."
      }
    },
    schemas: {
      BusinessAuthSignInRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" }
        },
        example: {
          email: "ops@acme-trading.com",
          password: "S3curePass!2026"
        }
      },
      BusinessInvitationRequest: {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string", format: "email" }
        },
        example: {
          email: "ops@acme-trading.com"
        }
      },
      BusinessInvitationResponse: {
        type: "object",
        required: ["ok", "status", "message"],
        properties: {
          ok: { type: "boolean" },
          status: { type: "string", enum: ["check_email", "existing_account"] },
          message: { type: "string" },
          devInviteLink: { type: "string" }
        },
        example: {
          ok: true,
          status: "check_email",
          message: "Invitation accepted for delivery."
        }
      },
      BusinessAuthSetPasswordRequest: {
        type: "object",
        required: ["password"],
        properties: {
          token: {
            type: "string",
            description: "Optional invitation access token. If omitted, token may be supplied in Authorization header."
          },
          password: { type: "string" }
        },
        example: {
          token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invitation.sample",
          password: "N3wStrongerPass!2026"
        }
      },
      BusinessAuthResetPasswordRequest: {
        type: "object",
        required: ["email"],
        properties: {
          email: { type: "string", format: "email" }
        },
        example: {
          email: "ops@acme-trading.com"
        }
      },
      BusinessAuthRefreshRequest: {
        type: "object",
        required: ["refreshToken"],
        properties: {
          refreshToken: { type: "string" }
        },
        example: {
          refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.refresh.sample"
        }
      },
      BusinessOnboardingStepSaveRequest: {
        type: "object",
        required: ["payload"],
        properties: {
          payload: {
            type: "object",
            additionalProperties: true
          }
        },
        example: {
          payload: {
            completedStepKey: "business_profile",
            legalName: "Acme Trading LLC",
            country: "US",
            registrationNumber: "US-REG-123456"
          }
        }
      },
      BusinessJwtUser: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" }
        },
        example: {
          id: "9f7b9f57-0af0-4f1a-b1eb-31c7ec9f2c83",
          email: "ops@acme-trading.com"
        }
      },
      BusinessJwtSession: {
        type: "object",
        required: ["access_token", "token_type", "user"],
        properties: {
          access_token: { type: "string" },
          token_type: { type: "string", example: "bearer" },
          expires_in: { type: "integer" },
          expires_at: { type: "integer" },
          refresh_token: { type: "string" },
          user: { $ref: "#/components/schemas/BusinessJwtUser" }
        },
        example: {
          access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.access.sample",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: 1788868800,
          refresh_token: "refresh_token_sample",
          user: {
            id: "9f7b9f57-0af0-4f1a-b1eb-31c7ec9f2c83",
            email: "ops@acme-trading.com"
          }
        }
      },
      BusinessAuthSessionResponse: {
        type: "object",
        required: ["session"],
        properties: {
          session: { $ref: "#/components/schemas/BusinessJwtSession" }
        },
        example: {
          session: {
            access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.access.sample",
            token_type: "bearer",
            expires_in: 3600,
            refresh_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.refresh.sample",
            user: {
              id: "9f7b9f57-0af0-4f1a-b1eb-31c7ec9f2c83",
              email: "ops@acme-trading.com"
            }
          }
        }
      },
      BusinessAuthMeResponse: {
        type: "object",
        required: ["user"],
        properties: {
          user: {
            type: "object",
            required: ["authUserId", "email"],
            properties: {
              authUserId: { type: "string" },
              email: { type: "string", format: "email" }
            }
          }
        },
        example: {
          user: {
            authUserId: "9f7b9f57-0af0-4f1a-b1eb-31c7ec9f2c83",
            email: "ops@acme-trading.com"
          }
        }
      },
      BusinessAuthResetPasswordResponse: {
        type: "object",
        required: ["ok", "status", "message"],
        properties: {
          ok: { type: "boolean" },
          status: { type: "string", enum: ["password_reset_sent"] },
          message: { type: "string" }
        },
        example: {
          ok: true,
          status: "password_reset_sent",
          message: "Password reset email sent."
        }
      },
      BusinessAdaBalances: {
        type: "object",
        required: ["availableMinorUnits", "pendingMinorUnits", "reservedMinorUnits", "lockedMinorUnits", "suspenseMinorUnits"],
        properties: {
          availableMinorUnits: { type: "string", pattern: "^[0-9]+$" },
          pendingMinorUnits: { type: "string", pattern: "^[0-9]+$" },
          reservedMinorUnits: { type: "string", pattern: "^[0-9]+$" },
          lockedMinorUnits: { type: "string", pattern: "^[0-9]+$" },
          suspenseMinorUnits: { type: "string", pattern: "^[0-9]+$" },
          updatedAt: { type: "string", format: "date-time" }
        },
        example: {
          availableMinorUnits: "2500000",
          pendingMinorUnits: "0",
          reservedMinorUnits: "0",
          lockedMinorUnits: "0",
          suspenseMinorUnits: "0",
          updatedAt: "2026-09-08T12:00:00.000Z"
        }
      },
      BusinessAdaAccount: {
        type: "object",
        required: ["id", "accountName", "businessClientId", "status", "usePurpose"],
        properties: {
          id: { type: "string" },
          accountCode: { type: "string" },
          accountName: { type: "string" },
          businessClientId: { type: "string" },
          businessClientName: { type: "string" },
          status: { type: "string" },
          usePurpose: { type: "string" },
          assetCode: { type: "string" },
          assetRail: { type: "string" },
          activationDecision: { type: "string", enum: ["auto", "approval_required"] },
          activationReasonCode: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          balances: { $ref: "#/components/schemas/BusinessAdaBalances" }
        },
        example: {
          id: "ada_01J6T8H1MZ4JQ9A5QYDR2E7T60",
          accountCode: "DAA-USDC-GEN-TRES",
          accountName: "Treasury Ops",
          businessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ",
          businessClientName: "Acme Trading LLC",
          status: "active",
          usePurpose: "general",
          assetCode: "USDC",
          assetRail: "circle_wallet",
          activationDecision: "auto",
          activationReasonCode: "virtual_no_linked_instrument_auto_activation",
          createdAt: "2026-09-08T11:42:12.000Z",
          balances: {
            availableMinorUnits: "2500000",
            pendingMinorUnits: "0",
            reservedMinorUnits: "0",
            lockedMinorUnits: "0",
            suspenseMinorUnits: "0"
          }
        }
      },
      BusinessAdaAccountListResponse: {
        type: "object",
        required: ["accounts"],
        properties: {
          accounts: {
            type: "array",
            items: { $ref: "#/components/schemas/BusinessAdaAccount" }
          }
        },
        example: {
          accounts: [
            {
              id: "ada_01J6T8H1MZ4JQ9A5QYDR2E7T60",
              accountCode: "DAA-USDC-GEN-TRES",
              accountName: "Treasury Ops",
              businessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ",
              status: "active",
              usePurpose: "general",
              assetCode: "USDC",
              activationDecision: "auto",
              activationReasonCode: "virtual_no_linked_instrument_auto_activation"
            }
          ]
        }
      },
      BusinessAdaAccountResponse: {
        type: "object",
        required: ["account"],
        properties: {
          account: { $ref: "#/components/schemas/BusinessAdaAccount" }
        },
        example: {
          account: {
            id: "ada_01J6T8H1MZ4JQ9A5QYDR2E7T60",
            accountCode: "DAA-USDC-GEN-TRES",
            accountName: "Treasury Ops",
            businessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ",
            status: "active",
            usePurpose: "general",
            assetCode: "USDC"
          }
        }
      },
      BusinessApiKey: {
        type: "object",
        required: ["id", "keyPrefix", "ownerBusinessClientId", "ownerBusinessClientName", "scopes", "status", "createdAt"],
        properties: {
          id: { type: "string" },
          keyPrefix: { type: "string" },
          ownerAuthUserId: { type: "string" },
          ownerTenantId: { type: "string" },
          ownerBusinessClientId: { type: "string" },
          ownerBusinessClientName: { type: "string" },
          scopes: { type: "array", items: { type: "string" } },
          status: { type: "string", enum: ["active", "revoked"] },
          createdAt: { type: "string", format: "date-time" },
          revokedAt: { type: "string", format: "date-time" }
        },
        example: {
          id: "2f3c17d4-2b41-4cf1-aab4-d68263cc8ccd",
          keyPrefix: "gtt_live_8a1df4e0",
          ownerBusinessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ",
          ownerBusinessClientName: "Acme Trading LLC",
          scopes: ["ada.read", "payment-instruction.create"],
          status: "active",
          createdAt: "2026-09-08T11:52:05.000Z"
        }
      },
      BusinessApiKeyListResponse: {
        type: "object",
        required: ["keys"],
        properties: {
          keys: {
            type: "array",
            items: { $ref: "#/components/schemas/BusinessApiKey" }
          }
        },
        example: {
          keys: [
            {
              id: "2f3c17d4-2b41-4cf1-aab4-d68263cc8ccd",
              keyPrefix: "gtt_live_8a1df4e0",
              ownerBusinessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ",
              ownerBusinessClientName: "Acme Trading LLC",
              scopes: ["ada.read"],
              status: "active",
              createdAt: "2026-09-08T11:52:05.000Z"
            }
          ]
        }
      },
      BusinessApiKeyResponse: {
        type: "object",
        required: ["key"],
        properties: {
          key: { $ref: "#/components/schemas/BusinessApiKey" }
        },
        example: {
          key: {
            id: "2f3c17d4-2b41-4cf1-aab4-d68263cc8ccd",
            keyPrefix: "gtt_live_8a1df4e0",
            ownerBusinessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ",
            ownerBusinessClientName: "Acme Trading LLC",
            scopes: ["ada.read"],
            status: "revoked",
            createdAt: "2026-09-08T11:52:05.000Z",
            revokedAt: "2026-09-08T12:15:00.000Z"
          }
        }
      },
      BusinessApiKeyWithPlaintextResponse: {
        type: "object",
        required: ["key", "plaintextKey"],
        properties: {
          key: { $ref: "#/components/schemas/BusinessApiKey" },
          plaintextKey: { type: "string" }
        },
        example: {
          key: {
            id: "2f3c17d4-2b41-4cf1-aab4-d68263cc8ccd",
            keyPrefix: "gtt_live_8a1df4e0",
            ownerBusinessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ",
            ownerBusinessClientName: "Acme Trading LLC",
            scopes: ["ada.read", "payment-instruction.create"],
            status: "active",
            createdAt: "2026-09-08T11:52:05.000Z"
          },
          plaintextKey: "gtt_live_8a1df4e0.7c6f0b3f0f524d3ab8b7f0f4a2ce0921"
        }
      },
      BusinessApiKeyRotateResponse: {
        type: "object",
        required: ["key", "plaintextKey", "rotatedFromApiKeyId"],
        properties: {
          key: { $ref: "#/components/schemas/BusinessApiKey" },
          plaintextKey: { type: "string" },
          rotatedFromApiKeyId: { type: "string" }
        },
        example: {
          key: {
            id: "5e5296d8-55e6-4f5a-bb02-f1f1c7e508a1",
            keyPrefix: "gtt_live_1726fd3b",
            ownerBusinessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ",
            ownerBusinessClientName: "Acme Trading LLC",
            scopes: ["ada.read", "payment-instruction.create"],
            status: "active",
            createdAt: "2026-09-08T12:20:12.000Z"
          },
          plaintextKey: "gtt_live_1726fd3b.b72a9e68de4f4e77b8ecb1af53dc8af2",
          rotatedFromApiKeyId: "2f3c17d4-2b41-4cf1-aab4-d68263cc8ccd"
        }
      },
      BusinessAdaAccountCreateRequest: {
        type: "object",
        properties: {
          accountName: { type: "string" },
          usePurpose: { type: "string", enum: ["general", "settlement", "collection"] },
          topology: { type: "string", enum: ["unlinked", "wallet-linked", "fiat-linked"] },
          assetCode: { type: "string" },
          assetRail: { type: "string" }
        },
        example: {
          accountName: "Treasury Ops",
          usePurpose: "general",
          topology: "unlinked",
          assetCode: "USDC",
          assetRail: "circle_internal"
        }
      },
      BusinessApiKeyCreateRequest: {
        type: "object",
        properties: {
          scopes: {
            type: "array",
            items: { type: "string" }
          }
        },
        example: {
          scopes: ["ada.read", "payment-instruction.create"]
        }
      },
      BusinessApiKeyRotateRequest: {
        type: "object",
        properties: {
          scopes: {
            type: "array",
            items: { type: "string" }
          }
        },
        example: {
          scopes: ["ada.read", "payment-instruction.create"]
        }
      },
      BusinessApiKeyRevokeRequest: {
        type: "object",
        properties: {
          reason: { type: "string" }
        },
        example: {
          reason: "rotation_succeeded"
        }
      },
      BusinessFundingInstructionCreateRequest: {
        type: "object",
        required: ["sourceAccountOfDigitalAssetId", "destinationAccountOfDigitalAssetId", "amountMinorUnits"],
        properties: {
          sourceAccountOfDigitalAssetId: { type: "string", format: "uuid" },
          destinationAccountOfDigitalAssetId: { type: "string", format: "uuid" },
          fundingType: { type: "string" },
          provider: { type: "string" },
          assetCode: { type: "string" },
          currency: { type: "string" },
          amountMinorUnits: { type: "string", pattern: "^[0-9]+$" }
        },
        example: {
          sourceAccountOfDigitalAssetId: "66c3df29-a9ed-45aa-b9af-cd9940f6f314",
          destinationAccountOfDigitalAssetId: "2f64d70f-fcbd-4ec6-8eb5-06fae53cb5ef",
          fundingType: "usdc_payin",
          provider: "circle",
          assetCode: "USDC",
          currency: "USD",
          amountMinorUnits: "1250000"
        }
      },
      BusinessFundingInstruction: {
        type: "object",
        required: [
          "id",
          "sourceAccountOfDigitalAssetId",
          "sourceAdaCode",
          "sourceAccountCode",
          "destinationAccountOfDigitalAssetId",
          "destinationAdaCode",
          "destinationAccountCode",
          "fundingType",
          "instructionRole",
          "transferKind",
          "assetCode",
          "currency",
          "amountMinorUnits",
          "pendingUsdcMinorUnits",
          "availableUsdcMinorUnits",
          "status"
        ],
        properties: {
          id: { type: "string" },
          sourceAccountOfDigitalAssetId: { type: "string" },
          sourceAdaCode: { type: "string" },
          sourceAccountCode: { type: "string" },
          destinationAccountOfDigitalAssetId: { type: "string" },
          destinationAdaCode: { type: "string" },
          destinationAccountCode: { type: "string" },
          fundingType: { type: "string" },
          instructionRole: { type: "string" },
          transferKind: { type: "string" },
          assetCode: { type: "string" },
          currency: { type: "string" },
          amountMinorUnits: { type: "string", pattern: "^[0-9]+$" },
          pendingUsdcMinorUnits: { type: "string", pattern: "^[0-9]+$" },
          availableUsdcMinorUnits: { type: "string", pattern: "^[0-9]+$" },
          status: { type: "string" },
          supportReference: { type: "string" },
          postingJournalEntryId: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        },
        example: {
          id: "fe2f1f74-8de8-4f89-b094-c7ca41b22875",
          sourceAccountOfDigitalAssetId: "66c3df29-a9ed-45aa-b9af-cd9940f6f314",
          sourceAdaCode: "DAA-USDC-OPS-SOUR",
          sourceAccountCode: "DAA-USDC-OPS-SOUR",
          destinationAccountOfDigitalAssetId: "2f64d70f-fcbd-4ec6-8eb5-06fae53cb5ef",
          destinationAdaCode: "DAA-USDC-LIQ-DEST",
          destinationAccountCode: "DAA-USDC-LIQ-DEST",
          fundingType: "usdc_payin",
          instructionRole: "client_exchange",
          transferKind: "ada_to_ada_payin_underlying",
          assetCode: "USDC",
          currency: "USD",
          amountMinorUnits: "1250000",
          pendingUsdcMinorUnits: "0",
          availableUsdcMinorUnits: "1250000",
          status: "completed",
          createdAt: "2026-09-08T12:30:10.000Z",
          updatedAt: "2026-09-08T12:31:02.000Z"
        }
      },
      BusinessFundingInstructionOrder: {
        type: "object",
        required: ["id", "orderKind", "stage", "amountMinorUnits", "currency", "status"],
        properties: {
          id: { type: "string" },
          orderKind: { type: "string" },
          stage: { type: "string" },
          dependencyOrderId: { type: "string" },
          amountMinorUnits: { type: "string", pattern: "^[0-9]+$" },
          currency: { type: "string" },
          status: { type: "string" },
          completedAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" }
        },
        example: {
          id: "8c900f31-4dd8-47c7-9950-95cff5ce8194",
          orderKind: "ada_wire_transfer",
          stage: "fiat_received",
          amountMinorUnits: "1250000",
          currency: "USD",
          status: "completed",
          createdAt: "2026-09-08T12:30:10.000Z",
          updatedAt: "2026-09-08T12:31:02.000Z"
        }
      },
      BusinessFundingInstructionListResponse: {
        type: "object",
        required: ["fundingInstructions"],
        properties: {
          fundingInstructions: {
            type: "array",
            items: { $ref: "#/components/schemas/BusinessFundingInstruction" }
          }
        },
        example: {
          fundingInstructions: [
            {
              id: "fe2f1f74-8de8-4f89-b094-c7ca41b22875",
              sourceAccountOfDigitalAssetId: "66c3df29-a9ed-45aa-b9af-cd9940f6f314",
              sourceAdaCode: "DAA-USDC-OPS-SOUR",
              sourceAccountCode: "DAA-USDC-OPS-SOUR",
              destinationAccountOfDigitalAssetId: "2f64d70f-fcbd-4ec6-8eb5-06fae53cb5ef",
              destinationAdaCode: "DAA-USDC-LIQ-DEST",
              destinationAccountCode: "DAA-USDC-LIQ-DEST",
              fundingType: "usdc_payin",
              instructionRole: "client_exchange",
              transferKind: "ada_to_ada_payin_underlying",
              assetCode: "USDC",
              currency: "USD",
              amountMinorUnits: "1250000",
              pendingUsdcMinorUnits: "0",
              availableUsdcMinorUnits: "1250000",
              status: "completed"
            }
          ]
        }
      },
      BusinessFundingInstructionDetailResponse: {
        type: "object",
        required: ["fundingInstruction", "orders"],
        properties: {
          fundingInstruction: { $ref: "#/components/schemas/BusinessFundingInstruction" },
          orders: {
            type: "array",
            items: { $ref: "#/components/schemas/BusinessFundingInstructionOrder" }
          }
        },
        example: {
          fundingInstruction: {
            id: "fe2f1f74-8de8-4f89-b094-c7ca41b22875",
            sourceAccountOfDigitalAssetId: "66c3df29-a9ed-45aa-b9af-cd9940f6f314",
            sourceAdaCode: "DAA-USDC-OPS-SOUR",
            sourceAccountCode: "DAA-USDC-OPS-SOUR",
            destinationAccountOfDigitalAssetId: "2f64d70f-fcbd-4ec6-8eb5-06fae53cb5ef",
            destinationAdaCode: "DAA-USDC-LIQ-DEST",
            destinationAccountCode: "DAA-USDC-LIQ-DEST",
            fundingType: "usdc_payin",
            instructionRole: "client_exchange",
            transferKind: "ada_to_ada_payin_underlying",
            assetCode: "USDC",
            currency: "USD",
            amountMinorUnits: "1250000",
            pendingUsdcMinorUnits: "0",
            availableUsdcMinorUnits: "1250000",
            status: "completed"
          },
          orders: [
            {
              id: "8c900f31-4dd8-47c7-9950-95cff5ce8194",
              orderKind: "ada_wire_transfer",
              stage: "fiat_received",
              amountMinorUnits: "1250000",
              currency: "USD",
              status: "completed"
            }
          ]
        }
      },
      BusinessFundingInstructionOrdersResponse: {
        type: "object",
        required: ["fundingInstructionId", "orders"],
        properties: {
          fundingInstructionId: { type: "string" },
          orders: {
            type: "array",
            items: { $ref: "#/components/schemas/BusinessFundingInstructionOrder" }
          }
        },
        example: {
          fundingInstructionId: "fe2f1f74-8de8-4f89-b094-c7ca41b22875",
          orders: [
            {
              id: "8c900f31-4dd8-47c7-9950-95cff5ce8194",
              orderKind: "ada_wire_transfer",
              stage: "fiat_received",
              amountMinorUnits: "1250000",
              currency: "USD",
              status: "completed"
            }
          ]
        }
      },
      BasicOkResponse: {
        type: "object",
        required: ["ok"],
        properties: {
          ok: { type: "boolean" }
        },
        example: {
          ok: true
        }
      },
      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
          detail: { type: "string" }
        },
        example: {
          error: "business_user_auth_required",
          detail: "Missing or invalid bearer token."
        }
      }
    }
  },
  "x-gtt-transfer-taxonomy": transferTaxonomy,
  paths: {
    "/auth/invitations": {
      post: {
        tags: ["Business Auth"],
        security: [],
        summary: "Request business self-registration invitation",
        description: "Accepts only the business user email and triggers invitation delivery for onboarding access. Password is set later in invitation confirmation.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BusinessInvitationRequest" },
              examples: {
                default: {
                  value: {
                    email: "ops@acme-trading.com"
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Invitation accepted for delivery or existing account response.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessInvitationResponse" },
                examples: {
                  check_email: {
                    value: {
                      ok: true,
                      status: "check_email",
                      message: "Invitation accepted for delivery."
                    }
                  },
                  existing_account: {
                    value: {
                      ok: true,
                      status: "existing_account",
                      message: "This email is already registered. Sign in to continue your application."
                    }
                  }
                }
              }
            }
          },
          "400": {
            description: "Invalid email format.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  valid_email_required: {
                    value: {
                      error: "valid_email_required",
                      detail: "Please provide a valid email address."
                    }
                  }
                }
              }
            }
          },
          "429": {
            description: "Rate limited invitation attempts.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  too_many_invitation_requests: {
                    value: {
                      error: "too_many_invitation_requests"
                    }
                  }
                }
              }
            }
          },
          "502": {
            description: "Invitation dispatch failed at auth provider.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  supabase_invitation_failed: {
                    value: {
                      error: "supabase_invitation_failed",
                      detail: "Auth provider returned an error while creating invitation."
                    }
                  }
                }
              }
            }
          },
          "503": {
            description: "Invitation provider not configured.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  supabase_admin_not_configured: {
                    value: {
                      error: "supabase_admin_not_configured"
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/auth/invitations/confirm": {
      post: {
        tags: ["Business Auth"],
        security: [],
        summary: "Confirm invitation and set password",
        description: "Completes invitation confirmation and sets the business user password.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BusinessAuthSetPasswordRequest" },
              examples: {
                invitation_confirm: {
                  value: {
                    token: "invitation_or_session_token",
                    password: "StrongPassw0rd!"
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Invitation confirmed and authenticated session issued.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessAuthSessionResponse" },
                examples: {
                  success: {
                    value: {
                      session: {
                        access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.access.sample",
                        token_type: "bearer",
                        expires_in: 3600,
                        user: {
                          id: "9f7b9f57-0af0-4f1a-b1eb-31c7ec9f2c83",
                          email: "ops@acme-trading.com"
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            description: "Missing or invalid invitation/session token.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  business_user_auth_required: {
                    value: {
                      error: "business_user_auth_required",
                      detail: "Missing or invalid bearer token."
                    }
                  }
                }
              }
            }
          },
          "503": {
            description: "Business auth is not fully configured.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  supabase_admin_not_configured: {
                    value: {
                      error: "supabase_admin_not_configured",
                      detail: "SUPABASE_SERVICE_ROLE_KEY is not configured."
                    }
                  },
                  business_auth_not_configured: {
                    value: {
                      error: "business_auth_not_configured",
                      detail: "BUSINESS_AUTH_JWT_SECRET is not configured."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/business/auth/sign-in": {
      post: {
        tags: ["Business Auth"],
        security: [],
        summary: "Sign in business user",
        description: "Authenticates business user credentials via Supabase and returns a first-party JWT bearer session for onboarding and business self-service APIs.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BusinessAuthSignInRequest" },
              examples: {
                default: {
                  value: {
                    email: "ops@acme-trading.com",
                    password: "StrongPassw0rd!"
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Authenticated session.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessAuthSessionResponse" },
                examples: {
                  success: {
                    value: {
                      session: {
                        access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.access.sample",
                        token_type: "bearer",
                        expires_in: 3600,
                        user: {
                          id: "9f7b9f57-0af0-4f1a-b1eb-31c7ec9f2c83",
                          email: "ops@acme-trading.com"
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            description: "Invalid credentials.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  invalid_credentials: {
                    value: {
                      error: "invalid_credentials",
                      detail: "Email or password is incorrect."
                    }
                  }
                }
              }
            }
          },
          "503": {
            description: "Business auth is not fully configured.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  supabase_admin_not_configured: {
                    value: {
                      error: "supabase_admin_not_configured",
                      detail: "SUPABASE_SERVICE_ROLE_KEY is not configured."
                    }
                  },
                  business_auth_not_configured: {
                    value: {
                      error: "business_auth_not_configured",
                      detail: "BUSINESS_AUTH_JWT_SECRET is not configured."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/business/auth/set-password": {
      post: {
        tags: ["Business Auth"],
        security: [],
        summary: "Set password from invitation flow",
        description: "Sets user password using invitation token and returns an authenticated first-party bearer session.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BusinessAuthSetPasswordRequest" },
              examples: {
                invitation_set_password: {
                  value: {
                    token: "invitation_or_session_token",
                    password: "StrongPassw0rd!"
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Password set and authenticated session issued.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessAuthSessionResponse" },
                examples: {
                  success: {
                    value: {
                      session: {
                        access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.access.sample",
                        token_type: "bearer",
                        expires_in: 3600,
                        user: {
                          id: "9f7b9f57-0af0-4f1a-b1eb-31c7ec9f2c83",
                          email: "ops@acme-trading.com"
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            description: "Missing or invalid invitation/session token.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  business_user_auth_required: {
                    value: {
                      error: "business_user_auth_required",
                      detail: "Missing or invalid bearer token."
                    }
                  }
                }
              }
            }
          },
          "503": {
            description: "Business auth is not fully configured.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  supabase_admin_not_configured: {
                    value: {
                      error: "supabase_admin_not_configured",
                      detail: "SUPABASE_SERVICE_ROLE_KEY is not configured."
                    }
                  },
                  business_auth_not_configured: {
                    value: {
                      error: "business_auth_not_configured",
                      detail: "BUSINESS_AUTH_JWT_SECRET is not configured."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/business/auth/reset-password": {
      post: {
        tags: ["Business Auth"],
        security: [],
        summary: "Request password reset email",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BusinessAuthResetPasswordRequest" },
              examples: {
                default: {
                  value: {
                    email: "ops@acme-trading.com"
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Password reset email sent.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessAuthResetPasswordResponse" },
                examples: {
                  success: {
                    value: {
                      ok: true,
                      status: "password_reset_sent",
                      message: "Password reset email sent."
                    }
                  }
                }
              }
            }
          },
          "400": {
            description: "Invalid email.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  invalid_email: {
                    value: {
                      error: "invalid_email",
                      detail: "Email format is invalid."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/business/auth/refresh": {
      post: {
        tags: ["Business Auth"],
        security: [],
        summary: "Refresh first-party business session",
        description: "Exchanges a valid first-party refresh token for a rotated access token and refresh token.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BusinessAuthRefreshRequest" },
              examples: {
                default: {
                  value: {
                    refreshToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.refresh.sample"
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Session refreshed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessAuthSessionResponse" },
                examples: {
                  success: {
                    value: {
                      session: {
                        access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.access.next.sample",
                        token_type: "bearer",
                        expires_in: 3600,
                        refresh_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.refresh.next.sample",
                        user: {
                          id: "9f7b9f57-0af0-4f1a-b1eb-31c7ec9f2c83",
                          email: "ops@acme-trading.com"
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            description: "Missing or invalid refresh token.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  business_user_auth_required: {
                    value: {
                      error: "business_user_auth_required",
                      detail: "Missing or invalid bearer token."
                    }
                  }
                }
              }
            }
          },
          "503": {
            description: "Auth provider admin client is not configured.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  supabase_admin_not_configured: {
                    value: {
                      error: "supabase_admin_not_configured",
                      detail: "SUPABASE_SERVICE_ROLE_KEY is not configured."
                    }
                  },
                  business_auth_not_configured: {
                    value: {
                      error: "business_auth_not_configured",
                      detail: "BUSINESS_AUTH_JWT_SECRET is not configured."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/business/auth/me": {
      get: {
        tags: ["Business Auth"],
        summary: "Resolve authenticated business user",
        description: "Validates bearer JWT and returns business user identity.",
        responses: {
          "200": {
            description: "Authenticated user profile.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessAuthMeResponse" },
                examples: {
                  success: {
                    value: {
                      user: {
                        authUserId: "9f7b9f57-0af0-4f1a-b1eb-31c7ec9f2c83",
                        email: "ops@acme-trading.com"
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            description: "Missing or invalid bearer token.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  business_user_auth_required: {
                    value: {
                      error: "business_user_auth_required",
                      detail: "Missing or invalid bearer token."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/business/auth/sign-out": {
      post: {
        tags: ["Business Auth"],
        security: [{ BusinessUserBearer: [] }],
        summary: "Sign out business session",
        description: "Revokes the currently authenticated bearer-token session at the auth provider.",
        responses: {
          "200": {
            description: "Session revoked.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BasicOkResponse" },
                examples: {
                  success: {
                    value: {
                      ok: true
                    }
                  }
                }
              }
            }
          },
          "401": {
            description: "Missing or invalid bearer token.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  business_user_auth_required: {
                    value: {
                      error: "business_user_auth_required",
                      detail: "Missing or invalid bearer token."
                    }
                  }
                }
              }
            }
          },
          "502": {
            description: "Auth-provider session revocation failed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  sign_out_failed: {
                    value: {
                      error: "sign_out_failed",
                      detail: "Auth provider rejected session revocation request."
                    }
                  }
                }
              }
            }
          },
          "503": {
            description: "Auth provider admin client is not configured.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  supabase_admin_not_configured: {
                    value: {
                      error: "supabase_admin_not_configured",
                      detail: "SUPABASE_SERVICE_ROLE_KEY is not configured."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/onboarding/me": {
      get: {
        tags: ["Onboarding"],
        summary: "Get business onboarding snapshot",
        responses: {
          "200": {
            description: "Onboarding snapshot.",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
                examples: {
                  success: {
                    value: {
                      profile: {
                        onboardingProfileId: "onb_01J6TWVY5N0E8J9Y3V0WRPZ0BQ",
                        status: "draft",
                        businessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ"
                      },
                      application: {
                        applicationStatus: "draft",
                        currentStep: "business_profile"
                      }
                    }
                  }
                }
              }
            }
          },
          "401": {
            description: "Missing or invalid business auth.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  business_user_auth_required: {
                    value: {
                      error: "business_user_auth_required",
                      detail: "Missing or invalid bearer token."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/onboarding/me/steps/{stepKey}": {
      patch: {
        tags: ["Onboarding"],
        summary: "Save onboarding step payload",
        parameters: [{ name: "stepKey", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BusinessOnboardingStepSaveRequest" },
              examples: {
                business_profile: {
                  value: {
                    payload: {
                      completedStepKey: "business_profile",
                      legalName: "Acme Trading LLC",
                      country: "US",
                      registrationNumber: "US-REG-123456"
                    }
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Step saved.",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
                examples: {
                  success: {
                    value: {
                      ok: true,
                      stepKey: "business_profile",
                      savedAt: "2026-09-08T12:45:00.000Z"
                    }
                  }
                }
              }
            }
          },
          "401": {
            description: "Missing or invalid business auth.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  business_user_auth_required: {
                    value: {
                      error: "business_user_auth_required",
                      detail: "Missing or invalid bearer token."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/onboarding/me/submit": {
      post: {
        tags: ["Onboarding"],
        summary: "Submit onboarding application",
        responses: {
          "200": {
            description: "Onboarding submitted.",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
                examples: {
                  success: {
                    value: {
                      ok: true,
                      status: "submitted",
                      submittedAt: "2026-09-08T12:50:00.000Z"
                    }
                  }
                }
              }
            }
          },
          "401": {
            description: "Missing or invalid business auth.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  business_user_auth_required: {
                    value: {
                      error: "business_user_auth_required",
                      detail: "Missing or invalid bearer token."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/business/accounts-of-digital-asset": {
      get: {
        tags: ["Business ADA Accounts"],
        summary: "List my ADA accounts",
        responses: {
          "200": {
            description: "Owned ADA accounts.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessAdaAccountListResponse" },
                examples: {
                  success: {
                    value: {
                      accounts: [
                        {
                          id: "ada_01J6T8H1MZ4JQ9A5QYDR2E7T60",
                          accountCode: "DAA-USDC-GEN-TRES",
                          accountName: "Treasury Ops",
                          businessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ",
                          status: "active",
                          usePurpose: "general",
                          assetCode: "USDC"
                        }
                      ]
                    }
                  }
                }
              }
            }
          },
          "400": {
            description: "Business not approved.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  business_client_not_approved: {
                    value: {
                      error: "business_client_not_approved",
                      detail: "Business client status must be approved before this operation."
                    }
                  }
                }
              }
            }
          }
        }
      },
      post: {
        tags: ["Business ADA Accounts"],
        summary: "Create my ADA account",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BusinessAdaAccountCreateRequest" },
              examples: {
                unlinked_usdc_account: {
                  value: {
                    accountName: "Treasury Ops",
                    usePurpose: "general",
                    topology: "unlinked",
                    assetCode: "USDC",
                    assetRail: "circle_internal"
                  }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "ADA account created.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessAdaAccountResponse" },
                examples: {
                  success: {
                    value: {
                      account: {
                        id: "ada_01J6T8H1MZ4JQ9A5QYDR2E7T60",
                        accountCode: "DAA-USDC-GEN-TRES",
                        accountName: "Treasury Ops",
                        businessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ",
                        status: "active",
                        usePurpose: "general",
                        assetCode: "USDC"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/business/accounts-of-digital-asset/{id}": {
      get: {
        tags: ["Business ADA Accounts"],
        summary: "Get my ADA account",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "ADA account detail.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessAdaAccountResponse" },
                examples: {
                  success: {
                    value: {
                      account: {
                        id: "ada_01J6T8H1MZ4JQ9A5QYDR2E7T60",
                        accountCode: "DAA-USDC-GEN-TRES",
                        accountName: "Treasury Ops",
                        businessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ",
                        status: "active",
                        usePurpose: "general",
                        assetCode: "USDC"
                      }
                    }
                  }
                }
              }
            }
          },
          "404": {
            description: "Not found.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  account_not_found: {
                    value: {
                      error: "account_not_found",
                      detail: "Requested account does not exist for this business client."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/business/api-keys": {
      get: {
        tags: ["Business API Keys"],
        summary: "List my business API keys",
        responses: {
          "200": {
            description: "List of key metadata.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessApiKeyListResponse" },
                examples: {
                  success: {
                    value: {
                      keys: [
                        {
                          id: "2f3c17d4-2b41-4cf1-aab4-d68263cc8ccd",
                          keyPrefix: "gtt_live_8a1df4e0",
                          ownerBusinessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ",
                          ownerBusinessClientName: "Acme Trading LLC",
                          scopes: ["ada.read"],
                          status: "active",
                          createdAt: "2026-09-08T11:52:05.000Z"
                        }
                      ]
                    }
                  }
                }
              }
            }
          }
        }
      },
      post: {
        tags: ["Business API Keys"],
        summary: "Create business API key",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BusinessApiKeyCreateRequest" },
              examples: {
                default: {
                  value: {
                    scopes: ["ada.read", "payment-instruction.create"]
                  }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Created, includes one-time plaintext key.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessApiKeyWithPlaintextResponse" },
                examples: {
                  success: {
                    value: {
                      key: {
                        id: "2f3c17d4-2b41-4cf1-aab4-d68263cc8ccd",
                        keyPrefix: "gtt_live_8a1df4e0",
                        ownerBusinessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ",
                        ownerBusinessClientName: "Acme Trading LLC",
                        scopes: ["ada.read", "payment-instruction.create"],
                        status: "active",
                        createdAt: "2026-09-08T11:52:05.000Z"
                      },
                      plaintextKey: "gtt_live_8a1df4e0.7c6f0b3f0f524d3ab8b7f0f4a2ce0921"
                    }
                  }
                }
              }
            }
          },
          "400": {
            description: "Invalid request.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  invalid_scope: {
                    value: {
                      error: "invalid_scope",
                      detail: "One or more requested scopes are not allowed."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/business/api-keys/{id}/revoke": {
      post: {
        tags: ["Business API Keys"],
        summary: "Revoke business API key",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BusinessApiKeyRevokeRequest" },
              examples: {
                default: {
                  value: {
                    reason: "rotation_succeeded"
                  }
                }
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Revoked.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessApiKeyResponse" },
                examples: {
                  success: {
                    value: {
                      key: {
                        id: "2f3c17d4-2b41-4cf1-aab4-d68263cc8ccd",
                        keyPrefix: "gtt_live_8a1df4e0",
                        ownerBusinessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ",
                        ownerBusinessClientName: "Acme Trading LLC",
                        scopes: ["ada.read"],
                        status: "revoked",
                        createdAt: "2026-09-08T11:52:05.000Z",
                        revokedAt: "2026-09-08T12:15:00.000Z"
                      }
                    }
                  }
                }
              }
            }
          },
          "404": {
            description: "Not found.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  api_key_not_found: {
                    value: {
                      error: "api_key_not_found",
                      detail: "API key was not found for this business client."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/business/api-keys/{id}/rotate": {
      post: {
        tags: ["Business API Keys"],
        summary: "Rotate business API key",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BusinessApiKeyRotateRequest" },
              examples: {
                keep_or_update_scopes: {
                  value: {
                    scopes: ["ada.read", "payment-instruction.create"]
                  }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Rotated with one-time plaintext key.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessApiKeyRotateResponse" },
                examples: {
                  success: {
                    value: {
                      key: {
                        id: "5e5296d8-55e6-4f5a-bb02-f1f1c7e508a1",
                        keyPrefix: "gtt_live_1726fd3b",
                        ownerBusinessClientId: "bc_01J6T8BCRX9KP0Q2WJ9GT5B2TQ",
                        ownerBusinessClientName: "Acme Trading LLC",
                        scopes: ["ada.read", "payment-instruction.create"],
                        status: "active",
                        createdAt: "2026-09-08T12:20:12.000Z"
                      },
                      plaintextKey: "gtt_live_1726fd3b.b72a9e68de4f4e77b8ecb1af53dc8af2",
                      rotatedFromApiKeyId: "2f3c17d4-2b41-4cf1-aab4-d68263cc8ccd"
                    }
                  }
                }
              }
            }
          },
          "404": {
            description: "Not found.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  api_key_not_found: {
                    value: {
                      error: "api_key_not_found",
                      detail: "API key was not found for this business client."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/business/me/funding-instructions": {
      get: {
        tags: ["Business Funding Instructions"],
        summary: "List my funding instructions",
        description: "Accepts Supabase user bearer auth or business API key with payment-instruction.read.",
        responses: {
          "200": {
            description: "Funding instruction list.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessFundingInstructionListResponse" },
                examples: {
                  success: {
                    value: {
                      fundingInstructions: [
                        {
                          id: "fe2f1f74-8de8-4f89-b094-c7ca41b22875",
                          sourceAccountOfDigitalAssetId: "66c3df29-a9ed-45aa-b9af-cd9940f6f314",
                          sourceAdaCode: "DAA-USDC-OPS-SOUR",
                          sourceAccountCode: "DAA-USDC-OPS-SOUR",
                          destinationAccountOfDigitalAssetId: "2f64d70f-fcbd-4ec6-8eb5-06fae53cb5ef",
                          destinationAdaCode: "DAA-USDC-LIQ-DEST",
                          destinationAccountCode: "DAA-USDC-LIQ-DEST",
                          fundingType: "usdc_payin",
                          instructionRole: "client_exchange",
                          transferKind: "ada_to_ada_payin_underlying",
                          assetCode: "USDC",
                          currency: "USD",
                          amountMinorUnits: "1250000",
                          pendingUsdcMinorUnits: "0",
                          availableUsdcMinorUnits: "1250000",
                          status: "completed"
                        }
                      ]
                    }
                  }
                }
              }
            }
          },
          "401": {
            description: "Unauthorized.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  business_user_auth_required: {
                    value: {
                      error: "business_user_auth_required",
                      detail: "Missing or invalid bearer token."
                    }
                  }
                }
              }
            }
          }
        }
      },
      post: {
        tags: ["Business Funding Instructions"],
        summary: "Create funding instruction",
        description: "Accepts Supabase user bearer auth or business API key with payment-instruction.create.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/BusinessFundingInstructionCreateRequest" },
              examples: {
                usdc_payin: {
                  value: {
                    sourceAccountOfDigitalAssetId: "66c3df29-a9ed-45aa-b9af-cd9940f6f314",
                    destinationAccountOfDigitalAssetId: "2f64d70f-fcbd-4ec6-8eb5-06fae53cb5ef",
                    fundingType: "usdc_payin",
                    provider: "circle",
                    assetCode: "USDC",
                    currency: "USD",
                    amountMinorUnits: "1250000"
                  }
                }
              }
            }
          }
        },
        responses: {
          "201": {
            description: "Funding instruction created.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessFundingInstructionDetailResponse" },
                examples: {
                  success: {
                    value: {
                      fundingInstruction: {
                        id: "fe2f1f74-8de8-4f89-b094-c7ca41b22875",
                        sourceAccountOfDigitalAssetId: "66c3df29-a9ed-45aa-b9af-cd9940f6f314",
                        sourceAdaCode: "DAA-USDC-OPS-SOUR",
                        sourceAccountCode: "DAA-USDC-OPS-SOUR",
                        destinationAccountOfDigitalAssetId: "2f64d70f-fcbd-4ec6-8eb5-06fae53cb5ef",
                        destinationAdaCode: "DAA-USDC-LIQ-DEST",
                        destinationAccountCode: "DAA-USDC-LIQ-DEST",
                        fundingType: "usdc_payin",
                        instructionRole: "client_exchange",
                        transferKind: "ada_to_ada_payin_underlying",
                        assetCode: "USDC",
                        currency: "USD",
                        amountMinorUnits: "1250000",
                        pendingUsdcMinorUnits: "0",
                        availableUsdcMinorUnits: "1250000",
                        status: "completed"
                      },
                      orders: [
                        {
                          id: "8c900f31-4dd8-47c7-9950-95cff5ce8194",
                          orderKind: "ada_wire_transfer",
                          stage: "fiat_received",
                          amountMinorUnits: "1250000",
                          currency: "USD",
                          status: "completed"
                        }
                      ]
                    }
                  }
                }
              }
            }
          },
          "400": {
            description: "Validation or policy failure.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  amount_must_be_positive: {
                    value: {
                      error: "amount_must_be_positive",
                      detail: "amountMinorUnits must be a positive integer string."
                    }
                  }
                }
              }
            }
          },
          "401": {
            description: "Unauthorized.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  business_user_auth_required: {
                    value: {
                      error: "business_user_auth_required",
                      detail: "Missing or invalid bearer token."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/business/me/funding-instructions/{id}": {
      get: {
        tags: ["Business Funding Instructions"],
        summary: "Get funding instruction detail",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Funding instruction detail.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessFundingInstructionDetailResponse" },
                examples: {
                  success: {
                    value: {
                      fundingInstruction: {
                        id: "fe2f1f74-8de8-4f89-b094-c7ca41b22875",
                        sourceAccountOfDigitalAssetId: "66c3df29-a9ed-45aa-b9af-cd9940f6f314",
                        sourceAdaCode: "DAA-USDC-OPS-SOUR",
                        sourceAccountCode: "DAA-USDC-OPS-SOUR",
                        destinationAccountOfDigitalAssetId: "2f64d70f-fcbd-4ec6-8eb5-06fae53cb5ef",
                        destinationAdaCode: "DAA-USDC-LIQ-DEST",
                        destinationAccountCode: "DAA-USDC-LIQ-DEST",
                        fundingType: "usdc_payin",
                        instructionRole: "client_exchange",
                        transferKind: "ada_to_ada_payin_underlying",
                        assetCode: "USDC",
                        currency: "USD",
                        amountMinorUnits: "1250000",
                        pendingUsdcMinorUnits: "0",
                        availableUsdcMinorUnits: "1250000",
                        status: "completed"
                      },
                      orders: [
                        {
                          id: "8c900f31-4dd8-47c7-9950-95cff5ce8194",
                          orderKind: "ada_wire_transfer",
                          stage: "fiat_received",
                          amountMinorUnits: "1250000",
                          currency: "USD",
                          status: "completed"
                        }
                      ]
                    }
                  }
                }
              }
            }
          },
          "404": {
            description: "Not found.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  funding_instruction_not_found: {
                    value: {
                      error: "funding_instruction_not_found",
                      detail: "Funding instruction not found for this business client."
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/business/me/funding-instructions/{id}/orders": {
      get: {
        tags: ["Business Funding Instructions"],
        summary: "Get funding instruction orders",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Funding order timeline.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BusinessFundingInstructionOrdersResponse" },
                examples: {
                  success: {
                    value: {
                      fundingInstructionId: "fe2f1f74-8de8-4f89-b094-c7ca41b22875",
                      orders: [
                        {
                          id: "8c900f31-4dd8-47c7-9950-95cff5ce8194",
                          orderKind: "ada_wire_transfer",
                          stage: "fiat_received",
                          amountMinorUnits: "1250000",
                          currency: "USD",
                          status: "completed"
                        }
                      ]
                    }
                  }
                }
              }
            }
          },
          "404": {
            description: "Not found.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                examples: {
                  funding_instruction_not_found: {
                    value: {
                      error: "funding_instruction_not_found",
                      detail: "Funding instruction not found for this business client."
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

export const gttServiceOpenApiSpec: OpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Global Trade Treasury Service API",
    version: "0.1.0-service",
    description: "Platform operations, treasury execution, Circle integrations, webhooks, and reporting APIs."
  },
  servers: localServer,
  tags: [
    { name: "Platform", description: "Health, readiness, and manifest." },
    { name: "API Keys", description: "Service API key lifecycle." },
    { name: "Business Clients", description: "Business client onboarding and lifecycle." },
    { name: "Digital Assets", description: "Internal ADA management and linked instruments." },
    { name: "Treasury", description: "Funding, payments, reservations, and settlements." },
    { name: "Ledger", description: "Journal and accounting controls." },
    { name: "Circle", description: "Circle integration diagnostics and webhook ingestion." }
  ],
  security: [{ ApiKeyBearer: [] }, { ApiKeyHeader: [] }],
  components: {
    securitySchemes: {
      ApiKeyBearer: {
        type: "http",
        scheme: "bearer",
        description: "Authorization: Bearer gtt_live_<key_id>.<secret>."
      },
      ApiKeyHeader: {
        type: "apiKey",
        in: "header",
        name: "X-GTT-API-Key",
        description: "X-GTT-API-Key: gtt_live_<key_id>.<secret>."
      }
    },
    schemas: {
      ServiceApiKeyCreateRequest: {
        type: "object",
        properties: {
          clientName: { type: "string" },
          scopes: { type: "array", items: { type: "string" } },
          expiresAt: { type: "string", format: "date-time" }
        },
        example: {
          clientName: "Treasury Automation",
          scopes: ["read:operations", "write:payments"],
          expiresAt: "2027-12-31T00:00:00.000Z"
        }
      },
      ServiceApiKeyRevokeRequest: {
        type: "object",
        properties: {
          reason: { type: "string" }
        },
        example: {
          reason: "incident_response"
        }
      },
      ServiceBusinessClientCreateRequest: {
        type: "object",
        properties: {
          legalName: { type: "string" },
          country: { type: "string" },
          circleWalletSetId: { type: "string" }
        },
        example: {
          legalName: "Acme Trading LLC",
          country: "US",
          circleWalletSetId: "wallet_set_123"
        }
      },
      ServiceAdaAccountCreateRequest: {
        type: "object",
        required: ["businessClientId"],
        properties: {
          businessClientId: { type: "string" },
          accountName: { type: "string" }
        },
        example: {
          businessClientId: "client_buyer",
          accountName: "Buyer Treasury ADA"
        }
      },
      ServiceFundingInstructionCreateRequest: {
        type: "object",
        required: ["sourceAccountOfDigitalAssetId", "destinationAccountOfDigitalAssetId", "amountMinorUnits"],
        properties: {
          sourceAccountOfDigitalAssetId: { type: "string", format: "uuid" },
          destinationAccountOfDigitalAssetId: { type: "string", format: "uuid" },
          amountMinorUnits: { type: "string", pattern: "^[0-9]+$" },
          transferSubtype: { type: "string", enum: ["transfer_instruction", "payment_instruction"] },
          instructionType: { type: "string" },
          externalizationIntent: { type: "string" }
        },
        example: {
          sourceAccountOfDigitalAssetId: "00000000-0000-4000-8000-000000000111",
          destinationAccountOfDigitalAssetId: "00000000-0000-4000-8000-000000000222",
          amountMinorUnits: "2500000",
          transferSubtype: "transfer_instruction",
          instructionType: "client_rebalance"
        }
      },
      ServiceFundingReservationCreateRequest: {
        type: "object",
        required: ["settlementObligationId", "accountOfDigitalAssetId", "amountMinorUnits"],
        properties: {
          settlementObligationId: { type: "string" },
          accountOfDigitalAssetId: { type: "string" },
          amountMinorUnits: { type: "string", pattern: "^[0-9]+$" }
        },
        example: {
          settlementObligationId: "obligation_123",
          accountOfDigitalAssetId: "ada_buyer",
          amountMinorUnits: "100000000"
        }
      },
      ServiceLedgerJournalCreateRequest: {
        type: "object",
        required: ["amountMinorUnits", "debitLedgerAccountCode", "creditLedgerAccountCode"],
        properties: {
          description: { type: "string" },
          amountMinorUnits: { type: "string", pattern: "^[0-9]+$" },
          debitLedgerAccountCode: { type: "string" },
          creditLedgerAccountCode: { type: "string" },
          accountOfDigitalAssetId: { type: "string" }
        },
        example: {
          description: "Settlement posting",
          amountMinorUnits: "1250000",
          debitLedgerAccountCode: "10020",
          creditLedgerAccountCode: "20400",
          accountOfDigitalAssetId: "ada_buyer"
        }
      },
      ServiceCircleSandboxCheckRequest: {
        type: "object",
        properties: {
          probe: { type: "boolean" }
        },
        example: {
          probe: true
        }
      },
      ServiceCircleWebhookRequest: {
        type: "object",
        additionalProperties: true,
        example: {
          type: "payments.transfer.completed",
          id: "evt_123",
          data: {
            transferId: "tr_123",
            status: "complete"
          }
        }
      }
    }
  },
  "x-gtt-transfer-taxonomy": transferTaxonomy,
  paths: {
    "/health": { get: { tags: ["Platform"], security: [], summary: "Service health", responses: { "200": { description: "Healthy." } } } },
    "/manifest": { get: { tags: ["Platform"], security: [], summary: "Manifest and migration state", responses: { "200": { description: "Manifest." } } } },
    "/readiness": { get: { tags: ["Platform"], security: [], summary: "Readiness status", responses: { "200": { description: "Readiness details." } } } },
    "/api-keys": {
      get: { tags: ["API Keys"], summary: "List service API keys", responses: { "200": { description: "API key metadata." } } },
      post: {
        tags: ["API Keys"],
        summary: "Create service API key",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ServiceApiKeyCreateRequest" },
              examples: {
                default: {
                  value: {
                    clientName: "Treasury Automation",
                    scopes: ["read:operations", "write:payments"],
                    expiresAt: "2027-12-31T00:00:00.000Z"
                  }
                }
              }
            }
          }
        },
        responses: { "201": { description: "Created key." } }
      }
    },
    "/api-keys/{id}/revoke": {
      post: {
        tags: ["API Keys"],
        summary: "Revoke service API key",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ServiceApiKeyRevokeRequest" },
              examples: {
                default: {
                  value: {
                    reason: "incident_response"
                  }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Revoked." } }
      }
    },
    "/business-clients": {
      get: { tags: ["Business Clients"], summary: "List business clients", responses: { "200": { description: "Business clients." } } },
      post: {
        tags: ["Business Clients"],
        summary: "Create business client",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ServiceBusinessClientCreateRequest" },
              examples: {
                default: {
                  value: {
                    legalName: "Acme Trading LLC",
                    country: "US",
                    circleWalletSetId: "wallet_set_123"
                  }
                }
              }
            }
          }
        },
        responses: { "201": { description: "Business client created." } }
      }
    },
    "/accounts-of-digital-asset": {
      get: { tags: ["Digital Assets"], summary: "List ADA accounts", responses: { "200": { description: "ADA accounts." } } },
      post: {
        tags: ["Digital Assets"],
        summary: "Create ADA account",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ServiceAdaAccountCreateRequest" },
              examples: {
                default: {
                  value: {
                    businessClientId: "client_buyer",
                    accountName: "Buyer Treasury ADA"
                  }
                }
              }
            }
          }
        },
        responses: { "201": { description: "ADA account created." } }
      }
    },
    "/funding-instructions": {
      get: { tags: ["Treasury"], summary: "List funding instructions", responses: { "200": { description: "Funding instructions." } } },
      post: {
        tags: ["Treasury"],
        summary: "Create funding instruction",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ServiceFundingInstructionCreateRequest" },
              examples: {
                default: {
                  value: {
                    sourceAccountOfDigitalAssetId: "00000000-0000-4000-8000-000000000111",
                    destinationAccountOfDigitalAssetId: "00000000-0000-4000-8000-000000000222",
                    amountMinorUnits: "2500000",
                    transferSubtype: "transfer_instruction",
                    instructionType: "client_rebalance"
                  }
                }
              }
            }
          }
        },
        responses: { "201": { description: "Funding instruction created." } }
      }
    },
    "/funding-reservations": {
      get: { tags: ["Treasury"], summary: "List reservations", responses: { "200": { description: "Reservations." } } },
      post: {
        tags: ["Treasury"],
        summary: "Create reservation",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ServiceFundingReservationCreateRequest" },
              examples: {
                default: {
                  value: {
                    settlementObligationId: "obligation_123",
                    accountOfDigitalAssetId: "ada_buyer",
                    amountMinorUnits: "100000000"
                  }
                }
              }
            }
          }
        },
        responses: { "201": { description: "Reservation created." } }
      }
    },
    "/payments": {
      get: { tags: ["Treasury"], summary: "List payments", responses: { "200": { description: "Payments." } } }
    },
    "/ledger/journals": {
      get: { tags: ["Ledger"], summary: "List journals", responses: { "200": { description: "Journals." } } },
      post: {
        tags: ["Ledger"],
        summary: "Create journal entry",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ServiceLedgerJournalCreateRequest" },
              examples: {
                default: {
                  value: {
                    description: "Settlement posting",
                    amountMinorUnits: "1250000",
                    debitLedgerAccountCode: "10020",
                    creditLedgerAccountCode: "20400",
                    accountOfDigitalAssetId: "ada_buyer"
                  }
                }
              }
            }
          }
        },
        responses: { "201": { description: "Journal posted." } }
      }
    },
    "/integrations/circle/health": {
      get: { tags: ["Circle"], summary: "Circle integration health", responses: { "200": { description: "Circle status." } } }
    },
    "/integrations/circle/sandbox-check": {
      post: {
        tags: ["Circle"],
        summary: "Run Circle sandbox diagnostic",
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ServiceCircleSandboxCheckRequest" },
              examples: {
                default: {
                  value: {
                    probe: true
                  }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Diagnostic complete." } }
      }
    },
    "/webhooks/circle": {
      post: {
        tags: ["Circle"],
        security: [],
        summary: "Circle webhook ingest",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ServiceCircleWebhookRequest" },
              examples: {
                transfer_completed: {
                  value: {
                    type: "payments.transfer.completed",
                    id: "evt_123",
                    data: {
                      transferId: "tr_123",
                      status: "complete"
                    }
                  }
                }
              }
            }
          }
        },
        responses: { "200": { description: "Webhook processed." } }
      },
      head: { tags: ["Circle"], security: [], summary: "Webhook endpoint validation", responses: { "204": { description: "Endpoint is reachable." } } }
    }
  }
};

export const openApiIndex = {
  message: "OpenAPI documents",
  documents: [
    {
      name: "Business Client API",
      endpoint: "/openapi/business-client.json",
      yamlEndpoint: "/openapi/business-client.yaml",
      title: businessClientOpenApiSpec.info.title,
      version: businessClientOpenApiSpec.info.version
    },
    {
      name: "GTT Service API",
      endpoint: "/openapi/gtt-service.json",
      yamlEndpoint: "/openapi/gtt-service.yaml",
      title: gttServiceOpenApiSpec.info.title,
      version: gttServiceOpenApiSpec.info.version
    }
  ]
};

export const resolveOpenApiDocument = (pathname: string): OpenApiDocument | undefined => {
  if (pathname === "/openapi/business-client" || pathname === "/openapi/business-client.json" || pathname === "/openapi/business-client.yaml") {
    return businessClientOpenApiSpec;
  }
  if (pathname === "/openapi/gtt-service" || pathname === "/openapi/gtt-service.json" || pathname === "/openapi/gtt-service.yaml") {
    return gttServiceOpenApiSpec;
  }
  return undefined;
};
