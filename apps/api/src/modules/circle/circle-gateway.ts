import {
  checkCircleHealth,
  initializeCircleWalletSet,
  initializeTenantCircleWallet,
  mintFiatToCircleWallet,
  provisionAdaCircleMapping,
  provisionSandboxWireFundingInstructions,
  retrieveSandboxWireFundingInstructions
} from "./index.js";

export interface CircleGateway {
  checkHealth: typeof checkCircleHealth;
  initializeWalletSet: typeof initializeCircleWalletSet;
  initializeTenantWallet: typeof initializeTenantCircleWallet;
  mintFiatToWallet: typeof mintFiatToCircleWallet;
  provisionAdaMapping: typeof provisionAdaCircleMapping;
  provisionSandboxWire: typeof provisionSandboxWireFundingInstructions;
  retrieveSandboxWireInstructions: typeof retrieveSandboxWireFundingInstructions;
}

export const circleGateway: CircleGateway = {
  checkHealth: checkCircleHealth,
  initializeWalletSet: initializeCircleWalletSet,
  initializeTenantWallet: initializeTenantCircleWallet,
  mintFiatToWallet: mintFiatToCircleWallet,
  provisionAdaMapping: provisionAdaCircleMapping,
  provisionSandboxWire: provisionSandboxWireFundingInstructions,
  retrieveSandboxWireInstructions: retrieveSandboxWireFundingInstructions
};