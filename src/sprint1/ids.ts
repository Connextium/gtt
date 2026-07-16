let sequence = 1;

export const nextId = (prefix: string): string => {
  const value = String(sequence).padStart(12, "0");
  sequence += 1;
  return `${prefix}_${value}`;
};

export const resetIdsForTest = (): void => {
  sequence = 1;
};

export const nowIso = (): string => new Date().toISOString();
