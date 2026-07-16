import { invariant } from "./errors.js";

export type MinorUnitAmount = bigint;

export const parseMinorUnits = (value: string | number | bigint): MinorUnitAmount => {
  if (typeof value === "bigint") {
    invariant(value >= 0n, "money_amount_negative");
    return value;
  }

  const text = String(value);
  invariant(/^[0-9]+$/.test(text), "money_amount_must_be_integer_minor_units", { value: text });
  return BigInt(text);
};

export const assertPositiveMinorUnits = (value: MinorUnitAmount): void => {
  invariant(value > 0n, "money_amount_must_be_positive");
};
