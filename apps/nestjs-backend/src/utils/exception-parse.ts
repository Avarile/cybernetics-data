import { HttpErrorCode, HttpError } from '@cybernetics/core';
import { HttpException } from '@nestjs/common';
import { CustomHttpException, getDefaultCodeByStatus } from '../custom.exception';

// Matched by name rather than instanceof: the main and data Prisma clients ship separate error classes.
const parsePrismaException = (exception: Error): CustomHttpException | undefined => {
  if (exception?.name === 'PrismaClientValidationError') {
    return new CustomHttpException('Invalid input', HttpErrorCode.VALIDATION_ERROR);
  }
  if (exception?.name !== 'PrismaClientKnownRequestError') {
    return;
  }
  switch ((exception as Error & { code?: string }).code) {
    // An *OrThrow lookup, update or delete matched no row
    case 'P2025':
      return new CustomHttpException('Resource not found', HttpErrorCode.NOT_FOUND);
    case 'P2002':
      return new CustomHttpException('Resource already exists', HttpErrorCode.CONFLICT);
    case 'P2003':
      return new CustomHttpException('Related resource not found', HttpErrorCode.VALIDATION_ERROR);
  }
};

export const exceptionParse = (
  exception: Error | HttpException | CustomHttpException | HttpError
): CustomHttpException => {
  if (exception instanceof HttpError) {
    return new CustomHttpException(exception.message, exception.code);
  }

  if (
    exception &&
    typeof exception === 'object' &&
    'code' in exception &&
    'getStatus' in exception
  ) {
    return exception;
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return new CustomHttpException(exception.message, getDefaultCodeByStatus(status));
  }

  const prismaException = parsePrismaException(exception);
  if (prismaException) {
    return prismaException;
  }

  return new CustomHttpException(
    process.env.NODE_ENV === 'test'
      ? `Internal Server Error: ${exception.message}, ${exception.stack}`
      : 'Internal Server Error',
    HttpErrorCode.INTERNAL_SERVER_ERROR
  );
};
