import OSS from 'ali-oss';
import fs from 'fs';
import path from 'path';
import { OssConfig, getOssConfig, getAllOssConfigs } from '../config/oss.config.js';
import { z } from 'zod';

// 上传文件参数验证Schema
export const UploadFileParamsSchema = z.object({
  filePath: z.string(),
  targetDir: z.string().optional(),
  fileName: z.string().optional(),
  configName: z.string().optional(),
});

// 导出上传文件参数类型
export type UploadFileParams = z.infer<typeof UploadFileParamsSchema>;

// 上传结果验证Schema
export const UploadResultSchema = z.object({
  success: z.boolean(),
  url: z.string().optional(),
  error: z.string().optional(),
  ossConfigName: z.string().optional(),
});

// 导出上传结果类型
export type UploadResult = z.infer<typeof UploadResultSchema>;

/**
 * OSS配置接口（包含ID和名称）
 */
export interface OssConfigWithMeta extends OssConfig {
  id: string;
  name: string;
}

/**
 * 阿里云OSS服务类
 */
export class OssService {
  private clients: Map<string, OSS> = new Map();

  /**
   * 获取所有OSS配置
   * @returns OSS配置列表
   */
  getConfigs(): OssConfigWithMeta[] {
    const configs: OssConfigWithMeta[] = [];
    const allConfigs = getAllOssConfigs();

    for (const [id, config] of Object.entries(allConfigs)) {
      configs.push({
        id,
        name: `${id.charAt(0).toUpperCase()}${id.slice(1)} 配置`,
        ...config
      });
    }

    return configs;
  }

  /**
   * 获取OSS客户端
   * @param configName 配置名称
   * @returns OSS客户端实例
   */
  private getClient(configName: string = 'default'): OSS | null {
    // 检查缓存中是否已有客户端
    if (this.clients.has(configName)) {
      return this.clients.get(configName) as OSS;
    }

    // 获取配置并创建客户端
    const config = getOssConfig(configName);
    if (!config) {
      return null;
    }

    try {
      const client = new OSS({
        region: config.region,
        accessKeyId: config.accessKeyId,
        accessKeySecret: config.accessKeySecret,
        bucket: config.bucket,
        endpoint: config.endpoint
      });

      // 缓存客户端实例
      this.clients.set(configName, client);
      return client;
    } catch (error) {
      console.error(`Failed to create OSS client for ${configName}:`, error);
      return null;
    }
  }

  /**
   * 上传文件到OSS
   * @param params 上传参数
   * @returns 上传结果
   */
  async uploadFile(params: UploadFileParams): Promise<UploadResult> {
    // 验证并解析参数
    const validParams = UploadFileParamsSchema.parse(params);
    const { filePath, targetDir = '', fileName, configName = 'default' } = validParams;

    try {
      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        return UploadResultSchema.parse({
          success: false,
          error: `File not found: ${filePath}`,
          ossConfigName: configName
        });
      }

      // 获取OSS客户端
      const client = this.getClient(configName);
      if (!client) {
        return UploadResultSchema.parse({
          success: false,
          error: `OSS config not found for: ${configName}`,
          ossConfigName: configName
        });
      }

      // 确定文件名
      const actualFileName = fileName || path.basename(filePath);

      // 构建OSS路径，确保正斜杠格式
      let ossPath = actualFileName;
      if (targetDir) {
        // 规范化目标目录：移除头尾斜杠，然后加上结尾斜杠
        const normalizedDir = targetDir.replace(/^\/+|\/+$/g, '');
        ossPath = normalizedDir ? `${normalizedDir}/${actualFileName}` : actualFileName;
      }

      // 上传文件
      const result = await client.put(ossPath, filePath);

      return UploadResultSchema.parse({
        success: true,
        url: result.url,
        ossConfigName: configName
      });
    } catch (error) {
      return UploadResultSchema.parse({
        success: false,
        error: `Upload failed: ${(error as Error).message}`,
        ossConfigName: configName
      });
    }
  }

  /**
   * 重命名OSS文件（通过 copy + delete 实现）
   * @param oldKey 原文件路径
   * @param newKey 新文件路径
   * @param configName 配置名称
   * @returns 重命名结果
   */
  async renameFile(oldKey: string, newKey: string, configName: string = 'default'): Promise<{ success: boolean; error?: string }> {
    try {
      const client = this.getClient(configName);
      if (!client) {
        return { success: false, error: `OSS config not found for: ${configName}` };
      }

      // 规范化路径：移除开头的斜杠
      const normalizedOldKey = oldKey.replace(/^\/+/, '');
      const normalizedNewKey = newKey.replace(/^\/+/, '');

      // 检查源文件是否存在
      try {
        await client.head(normalizedOldKey);
      } catch (_e) {
        return { success: false, error: `源文件不存在: ${normalizedOldKey}` };
      }

      // 检查目标文件是否已存在
      try {
        await client.head(normalizedNewKey);
        // 如果到这里说明文件存在
        if (normalizedOldKey !== normalizedNewKey) {
          return { success: false, error: `目标文件已存在: ${normalizedNewKey}` };
        }
      } catch (_e) {
        // 文件不存在，可以继续
      }

      // Step 1: 复制文件到新位置
      await client.copy(normalizedNewKey, normalizedOldKey);

      // Step 2: 删除原文件
      await client.delete(normalizedOldKey);

      return { success: true };
    } catch (error) {
      return { success: false, error: `重命名失败: ${(error as Error).message}` };
    }
  }

  /**
   * 列出OSS目录下的文件
   * @param directory OSS目录路径
   * @param configName 配置名称
   * @param pattern 文件名过滤模式（可选）
   * @returns 文件列表
   */
  async listFiles(
    directory: string = '',
    configName: string = 'default',
    pattern?: string
  ): Promise<{ success: boolean; files?: Array<{ name: string; size: number; lastModified: Date }>; error?: string }> {
    try {
      const client = this.getClient(configName);
      if (!client) {
        return { success: false, error: `OSS config not found for: ${configName}` };
      }

      // 规范化目录路径
      const normalizedDir = directory.replace(/^\/+|\/+$/g, '');
      const prefix = normalizedDir ? `${normalizedDir}/` : '';

      // 列出文件
      const result = await client.list({
        prefix,
        delimiter: '/',
        'max-keys': 1000
      }, {});

      const files: Array<{ name: string; size: number; lastModified: Date }> = [];

      // 处理文件对象
      if (result.objects) {
        for (const obj of result.objects) {
          // 跳过目录本身（以 / 结尾的）
          if (obj.name.endsWith('/')) continue;

          // 提取文件名（去掉目录前缀）
          const fileName = obj.name.replace(prefix, '');
          if (!fileName) continue;

          // 如果有 pattern，进行简单的通配符匹配
          if (pattern) {
            const regex = new RegExp(
              '^' + pattern
                .replace(/\./g, '\\.')
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.') + '$',
              'i'
            );
            if (!regex.test(fileName)) continue;
          }

          files.push({
            name: fileName,
            size: obj.size,
            lastModified: new Date(obj.lastModified)
          });
        }
      }

      // 按文件名排序
      files.sort((a, b) => a.name.localeCompare(b.name));

      return { success: true, files };
    } catch (error) {
      return { success: false, error: `列出文件失败: ${(error as Error).message}` };
    }
  }

  /**
   * 批量重命名OSS文件
   * @param rules 重命名规则数组
   * @param directory OSS目录路径
   * @param configName 配置名称
   * @returns 批量重命名结果
   */
  async batchRenameFiles(
    rules: Array<{ oldName: string; newName: string }>,
    directory: string = '',
    configName: string = 'default'
  ): Promise<Array<{ oldName: string; newName: string; success: boolean; error?: string }>> {
    const results: Array<{ oldName: string; newName: string; success: boolean; error?: string }> = [];

    // 规范化目录路径
    const normalizedDir = directory.replace(/^\/+|\/+$/g, '');
    const dirPrefix = normalizedDir ? `${normalizedDir}/` : '';

    for (const rule of rules) {
      const oldKey = `${dirPrefix}${rule.oldName}`;
      const newKey = `${dirPrefix}${rule.newName}`;

      const result = await this.renameFile(oldKey, newKey, configName);
      results.push({
        oldName: rule.oldName,
        newName: rule.newName,
        success: result.success,
        error: result.error
      });
    }

    return results;
  }

  /**
   * 删除单个OSS文件
   * @param key 文件路径
   * @param configName 配置名称
   * @returns 删除结果
   */
  async deleteFile(key: string, configName: string = 'default'): Promise<{ success: boolean; error?: string }> {
    try {
      const client = this.getClient(configName);
      if (!client) {
        return { success: false, error: `OSS config not found for: ${configName}` };
      }

      // 规范化路径：移除开头的斜杠
      const normalizedKey = key.replace(/^\/+/, '');

      // 检查文件是否存在
      try {
        await client.head(normalizedKey);
      } catch (_e) {
        return { success: false, error: `文件不存在: ${normalizedKey}` };
      }

      // 删除文件
      await client.delete(normalizedKey);

      return { success: true };
    } catch (error) {
      return { success: false, error: `删除失败: ${(error as Error).message}` };
    }
  }

  /**
   * 批量删除OSS文件
   * @param fileNames 文件名数组
   * @param directory OSS目录路径
   * @param configName 配置名称
   * @returns 批量删除结果
   */
  async batchDeleteFiles(
    fileNames: string[],
    directory: string = '',
    configName: string = 'default'
  ): Promise<Array<{ fileName: string; success: boolean; error?: string }>> {
    const results: Array<{ fileName: string; success: boolean; error?: string }> = [];

    // 规范化目录路径
    const normalizedDir = directory.replace(/^\/+|\/+$/g, '');
    const dirPrefix = normalizedDir ? `${normalizedDir}/` : '';

    for (const fileName of fileNames) {
      const key = `${dirPrefix}${fileName}`;
      const result = await this.deleteFile(key, configName);
      results.push({
        fileName,
        success: result.success,
        error: result.error
      });
    }

    return results;
  }
}

// 导出单例实例
export const ossService = new OssService();
