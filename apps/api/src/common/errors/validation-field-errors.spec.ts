import type { ValidationError } from 'class-validator';

import { validationFieldErrors } from './validation-field-errors';

function error(
  property: string,
  constraints?: Record<string, string>,
  children?: ValidationError[],
): ValidationError {
  return { property, constraints, children } as ValidationError;
}

describe('validationFieldErrors', () => {
  it('keys each constraint message by its property', () => {
    expect(
      validationFieldErrors([
        error('expectedVersion', {
          isInt: 'expectedVersion must be an integer number',
        }),
      ]),
    ).toEqual({
      expectedVersion: ['expectedVersion must be an integer number'],
    });
  });

  it('nests child errors under their parent path', () => {
    expect(
      validationFieldErrors([
        error('rows', undefined, [
          error('0', { isObject: 'each value in rows must be an object' }),
        ]),
      ]),
    ).toEqual({ 'rows.0': ['each value in rows must be an object'] });
  });

  it('omits properties that carry no constraint message', () => {
    expect(validationFieldErrors([error('code')])).toEqual({});
  });
});
