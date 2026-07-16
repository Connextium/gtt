import type { LedgerAccount } from "./types.js";

export const initialControlAccounts: LedgerAccount[] = [
  {
    id: "ledger_10000",
    accountCode: "10000",
    accountName: "Platform Treasury USDC",
    accountClass: "Asset",
    normalBalance: "debit"
  },
  {
    id: "ledger_10020",
    accountCode: "10020",
    accountName: "Circle Business Account USDC",
    accountClass: "Asset",
    normalBalance: "debit"
  },
  {
    id: "ledger_10100",
    accountCode: "10100",
    accountName: "Escrow USDC Asset",
    accountClass: "Asset",
    normalBalance: "debit"
  },
  {
    id: "ledger_10150",
    accountCode: "10150",
    accountName: "Circle Settlement Suspense",
    accountClass: "Asset",
    normalBalance: "debit"
  },
  {
    id: "ledger_11000",
    accountCode: "11000",
    accountName: "Accepted Due Value Receivable",
    accountClass: "Asset",
    normalBalance: "debit"
  },
  {
    id: "ledger_20100",
    accountCode: "20100",
    accountName: "Supplier Advance Payable",
    accountClass: "Liability",
    normalBalance: "credit"
  },
  {
    id: "ledger_20200",
    accountCode: "20200",
    accountName: "Buyer Accepted Payable Clearing",
    accountClass: "Liability",
    normalBalance: "credit"
  },
  {
    id: "ledger_20400",
    accountCode: "20400",
    accountName: "Escrow Liability - Investor Funds",
    accountClass: "Liability",
    normalBalance: "credit"
  },
  {
    id: "ledger_20430",
    accountCode: "20430",
    accountName: "Customer ADA Liability - Available",
    accountClass: "Liability",
    normalBalance: "credit"
  },
  {
    id: "ledger_20440",
    accountCode: "20440",
    accountName: "Customer ADA Liability - Reserved",
    accountClass: "Liability",
    normalBalance: "credit"
  },
  {
    id: "ledger_40000",
    accountCode: "40000",
    accountName: "Platform Facilitation Fee Revenue",
    accountClass: "Revenue",
    normalBalance: "credit"
  },
  {
    id: "ledger_50000",
    accountCode: "50000",
    accountName: "Circle Transaction Fees Expense",
    accountClass: "Cost of revenue",
    normalBalance: "debit"
  }
];
