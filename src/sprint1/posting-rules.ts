import { invariant } from "./errors.js";
import type { PostingRuleRecord, TreasuryAccountingEvent } from "./types.js";

export type PostingRule = PostingRuleRecord;

export const openingAdaPostingRule: PostingRule = {
  eventType: "treasury.opening_journal.posted",
  ruleName: "Opening ADA journal",
  status: "active",
  debitLedgerAccountCode: "10020",
  creditLedgerAccountCode: "20400"
};

export const initialPostingRules: PostingRule[] = [openingAdaPostingRule];

export const requireActivePostingRule = (
  rules: Map<string, PostingRule>,
  eventType: TreasuryAccountingEvent["eventType"]
): PostingRule => {
  const rule = rules.get(eventType);
  invariant(Boolean(rule), "posting_rule_not_found", { eventType });
  invariant(rule?.status === "active", "posting_rule_not_active", { eventType });
  return rule!;
};
