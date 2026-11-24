export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'HttpError';
  }
}

export function jsonError(status: number, message: string): HttpError {
  return new HttpError(status, message);
}
