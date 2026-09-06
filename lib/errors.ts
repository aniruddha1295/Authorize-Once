export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class DelegationUnavailableError extends Error {
  constructor(message = "Your account is not ready to delegate yet. Wait a moment, then retry.") {
    super(message);
    this.name = "DelegationUnavailableError";
  }
}

export function userFacingErrorMessage(
  err: unknown,
  fallback = "The savings-circle grant could not be updated. Please retry.",
): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof DelegationUnavailableError) return err.message;
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}