import type { IFilter } from '@cybernetics/core';
import { parseTQL } from '@cybernetics/core';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class TqlPipe<T extends { filterByTql?: string; filter?: IFilter }>
  implements PipeTransform
{
  transform(value: T, _metadata: ArgumentMetadata) {
    this.transformFilterTql(value);
    return value;
  }

  private transformFilterTql(value: T): void {
    if (value.filterByTql) {
      try {
        value.filter = parseTQL(value.filterByTql);
      } catch (e) {
        throw new BadRequestException(`TQL parse error, ${(e as Error).message}`);
      }
    }
  }
}
