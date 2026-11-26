import sharp from 'sharp';
import { encodeAvatar } from './avatar-codec';

describe('avatar decoding', () => {
  it('auto-orients and crops a tagged JPEG to a metadata-free 256px WebP', async () => {
    // EXIF orientation 6 turns the red left half into the top half.
    const left = await sharp({
      create: { width: 40, height: 40, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    const image = await sharp({
      create: { width: 80, height: 40, channels: 3, background: 'blue' },
    })
      .composite([{ input: left, left: 0, top: 0 }])
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({
        IFD0: { Artist: 'PRIVATE_ARTIST' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '33/1 35/1 0/1' },
      })
      .toBuffer();
    expect((await sharp(image).metadata()).exif).toBeDefined();
    const output = await encodeAvatar(image);
    const meta = await sharp(output).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 256, height: 256 });
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    const { data, info } = await sharp(output)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const top = (32 * info.width + 128) * info.channels;
    const bottom = (224 * info.width + 128) * info.channels;
    expect(data[top]).toBeGreaterThan(220);
    expect(data[top + 2]).toBeLessThan(30);
    expect(data[bottom + 2]).toBeGreaterThan(220);
    expect(data[bottom]).toBeLessThan(30);
  });
  it('rejects disguised input, corrupt pixels, huge rasters and animations', async () => {
    const huge = await sharp({
      create: { width: 4001, height: 4000, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const animated = await sharp(Buffer.from([255, 0, 0, 0, 255, 0]), {
      raw: { width: 1, height: 2, channels: 3, pageHeight: 1 },
    })
      .webp({ delay: [100, 100], loop: 0 })
      .toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    for (const input of [
      Buffer.from('<svg/>'),
      Buffer.from('89504e470d0a1a0a', 'hex'),
      huge,
      animated,
    ]) {
      await expect(encodeAvatar(input)).rejects.toMatchObject({ status: 400 });
    }
  });
});
