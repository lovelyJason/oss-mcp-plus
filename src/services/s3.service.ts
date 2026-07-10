import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import type { S3ClientConfig } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import { S3Config } from '../config/oss.config.js';
import type { UploadFileParams, UploadResult } from './oss.service.js';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.json': 'application/json',
  '.js': 'application/javascript', '.css': 'text/css',
  '.html': 'text/html', '.txt': 'text/plain',
  '.xml': 'application/xml', '.zip': 'application/zip',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
};

function getMimeType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export class S3Service {
  private clients: Map<string, S3Client> = new Map();

  private getClient(config: S3Config): S3Client {
    const cacheKey = `${config.region}:${config.bucket}:${config.endpoint || ''}`;
    if (this.clients.has(cacheKey)) {
      return this.clients.get(cacheKey)!;
    }

    const clientConfig: S3ClientConfig = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };

    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = true;
    }

    const client = new S3Client(clientConfig);
    this.clients.set(cacheKey, client);
    return client;
  }

  private getPublicUrl(config: S3Config, key: string): string {
    if (config.endpoint) {
      return `${config.endpoint.replace(/\/+$/, '')}/${config.bucket}/${key}`;
    }
    return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`;
  }

  private normalizePath(p: string): string {
    return p.replace(/^\/+/, '');
  }

  private buildKey(targetDir: string | undefined, fileName: string): string {
    if (!targetDir) return fileName;
    const normalizedDir = targetDir.replace(/^\/+|\/+$/g, '');
    return normalizedDir ? `${normalizedDir}/${fileName}` : fileName;
  }

  async uploadFile(params: UploadFileParams, config: S3Config): Promise<UploadResult> {
    const { filePath, targetDir = '', fileName, configName = 'default' } = params;

    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: `File not found: ${filePath}`, ossConfigName: configName };
      }

      const client = this.getClient(config);
      const actualFileName = fileName || path.basename(filePath);
      const key = this.buildKey(targetDir, actualFileName);

      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: fs.readFileSync(filePath),
        ContentType: getMimeType(filePath),
      }));

      return { success: true, url: this.getPublicUrl(config, key), ossConfigName: configName };
    } catch (error) {
      return { success: false, error: `Upload failed: ${(error as Error).message}`, ossConfigName: configName };
    }
  }

  async renameFile(
    oldKey: string, newKey: string, config: S3Config,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const client = this.getClient(config);
      const src = this.normalizePath(oldKey);
      const dst = this.normalizePath(newKey);

      try {
        await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: src }));
      } catch {
        return { success: false, error: `源文件不存在: ${src}` };
      }

      if (src !== dst) {
        try {
          await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: dst }));
          return { success: false, error: `目标文件已存在: ${dst}` };
        } catch {
          // 目标不存在，可以继续
        }
      }

      await client.send(new CopyObjectCommand({
        Bucket: config.bucket,
        CopySource: `${config.bucket}/${src}`,
        Key: dst,
      }));

      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: src }));

      return { success: true };
    } catch (error) {
      return { success: false, error: `重命名失败: ${(error as Error).message}` };
    }
  }

  async listFiles(
    directory: string = '',
    config: S3Config,
    pattern?: string,
  ): Promise<{ success: boolean; files?: Array<{ name: string; size: number; lastModified: Date }>; error?: string }> {
    try {
      const client = this.getClient(config);
      const normalizedDir = directory.replace(/^\/+|\/+$/g, '');
      const prefix = normalizedDir ? `${normalizedDir}/` : '';

      const result = await client.send(new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        Delimiter: '/',
        MaxKeys: 1000,
      }));

      const files: Array<{ name: string; size: number; lastModified: Date }> = [];

      if (result.Contents) {
        for (const obj of result.Contents) {
          if (!obj.Key || obj.Key.endsWith('/')) continue;
          const fileName = obj.Key.replace(prefix, '');
          if (!fileName) continue;

          if (pattern) {
            const regex = new RegExp(
              '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
              'i',
            );
            if (!regex.test(fileName)) continue;
          }

          files.push({
            name: fileName,
            size: obj.Size || 0,
            lastModified: obj.LastModified || new Date(),
          });
        }
      }

      files.sort((a, b) => a.name.localeCompare(b.name));
      return { success: true, files };
    } catch (error) {
      return { success: false, error: `列出文件失败: ${(error as Error).message}` };
    }
  }

  async batchRenameFiles(
    rules: Array<{ oldName: string; newName: string }>,
    directory: string = '',
    config: S3Config,
  ): Promise<Array<{ oldName: string; newName: string; success: boolean; error?: string }>> {
    const normalizedDir = directory.replace(/^\/+|\/+$/g, '');
    const dirPrefix = normalizedDir ? `${normalizedDir}/` : '';
    const results: Array<{ oldName: string; newName: string; success: boolean; error?: string }> = [];

    for (const rule of rules) {
      const result = await this.renameFile(`${dirPrefix}${rule.oldName}`, `${dirPrefix}${rule.newName}`, config);
      results.push({ oldName: rule.oldName, newName: rule.newName, ...result });
    }

    return results;
  }

  async deleteFile(key: string, config: S3Config): Promise<{ success: boolean; error?: string }> {
    try {
      const client = this.getClient(config);
      const normalizedKey = this.normalizePath(key);

      try {
        await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: normalizedKey }));
      } catch {
        return { success: false, error: `文件不存在: ${normalizedKey}` };
      }

      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: normalizedKey }));
      return { success: true };
    } catch (error) {
      return { success: false, error: `删除失败: ${(error as Error).message}` };
    }
  }

  async batchDeleteFiles(
    fileNames: string[],
    directory: string = '',
    config: S3Config,
  ): Promise<Array<{ fileName: string; success: boolean; error?: string }>> {
    const normalizedDir = directory.replace(/^\/+|\/+$/g, '');
    const dirPrefix = normalizedDir ? `${normalizedDir}/` : '';
    const results: Array<{ fileName: string; success: boolean; error?: string }> = [];

    for (const fileName of fileNames) {
      const result = await this.deleteFile(`${dirPrefix}${fileName}`, config);
      results.push({ fileName, ...result });
    }

    return results;
  }
}

export const s3Service = new S3Service();
