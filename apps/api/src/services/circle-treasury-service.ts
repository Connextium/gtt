import type { CircleGateway } from "../modules/circle/circle-gateway.js";

export interface CircleTreasuryService {
  initializeWalletSet: CircleGateway["initializeWalletSet"];
  initializeTenantWallet: CircleGateway["initializeTenantWallet"];
  mintFiatToWallet: CircleGateway["mintFiatToWallet"];
  provisionAdaMapping: CircleGateway["provisionAdaMapping"];
  provisionSandboxWire: CircleGateway["provisionSandboxWire"];
  retrieveSandboxWireInstructions: CircleGateway["retrieveSandboxWireInstructions"];
}

export const createCircleTreasuryService = (
  circle: CircleGateway
): CircleTreasuryService => ({
  initializeWalletSet: (request) => circle.initializeWalletSet(request),
  initializeTenantWallet: (request) => circle.initializeTenantWallet(request),
  mintFiatToWallet: (request) => circle.mintFiatToWallet(request),
  provisionAdaMapping: (request) => circle.provisionAdaMapping(request),
  provisionSandboxWire: (request) => circle.provisionSandboxWire(request),
  retrieveSandboxWireInstructions: (request) => circle.retrieveSandboxWireInstructions(request)
});