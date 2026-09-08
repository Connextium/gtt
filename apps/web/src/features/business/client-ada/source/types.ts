export type ScreenType = 
  | 'REGISTER_FIAT_RAIL'     // Fiat Rails Registry
  | 'PROVISION_FIAT_ADA'      // Fiat ADA Accounts
  | 'REGISTER_WALLET_RAIL'    // Wallet Rails Registry
  | 'PROVISION_WALLET_ADA';   // Wallet ADA Accounts

export type NavSection = 'COMMAND' | 'CLIENTS' | 'TREASURY' | 'EVIDENCE' | 'ADMINISTRATION';

export interface FiatRailItem {
  id: string;
  railNickname: string;
  bankingInstitution: string;
  routingTransitId: string;
  accountNumber: string;
  settlementPurpose: 'ON_RAMP' | 'OFF_RAMP' | 'DUAL_ACTIVE';
  currencyCode: string;
  beneficiaryName: string;
  taxId: string;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  autoProvisionAda: boolean;
  status: 'ACTIVE_VERIFIED' | 'PENDING_ATTESTATION' | 'DEACTIVATED';
  clearingProtocol: string;
  lastActive: string;
}

export interface FiatAdaItem {
  id: string;
  accountId: string;
  accountDisplayName: string;
  underlyingCurrency: string;
  settlementVehicle: string;
  selectedRail: string;
  balance: string;
  minOperatingBalance: string;
  targetSweepTrigger: string;
  allowFunding: boolean;
  allowRedemption: boolean;
  status: 'ACTIVE_ON_LEDGER' | 'RESTRICTED_SWEEP' | 'PROVISIONING';
  ledgerNode: string;
  lastReconciliation: string;
}

export interface WalletRailItem {
  id: string;
  railId: string;
  walletLabel: string;
  networkProtocol: string;
  addressSecurityType: string;
  destinationAddress: string;
  allowMintExternalization: boolean;
  allowIntraClientTransfer: boolean;
  allowInterClientPayment: boolean;
  signaturePayload: string;
  autoBindWalletAda: boolean;
  status: 'WHITELIST_ACTIVE' | 'AWAITING_QUORUM' | 'SUSPENDED';
  travelRuleStatus: string;
  registeredAt: string;
}

export interface WalletAdaItem {
  id: string;
  accountId: string;
  accountDisplayName: string;
  denominationAsset: string;
  settlementNetwork: string;
  selectedWalletRail: string;
  boundAddress: string;
  balance: string;
  allowTransfer: boolean;
  allowPayment: boolean;
  status: 'ACTIVE_ON_LEDGER' | 'PENDING_KEY_ASSIGNMENT' | 'FROZEN';
  isolationLevel: string;
  lastAttestation: string;
}

export interface TraceLogEntry {
  id: string;
  timestamp: string;
  level: 'INFO' | 'ATTEST' | 'ENCLAVE' | 'CLEARING';
  message: string;
  hash: string;
}

