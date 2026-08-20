import type { NextFunction, Request, Response } from 'express';

import { RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  it('keeps a valid incoming ID and returns it as a response header', () => {
    const request = {
      headers: { 'x-request-id': 'req_browser-01' },
    } as unknown as Request;
    const setHeader = jest.fn();
    const response = { setHeader } as unknown as Response;
    const next = jest.fn() as NextFunction;

    new RequestIdMiddleware().use(request, response, next);

    expect(request).toHaveProperty('requestId', 'req_browser-01');
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', 'req_browser-01');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('replaces an unsafe incoming ID', () => {
    const request = {
      headers: { 'x-request-id': 'contains whitespace and / separators' },
    } as unknown as Request;
    const response = { setHeader: jest.fn() } as unknown as Response;

    new RequestIdMiddleware().use(request, response, jest.fn());

    expect(request).toHaveProperty(
      'requestId',
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
  });
});
