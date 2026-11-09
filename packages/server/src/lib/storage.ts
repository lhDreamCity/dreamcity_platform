/**
 * 对象存储接口 —— 课件 / 作品 / 素材
 *
 * 本地开发落盘到 var/objects；生产走腾讯云 COS（S3 兼容协议）。
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { env } from '../env.js';

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer | null>;
  /** 私有读 + 签名 URL（设计方案 §7.3） */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

function guessContentType(key: string): string {
  const dot = key.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return CONTENT_TYPES[key.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}

class LocalObjectStore implements ObjectStore {
  constructor(private baseDir: string) {}

  private pathOf(key: string): string {
    return resolve(this.baseDir, key);
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const target = this.pathOf(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    return { key, size: body.byteLength, contentType: contentType || guessContentType(key) };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathOf(key));
    } catch {
      return null;
    }
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    // 本地开发：直接给后端路由 URL，带一个短时效签名
    const sig = sign(key, ttlSeconds);
    return `/files/${key}?t=${ttlSeconds}&sig=${sig}`;
  }

  async delete(key: string): Promise<void> {
    const { unlink } = await import('node:fs/promises');
    try {
      await unlink(this.pathOf(key));
    } catch {
      /* 不存在就算了 */
    }
  }
}

class S3ObjectStore implements ObjectStore {
  constructor(private client: S3Like, private bucket: string, private baseUrl: string) {}

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    await this.client.putObject({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || guessContentType(key),
    });
    return { key, size: body.byteLength, contentType: contentType || guessContentType(key) };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.getObject({ Bucket: this.bucket, Key: key });
      return Buffer.from(await res.Body.transformToByteArray());
    } catch {
      return null;
    }
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    return this.client.presignGet({ Bucket: this.bucket, Key: key, ExpiresIn: ttlSeconds });
  }

  async delete(key: string): Promise<void> {
    await this.client.deleteObject({ Bucket: this.bucket, Key: key });
  }
}

interface S3Like {
  putObject(input: {
    Bucket: string;
    Key: string;
    Body: Buffer;
    ContentType: string;
  }): Promise<unknown>;
  getObject(input: { Bucket: string; Key: string }): Promise<{
    Body: { transformToByteArray(): Promise<Uint8Array> };
  }>;
  presignGet(input: { Bucket: string; Key: string; ExpiresIn: number }): Promise<string>;
  deleteObject(input: { Bucket: string; Key: string }): Promise<unknown>;
}

let instance: ObjectStore | null = null;

export async function getObjectStore(): Promise<ObjectStore> {
  if (instance) return instance;
  if (env.objectStore.driver === 's3') {
    const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import(
      '@aws-sdk/client-s3'
    );
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const client = new S3Client({
      region: env.objectStore.region,
      endpoint: env.objectStore.endpoint || undefined,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.objectStore.accessKeyId,
        secretAccessKey: env.objectStore.secretAccessKey,
      },
    });
    const s3 = {
      putObject: (i: { Bucket: string; Key: string; Body: Buffer; ContentType: string }) =>
        client.send(new PutObjectCommand(i)),
      getObject: (i: { Bucket: string; Key: string }) =>
        client.send(new GetObjectCommand(i)) as Promise<never>,
      presignGet: (i: { Bucket: string; Key: string; ExpiresIn: number }) =>
        getSignedUrl(client, new GetObjectCommand(i), { expiresIn: i.ExpiresIn }),
      deleteObject: (i: { Bucket: string; Key: string }) =>
        client.send(new DeleteObjectCommand(i)),
    } as unknown as S3Like;
    instance = new S3ObjectStore(s3, env.objectStore.bucket, env.objectStore.publicBaseUrl);
  } else {
    instance = new LocalObjectStore(resolve(env.root, env.objectStore.dir));
  }
  return instance;
}

/* ── 本地驱动的签名 URL ────────────────────────────────────── */

const SIGNING_SECRET = () => env.token.secret || 'dreamcity-dev-signing-secret';

function sign(key: string, ttlSeconds: number): string {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${key}:${expiresAt}`;
  const h = createHash('sha256').update(`${payload}:${SIGNING_SECRET()}`).digest('hex');
  return `${expiresAt}.${h.slice(0, 32)}`;
}

export function verifySignedFile(key: string, expiresAt: string | undefined, sig: string | undefined): boolean {
  if (!expiresAt || !sig) return false;
  const ts = Number(expiresAt);
  if (!Number.isFinite(ts) || ts < Math.floor(Date.now() / 1000)) return false;
  const payload = `${key}:${ts}`;
  const h = createHash('sha256').update(`${payload}:${SIGNING_SECRET()}`).digest('hex');
  return h.slice(0, 32) === sig;
}

export function newObjectKey(prefix: string, filename: string): string {
  const safe = filename.replace(/[^\w.-]/g, '_');
  return `${prefix}/${randomUUID()}-${safe}`;
}
