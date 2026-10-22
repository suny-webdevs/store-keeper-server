import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { ErrorCode } from './types.js';
import type { ArgumentsHost } from '@nestjs/common';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    mockRequest = {
      url: '/test',
      requestId: 'req-test-123',
    };
    mockHost = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ArgumentsHost;
  });

  it('handles standard HttpException (e.g. NotFoundException)', () => {
    const exception = new NotFoundException('Branch not found');

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Branch not found',
        errors: [{ code: ErrorCode.NOT_FOUND, message: 'Branch not found' }],
        meta: expect.objectContaining({ requestId: 'req-test-123' }),
      }),
    );
  });

  it('normalizes class-validator array errors from BadRequestException', () => {
    const exception = new BadRequestException({
      message: ['email must be an email', 'fullName should not be empty'],
      error: 'Bad Request',
      statusCode: 400,
    });

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const jsonCall = mockResponse.json.mock.calls[0][0];

    expect(jsonCall.success).toBe(false);
    expect(jsonCall.message).toBe('Validation failed');
    expect(jsonCall.errors).toHaveLength(2);
    expect(jsonCall.errors[0].code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('handles Prisma P2002 unique constraint error', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['email'] },
      },
    );

    filter.catch(prismaError, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const jsonCall = mockResponse.json.mock.calls[0][0];

    expect(jsonCall.success).toBe(false);
    expect(jsonCall.errors[0].code).toBe(ErrorCode.DUPLICATE_EMAIL);
  });

  it('handles Prisma P2003 foreign key constraint error', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Foreign key constraint failed',
      {
        code: 'P2003',
        clientVersion: '6.19.3',
      },
    );

    filter.catch(prismaError, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const jsonCall = mockResponse.json.mock.calls[0][0];

    expect(jsonCall.errors[0].code).toBe('BLOCKED_BY_REFERENCE');
  });

  it('handles Prisma P2025 record not found error', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Record to update not found.',
      {
        code: 'P2025',
        clientVersion: '6.19.3',
      },
    );

    filter.catch(prismaError, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    const jsonCall = mockResponse.json.mock.calls[0][0];

    expect(jsonCall.errors[0].code).toBe(ErrorCode.NOT_FOUND);
  });

  it('handles Prisma connection failure (P1001 / P2024) with 503 Service Unavailable', () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      'Cannot reach database server',
      {
        code: 'P1001',
        clientVersion: '6.19.3',
      },
    );

    filter.catch(prismaError, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    const jsonCall = mockResponse.json.mock.calls[0][0];

    expect(jsonCall.errors[0].code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
  });

  it('catches unexpected non-Http errors with 500 status', () => {
    const unknownError = new Error('Unexpected crash');

    filter.catch(unknownError, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const jsonCall = mockResponse.json.mock.calls[0][0];

    expect(jsonCall.success).toBe(false);
    expect(jsonCall.message).toBe('An unexpected error occurred');
    expect(jsonCall.errors[0].code).toBe(ErrorCode.INTERNAL_ERROR);
  });
});
