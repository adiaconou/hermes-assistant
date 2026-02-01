import type { Request, Response } from 'express';

type MockResponse = Response & {
  statusCode: number;
  headers: Record<string, string>;
  text?: string;
  body?: unknown;
  redirectedTo?: string;
};

type MockRequestOptions = {
  method?: string;
  url?: string;
  headers?: Record<string, string | undefined>;
  body?: unknown;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
};

export function createMockReqRes(options: MockRequestOptions = {}) {
  const req = {
    method: options.method ?? 'GET',
    url: options.url ?? '/',
    headers: options.headers ?? {},
    body: options.body,
    query: options.query ?? {},
    params: options.params ?? {},
  } as Request;

  const res: MockResponse = {
    statusCode: 200,
    headers: {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    set(field: string, value: string) {
      this.headers[field.toLowerCase()] = value;
      return this;
    },
    type(value: string) {
      return this.set('content-type', value);
    },
    send(payload?: unknown) {
      if (typeof payload === 'string') {
        this.text = payload;
      }
      this.body = payload;
      return this;
    },
    json(payload: unknown) {
      this.set('content-type', 'application/json');
      this.body = payload;
      return this;
    },
    redirect(location: string) {
      this.statusCode = 302;
      this.set('location', location);
      this.redirectedTo = location;
      return this;
    },
  } as MockResponse;

  return { req, res };
}
