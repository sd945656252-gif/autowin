import type express from "express";

export class HttpError extends Error {
  status: number;
  code?: string;
  details?: any;

  constructor(status: number, message: string, code?: string, details?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function sendApiError(res: express.Response, error: any, fallbackMessage: string) {
  if (error instanceof HttpError) {
    res.status(error.status).json({
      success: false,
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.details !== undefined ? { details: error.details } : {})
    });
    return;
  }
  res.status(500).json({ success: false, error: fallbackMessage });
}
