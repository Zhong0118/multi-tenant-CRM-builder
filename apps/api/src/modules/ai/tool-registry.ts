import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { TenantContext } from '../../common/tenancy/tenant-context';
import { PublishedObjectService } from '../objects/published-object.service';
import { RecordsService } from '../records/records.service';
import type { AiProviderTool } from './ai-provider';
import { createAggregateRecordsTool } from './tools/aggregate-records.tool';
import { createDescribeObjectTool } from './tools/describe-object.tool';
import { createGetRecordTool } from './tools/get-record.tool';
import { createListActivitiesTool } from './tools/list-activities.tool';
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

export class ToolUnavailableError extends Error {
  readonly code = 'DATA_UNAVAILABLE';

  constructor(toolName: string) {
    super(`${toolName} is not implemented`);
    this.name = 'ToolUnavailableError';
  }
}

const emptyInput = z.object({}).strict();

@Injectable()
export class AiToolRegistry {
  constructor(
    private readonly publishedObjects: PublishedObjectService,
    private readonly records: RecordsService,
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
      unimplementedTool('list_followups'),
    ];
  }
}

function unimplementedTool(
  name: Exclude<
    AiReadToolName,
    | 'list_objects'
    | 'describe_object'
    | 'search_records'
    | 'get_record'
    | 'aggregate_records'
    | 'list_activities'
  >,
): AiProviderTool {
  return {
    name,
    description: `${name} is not available yet.`,
    inputSchema: emptyInput,
    execute(input) {
      emptyInput.parse(input);
      return Promise.reject(new ToolUnavailableError(name));
    },
  };
}
