import { ApiException } from '../../common/errors/api.exception';
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export function attachmentFilename(value: string): string {
  // Multipart filenames may arrive as Latin-1 decoded UTF-8 bytes.
  if ([...value].every((c) => c.charCodeAt(0) <= 255)) {
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    if (!decoded.includes('\uFFFD')) value = decoded;
  }
  return (
    value
      .split(/[\\/]/)
      .pop()!
      .split('')
      .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? '_' : c))
      .join('')
      .trim()
      .slice(0, 180) || 'attachment'
  );
}
export function validateAttachment(name: string, content: Buffer) {
  if (
    !content.length ||
    content.length > MAX_ATTACHMENT_BYTES ||
    !/\.(pdf|png|jpe?g|txt|csv|docx|xlsx)$/i.test(name)
  )
    throw new ApiException('VALIDATION_FAILED', 400, {
      message:
        '支持 PDF、图片、TXT、CSV、DOCX、XLSX，单个文件不超过 5 MB，不能上传空文件。',
    });
}
