import https from 'https';
import fs from 'fs';
import path from 'path';
import { getFigmaToken } from '../config/oss.config.js';

const FIGMA_API_BASE = 'https://api.figma.com/v1';

export interface FigmaExportOptions {
  fileKey: string;
  nodeId: string;
  scales: number[];
  format: 'png' | 'jpg' | 'svg' | 'pdf';
}

export interface FigmaExportResult {
  scale: number;
  imageUrl: string;
  localPath?: string;
  ossUrl?: string;
  fileName: string;
}

function httpsGet(url: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          httpsGet(redirectUrl, headers).then(resolve).catch(reject);
          return;
        }
      }

      if (res.statusCode !== 200) {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => reject(new Error(`Figma API 请求失败 (${res.statusCode}): ${body}`)));
        return;
      }

      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(body));
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Figma API 请求超时（30秒）'));
    });
    req.end();
  });
}

function httpsDownload(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = https;

    const request = protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          httpsDownload(redirectUrl, destPath).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`下载失败，HTTP 状态码: ${response.statusCode}`));
        return;
      }

      const fileStream = fs.createWriteStream(destPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });

      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });

    request.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });

    request.setTimeout(60000, () => {
      request.destroy();
      fs.unlink(destPath, () => {});
      reject(new Error('下载超时（60秒）'));
    });
  });
}

export class FigmaService {
  /**
   * 通过 Figma REST API 获取指定 scale 的图片导出 URL
   */
  async getImageUrls(
    fileKey: string,
    nodeId: string,
    scale: number,
    format: string,
    token: string,
  ): Promise<Record<string, string>> {
    const encodedNodeId = encodeURIComponent(nodeId);
    const url = `${FIGMA_API_BASE}/images/${fileKey}?ids=${encodedNodeId}&scale=${scale}&format=${format}`;

    const responseBody = await httpsGet(url, {
      'X-Figma-Token': token,
    });

    const data = JSON.parse(responseBody);

    if (data.err) {
      throw new Error(`Figma API 错误: ${data.err}`);
    }

    return data.images || {};
  }

  /**
   * 导出 Figma 多倍图到本地
   */
  async exportToLocal(
    options: FigmaExportOptions,
    targetDir: string,
    fileNamePrefix?: string,
  ): Promise<FigmaExportResult[]> {
    const token = getFigmaToken();
    if (!token) {
      throw new Error('未配置 Figma Token。请通过 --figma-token 参数或 FIGMA_TOKEN 环境变量配置。');
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const { fileKey, nodeId, scales, format } = options;
    const results: FigmaExportResult[] = [];

    for (const scale of scales) {
      const images = await this.getImageUrls(fileKey, nodeId, scale, format, token);
      const imageEntries = Object.entries(images);

      if (imageEntries.length === 0) {
        throw new Error(`Figma 未返回 scale=${scale} 的图片 URL，请检查 fileKey 和 nodeId 是否正确`);
      }

      for (const [_id, imageUrl] of imageEntries) {
        if (!imageUrl) {
          throw new Error(`Figma 返回了空的图片 URL (scale=${scale})，节点可能不支持导出`);
        }

        const suffix = scale === 1 ? '' : `@${scale}x`;
        const prefix = fileNamePrefix || nodeId.replace(/[:/]/g, '-');
        const fileName = `${prefix}${suffix}.${format}`;
        const localPath = path.join(targetDir, fileName);

        await httpsDownload(imageUrl, localPath);

        results.push({
          scale,
          imageUrl,
          localPath,
          fileName,
        });
      }
    }

    return results;
  }
}

export const figmaService = new FigmaService();
