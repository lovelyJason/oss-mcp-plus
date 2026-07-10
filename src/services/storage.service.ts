import { S3Config, StorageConfig, getStorageConfig, getAllStorageConfigs } from '../config/oss.config.js';
import { ossService } from './oss.service.js';
import { s3Service } from './s3.service.js';
import type { UploadFileParams, UploadResult } from './oss.service.js';

export interface StorageConfigWithMeta {
  id: string;
  name: string;
  provider: 'aliyun' | 's3';
  region: string;
  bucket: string;
}

export class StorageService {
  getConfigs(): StorageConfigWithMeta[] {
    const allConfigs = getAllStorageConfigs();
    return Object.entries(allConfigs).map(([id, config]) => ({
      id,
      name: `${id.charAt(0).toUpperCase()}${id.slice(1)} 配置`,
      provider: config.provider,
      region: config.region,
      bucket: config.bucket,
    }));
  }

  private resolveConfig(configName: string): { config: StorageConfig | null; error?: string } {
    const config = getStorageConfig(configName);
    if (!config) return { config: null, error: `存储配置未找到: ${configName}` };
    return { config };
  }

  async uploadFile(params: UploadFileParams): Promise<UploadResult> {
    const configName = params.configName || 'default';
    const { config, error } = this.resolveConfig(configName);
    if (!config) return { success: false, error, ossConfigName: configName };

    if (config.provider === 's3') {
      return s3Service.uploadFile(params, config as S3Config);
    }
    return ossService.uploadFile(params);
  }

  async listFiles(
    directory: string = '',
    configName: string = 'default',
    pattern?: string,
  ): Promise<{ success: boolean; files?: Array<{ name: string; size: number; lastModified: Date }>; error?: string }> {
    const { config, error } = this.resolveConfig(configName);
    if (!config) return { success: false, error };

    if (config.provider === 's3') {
      return s3Service.listFiles(directory, config as S3Config, pattern);
    }
    return ossService.listFiles(directory, configName, pattern);
  }

  async batchRenameFiles(
    rules: Array<{ oldName: string; newName: string }>,
    directory: string = '',
    configName: string = 'default',
  ): Promise<Array<{ oldName: string; newName: string; success: boolean; error?: string }>> {
    const { config, error } = this.resolveConfig(configName);
    if (!config) {
      return rules.map(r => ({ ...r, success: false, error }));
    }

    if (config.provider === 's3') {
      return s3Service.batchRenameFiles(rules, directory, config as S3Config);
    }
    return ossService.batchRenameFiles(rules, directory, configName);
  }

  async batchDeleteFiles(
    fileNames: string[],
    directory: string = '',
    configName: string = 'default',
  ): Promise<Array<{ fileName: string; success: boolean; error?: string }>> {
    const { config, error } = this.resolveConfig(configName);
    if (!config) {
      return fileNames.map(f => ({ fileName: f, success: false, error }));
    }

    if (config.provider === 's3') {
      return s3Service.batchDeleteFiles(fileNames, directory, config as S3Config);
    }
    return ossService.batchDeleteFiles(fileNames, directory, configName);
  }
}

export const storageService = new StorageService();
