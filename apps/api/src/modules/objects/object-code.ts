/** Runtime references accept current hyphenated codes and legacy underscore codes. */
export const OBJECT_CODE_REFERENCE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

/** Identifiers accepted when creating a new table or field. */
export const NEW_OBJECT_CODE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
