/**
 * One scale for every dialog and drawer, so the same kind of task opens at the
 * same size wherever it starts:
 *
 * - `confirm`: a question with one sentence of consequence (Modal).
 * - `form`: a short form, such as inviting a member or renaming (Modal).
 * - `narrow`: a drawer for a preview or a single choice beside the page.
 * - `drawer`: a drawer with a longer form or a detail to read.
 * - `wide`: a drawer whose content is a table, such as a bulk import.
 *
 * Anything that needs more than `wide` is a page of its own.
 */
export const OVERLAY_SIZE = {
  confirm: 440,
  form: 520,
  narrow: 480,
  drawer: 560,
  wide: 720,
} as const;
