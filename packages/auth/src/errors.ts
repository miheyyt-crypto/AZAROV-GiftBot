export class AuthError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export class InvalidInitDataError extends AuthError {
  constructor(message = "telegram init data is invalid") {
    super("INVALID_INIT_DATA", message, 401);
  }
}

export class AuthDateExpiredError extends AuthError {
  constructor() {
    super("AUTH_DATE_EXPIRED", "telegram init data is too old", 401);
  }
}

export class SessionUnauthorizedError extends AuthError {
  constructor() {
    super("UNAUTHORIZED", "session is missing, expired, or revoked", 401);
  }
}

export class ForbiddenError extends AuthError {
  constructor(message: string) {
    super("FORBIDDEN", message, 403);
  }
}
