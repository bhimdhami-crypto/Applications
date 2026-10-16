import { ArgumentsHost, Catch, ConflictException, ExceptionFilter, NotFoundException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Prisma } from '@prisma/client';

/** Turns database constraint errors into readable 409 and 404 answers */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaErrorsFilter extends BaseExceptionFilter implements ExceptionFilter {
  catch(e: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    if (e.code === 'P2002') {
      const fields = ([] as string[]).concat((e.meta?.target as string[] | string) ?? []).join(', ');
      return super.catch(new ConflictException(`That ${fields.includes('code') ? 'code' : 'value'} is already in use`), host);
    }
    if (e.code === 'P2025') return super.catch(new NotFoundException('Not found'), host);
    return super.catch(e, host);
  }
}
