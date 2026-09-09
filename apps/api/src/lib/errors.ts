export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const unauthorized = (message = "Sign in with Trust ID to continue.") =>
  new HttpError(401, "unauthorized", message);

export const badRequest = (code: string, message: string) => new HttpError(400, code, message);

export const forbidden = (message = "You do not have permission to do that.") =>
  new HttpError(403, "forbidden", message);

export const notFound = (message = "Not found.") => new HttpError(404, "not_found", message);

export const conflict = (code: string, message: string) => new HttpError(409, code, message);

export const unavailable = (code: string, message: string) => new HttpError(503, code, message);
