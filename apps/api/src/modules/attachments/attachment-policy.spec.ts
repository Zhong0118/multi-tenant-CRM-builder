import { attachmentFilename, validateAttachment } from './attachment-policy';
describe('attachment boundary', () => {
  it('preserves Chinese multipart filenames', () =>
    expect(attachmentFilename(Buffer.from('报价.pdf').toString('latin1'))).toBe(
      '报价.pdf',
    ));
  it('normalizes path and header control characters', () => {
    expect(attachmentFilename('../报价\r\n.pdf')).toBe('报价__.pdf');
  });
  it('rejects empty, oversized and executable uploads', () => {
    for (const [name, size] of [
      ['a.txt', 0],
      ['a.pdf', 5242881],
      ['a.exe', 20],
    ] as const)
      expect(() => validateAttachment(name, Buffer.alloc(size))).toThrow();
  });
  it('accepts a bounded document', () =>
    expect(() =>
      validateAttachment('notes.txt', Buffer.from('notes')),
    ).not.toThrow());
});
