import type { PublishedFieldType } from '../objects/object-schema';

export interface ImportModelColumn {
  col: string;
  header: string;
  samples: string[];
  values: Array<{ ref: string; text: string; count: number }>;
  locked?: { mode: 'field' | 'append'; field: string };
  partial?: boolean;
}

export interface ImportAssistModelInput {
  sheet: string;
  currentHeader: number;
  headerLocked: boolean;
  candidates: Array<{ headerRow: number; columns: ImportModelColumn[] }>;
  fields: Array<{
    ref: string;
    name: string;
    type: PublishedFieldType;
    required: boolean;
    options: Array<{ ref: string; name: string }>;
  }>;
}
