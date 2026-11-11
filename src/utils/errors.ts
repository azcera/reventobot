export interface OperationError extends Error {
  code?: string | number;
  status?: number;
  data?: { retry_after?: number; opcode?: number };
}

/** Preserve known diagnostic fields without trusting arbitrary thrown values. */
export function getError(value: unknown): OperationError {
  const error: OperationError = value instanceof Error ? value : new Error(String(value));
  if (typeof value === 'object' && value !== null) {
    if ('code' in value && (typeof value.code === 'string' || typeof value.code === 'number')) error.code = value.code;
    if ('status' in value && typeof value.status === 'number') error.status = value.status;
    if ('data' in value && typeof value.data === 'object' && value.data !== null) {
      const data = value.data;
      error.data = {
        retry_after: 'retry_after' in data && typeof data.retry_after === 'number' ? data.retry_after : undefined,
        opcode: 'opcode' in data && typeof data.opcode === 'number' ? data.opcode : undefined
      };
    }
  }
  return error;
}
