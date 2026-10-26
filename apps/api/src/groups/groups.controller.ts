import { Controller, Get, Param, Query } from '@nestjs/common';
import { ListGroupsQuerySchema, type NeedGroupDetail, type NeedGroupList } from '@fis/contracts';
import type { z } from 'zod';
import { UuidPipe } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { GroupsService } from './groups.service';

@Controller({ path: 'groups' })
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListGroupsQuerySchema))
    query: z.output<typeof ListGroupsQuerySchema>,
  ): Promise<NeedGroupList> {
    return this.groups.list(query);
  }

  @Get(':id')
  get(@Param('id', UuidPipe) id: string): Promise<NeedGroupDetail> {
    return this.groups.get(id);
  }
}
