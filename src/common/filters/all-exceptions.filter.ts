import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponseBody {
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  message: string | string[];
  error: string;
}

/**
 * Global exception filter that normalizes every error into a consistent JSON shape
 * and logs unexpected (non-HTTP) failures.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const { message, error } = this.resolveMessage(exception, status);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseBody = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message,
      error,
    };

    response.status(status).json(body);
  }

  private resolveMessage(
    exception: unknown,
    status: number,
  ): { message: string | string[]; error: string } {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        return { message: res, error: exception.name };
      }
      const obj = res as Record<string, unknown>;
      return {
        message: (obj.message as string | string[]) ?? exception.message,
        error: (obj.error as string) ?? exception.name,
      };
    }

    return {
      message:
        status === HttpStatus.INTERNAL_SERVER_ERROR ? 'Internal server error' : 'Unexpected error',
      error: 'InternalServerError',
    };
  }
}
