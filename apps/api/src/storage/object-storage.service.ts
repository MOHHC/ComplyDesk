import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

const BUCKET = 'uploads';
const DOWNLOAD_URL_TTL_SECONDS = 300;

/**
 * Thin wrapper around Neon Object Storage's S3-compatible API. Credentials
 * and endpoint are injected per-branch by `neon env pull -s object-storage`
 * (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3,
 * AWS_REGION) — the same branch-scoping story as APP_RUNTIME_DATABASE_URL:
 * test and production each have their own bucket and credentials.
 *
 * The bucket is private. Nothing here ever returns a public URL; reads go
 * through a short-lived presigned GET, generated on request rather than
 * stored, so access can't outlive the evidence row without also outliving
 * whoever asked for it in the last few minutes.
 */
@Injectable()
export class ObjectStorageService {
  private readonly client = new S3Client({
    region: process.env.AWS_REGION,
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
    // Required for Neon's endpoint: without it the SDK addresses the
    // bucket as a subdomain of the endpoint host, which only resolves for
    // real AWS S3, not Neon's per-branch storage host.
    forcePathStyle: true,
  });

  /** Object key namespaced under the tenant, so a bug that guesses or
   * enumerates keys still can't reach another tenant's files — this is a
   * second, independent boundary alongside the Evidence row's own RLS,
   * not a replacement for it. */
  buildKey(tenantId: string, controlId: string, fileName: string): string {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${tenantId}/${controlId}/${Date.now()}-${randomUUID()}-${safeName}`;
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: BUCKET, Key: key }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  }
}
