import { PutObjectCommand } from '@aws-sdk/client-s3';

/** The image types a profile picture may have, with the file extension stored for each. */
export const PICTURE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
} as const;
export type PictureType = keyof typeof PICTURE_TYPES;

/**
 * Where profile pictures are kept. An interface so tests use an in-memory fake; in production
 * it is an S3 bucket served through CloudFront (api.md Q-2).
 */
export interface PictureStore {
  /**
   * Requires: key is unique to this picture and contains only URL-safe characters; bytes is
   *           an image of the given type.
   * Effects: stores the image.
   * @returns the public URL the image can be loaded from
   */
  save(key: string, bytes: Uint8Array, type: PictureType): Promise<string>;
}

/** The part of S3Client this class uses. */
export interface S3Like {
  send(command: PutObjectCommand): Promise<unknown>;
}

/**
 * PictureStore on S3. Objects are written under "pictures/" in a private bucket that
 * CloudFront serves at <publicBaseUrl>/pictures/... (template.yaml). Keys are never reused,
 * so objects can be cached forever.
 */
export class S3PictureStore implements PictureStore {
  /**
   * @param client        S3 client for the bucket's region
   * @param bucket        the bucket's name
   * @param publicBaseUrl origin that serves the bucket's "pictures/" prefix, no trailing slash
   */
  constructor(
    private readonly client: S3Like,
    private readonly bucket: string,
    private readonly publicBaseUrl: string,
  ) {}

  async save(key: string, bytes: Uint8Array, type: PictureType): Promise<string> {
    const path = `pictures/${key}.${PICTURE_TYPES[type]}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: path,
        Body: bytes,
        ContentType: type,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    return `${this.publicBaseUrl}/${path}`;
  }
}
