import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3"
import { env } from "@my-better-t-app/env/server"

export const s3 = new S3Client({
  region: "auto",
  endpoint: env.S3_ENDPOINT,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
})

const BUCKET = env.S3_BUCKET_NAME

export async function uploadToStorage(
  key: string,
  body: Buffer | ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body instanceof ArrayBuffer ? new Uint8Array(body) : body,
      ContentType: contentType,
    }),
  )
}

export async function downloadFromStorage(key: string): Promise<ArrayBuffer> {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
  )
  if (!response.Body) {
    throw new Error(`Empty response body for key: ${key}`)
  }
  const bytes = await response.Body.transformToByteArray()
  return bytes.buffer as ArrayBuffer
}

export async function existsInStorage(key: string): Promise<boolean> {
  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: BUCKET,
        Key: key,
      }),
    )
    return true
  } catch {
    return false
  }
}
