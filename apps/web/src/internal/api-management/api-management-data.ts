export type ApiKeyStatus = "active" | "revoked" | "expired";

export interface ApiClientData {
  id: string;
  uuid: string;
  name: string;
  keyPrefix: string;
  status: ApiKeyStatus;
  scopes: string[];
  created?: string;
  expires?: string;
  lastUsed?: string;
  lastIp?: string;
}

export const apiClientsData: ApiClientData[] = [
  {
    id: "1",
    name: "Settlement-Service-Prod",
    uuid: "8821-33X-99P",
    keyPrefix: "ak_live_72kX...",
    status: "active",
    scopes: ["read:ledger", "write:tx"],
    created: "2023-11-04",
    lastIp: "192.168.1.104"
  },
  {
    id: "2",
    name: "Staging-Validator-04",
    uuid: "4129-99Z-00L",
    keyPrefix: "ak_test_00vM...",
    status: "revoked",
    scopes: ["admin:full"],
    created: "2023-08-12",
    lastUsed: "2023-12-01"
  },
  {
    id: "3",
    name: "Reporting-Dashboard-Ext",
    uuid: "1102-44Y-55A",
    keyPrefix: "ak_live_55pN...",
    status: "expired",
    scopes: ["read:analytics"],
    created: "2023-01-20",
    expires: "2024-01-20"
  },
  {
    id: "4",
    name: "OMS-Integration-Core",
    uuid: "5590-11T-22K",
    keyPrefix: "ak_live_bb9Q...",
    status: "active",
    scopes: ["order:create", "order:cancel"],
    lastUsed: "2 min ago",
    lastIp: "10.0.4.15"
  }
];
