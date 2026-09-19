import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { FollowUpsService } from '../follow-ups/follow-ups.service';
import { PublishedObjectService } from '../objects/published-object.service';
import { RecordsService } from '../records/records.service';
import type { AiProviderTool } from './ai-provider';
import { createAggregateRecordsTool } from './tools/aggregate-records.tool';
import { createDescribeObjectTool } from './tools/describe-object.tool';
import { createGetRecordTool } from './tools/get-record.tool';
import { createListActivitiesTool } from './tools/list-activities.tool';
import { createListFollowupsTool } from './tools/list-followups.tool';
import { createListObjectsTool } from './tools/list-objects.tool';
import { createSearchRecordsTool } from './tools/search-records.tool';

export const AI_READ_TOOL_NAMES = [
  'list_objects',
  'describe_object',
  'search_records',
  'get_record',
  'aggregate_records',
  'list_activities',
  'list_followups',
] as const;

export type AiReadToolName = (typeof AI_READ_TOOL_NAMES)[number];

export type AiToolCallbacks = Record<string, never>;

@Injectable()
export class AiToolRegistry {
  constructor(
    private readonly publishedObjects: PublishedObjectService,
    private readonly records: RecordsService,
    private readonly followUps: FollowUpsService,
  ) {}

  names(): AiReadToolName[] {
    return [...AI_READ_TOOL_NAMES];
  }

  forActor(
    context: TenantContext,
    _callbacks: AiToolCallbacks = {},
  ): AiProviderTool[] {
    return [
      createListObjectsTool(this.publishedObjects, context),
      createDescribeObjectTool(this.publishedObjects, context),
      createSearchRecordsTool(this.records, context),
      createGetRecordTool(this.records, context),
      createAggregateRecordsTool(this.records, context),
      createListActivitiesTool(this.records, context),
      createListFollowupsTool(this.followUps, context),
    ];
  }
}
