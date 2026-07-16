export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message = code,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export const invariant = (
  condition: boolean,
  code: string,
  details: Record<string, unknown> = {}
): void => {
  if (!condition) {
    throw new DomainError(code, code, details);
  }
};
