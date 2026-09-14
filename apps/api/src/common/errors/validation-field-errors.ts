import type { ValidationError } from 'class-validator';

import type { FieldErrors } from './api.exception';

/**
 * Turns the class-validator tree into the field-keyed shape the API envelope
 * promises. Without this the validation pipe throws a plain BadRequestException
 * and the filter can only answer with a generic message, which leaves callers
 * guessing which property was wrong.
 */
export function validationFieldErrors(errors: ValidationError[]): FieldErrors {
  const fieldErrors: FieldErrors = {};

  const walk = (list: ValidationError[], prefix: string) => {
    for (const error of list) {
      const path = prefix ? `${prefix}.${error.property}` : error.property;
      const messages = Object.values(error.constraints ?? {});
      if (messages.length > 0) fieldErrors[path] = messages;
      if (error.children?.length) walk(error.children, path);
    }
  };

  walk(errors, '');
  return fieldErrors;
}
