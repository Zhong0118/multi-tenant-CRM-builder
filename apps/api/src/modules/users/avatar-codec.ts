import sharp from 'sharp';
import { ApiException } from '../../common/errors/api.exception';

export const MAX_AVATAR_BYTES = 300 * 1024;
export const avatarUrl = (userId: string, version?: string | null) =>
  version ? `/api/v1/users/${userId}/avatar/${version}` : null;

export async function encodeAvatar(bytes: Buffer): Promise<Buffer> {
  try {
    const png = bytes
      .subarray(0, 8)
      .equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const webp =
      bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!(png || jpeg || webp)) throw new Error();
    // libvips can expose APNG as a plain single-page PNG. Reject its animation header explicitly.
    if (png) {
      for (
        let off = 8;
        off + 12 <= bytes.length;
        off += bytes.readUInt32BE(off) + 12
      ) {
        if (bytes.toString('ascii', off + 4, off + 8) === 'acTL')
          throw new Error();
      }
    }
    const image = sharp(bytes, {
      limitInputPixels: 16_000_000,
      failOn: 'warning',
    });
    const meta = await image.metadata();
    if (
      (meta.pages ?? 1) !== 1 ||
      !['jpeg', 'png', 'webp'].includes(meta.format)
    )
      throw new Error();
    return await image
      .rotate()
      .resize(256, 256, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new ApiException('VALIDATION_FAILED', 400, {
      fieldErrors: { file: ['请选择有效的静态 JPEG、PNG 或 WebP 图片。'] },
    });
  }
}
