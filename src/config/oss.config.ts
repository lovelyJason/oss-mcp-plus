import { config } from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { z } from "zod";

config();

// 阿里云 OSS 配置验证 Schema（保持向后兼容）
export const OssConfigSchema = z.object({
  region: z.string(),
  accessKeyId: z.string(),
  accessKeySecret: z.string(),
  bucket: z.string(),
  endpoint: z.string(),
});
export type OssConfig = z.infer<typeof OssConfigSchema>;

// Amazon S3 配置验证 Schema
export const S3ConfigSchema = z.object({
  region: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
  bucket: z.string(),
  endpoint: z.string().optional(),
});
export type S3Config = z.infer<typeof S3ConfigSchema>;

// 存储平台类型
export type StorageProvider = 'aliyun' | 's3';

// 带平台标识的统一存储配置
export type StorageConfig =
  | (OssConfig & { provider: 'aliyun' })
  | (S3Config & { provider: 's3' });

// 解析存储配置，根据 provider 字段自动选择 Schema
function parseStorageConfig(raw: Record<string, unknown>): StorageConfig {
  if (raw.provider === 's3') {
    return { ...S3ConfigSchema.parse(raw), provider: 's3' };
  }
  return { ...OssConfigSchema.parse(raw), provider: 'aliyun' };
}

// 服务器配置接口
export interface ServerConfig {
  port: number;
  ossConfig: Record<string, StorageConfig>;
  figmaToken?: string;
  configSources: {
    port: "cli" | "env" | "default";
    ossConfig: "cli" | "env" | "default";
    figmaToken: "cli" | "env" | "none";
  };
}

function maskSecret(secret: string): string {
  if (secret.length <= 4) return "****";
  return `${secret.substring(0, 4)}****${secret.slice(-4)}`;
}

export function getServerConfig(isStdioMode: boolean = false): ServerConfig {
  const argv = yargs(hideBin(process.argv))
    .options({
      "oss-config": {
        type: "string",
        description: "存储配置JSON字符串（支持阿里云 OSS 和 Amazon S3）",
      },
      port: {
        type: "number",
        description: "服务器运行端口",
        default: 3000,
      },
      "figma-token": {
        type: "string",
        description: "Figma Personal Access Token，用于导出多倍图",
      },
    })
    .help()
    .version("1.0.0")
    .parseSync();

  const serverConfig: ServerConfig = {
    port: 3000,
    ossConfig: {},
    configSources: {
      port: "default",
      ossConfig: "default",
      figmaToken: "none",
    },
  };

  if (argv.port) {
    serverConfig.port = argv.port;
    serverConfig.configSources.port = "cli";
  } else if (process.env.PORT) {
    serverConfig.port = parseInt(process.env.PORT, 10);
    serverConfig.configSources.port = "env";
  }

  // 处理存储配置 - CLI 参数优先
  if (argv["oss-config"]) {
    const allConfigs = JSON.parse(argv["oss-config"] as string);

    if (allConfigs.region && (allConfigs.accessKeyId || allConfigs.accessKeySecret || allConfigs.secretAccessKey)) {
      serverConfig.ossConfig.default = parseStorageConfig(allConfigs);
    } else {
      Object.entries(allConfigs).forEach(([name, cfg]) => {
        serverConfig.ossConfig[name.toLowerCase()] = parseStorageConfig(cfg as Record<string, unknown>);
      });
    }
    serverConfig.configSources.ossConfig = "cli";
  } else if (process.env.OSS_CONFIG_DEFAULT) {
    const ossConfig = JSON.parse(process.env.OSS_CONFIG_DEFAULT);
    serverConfig.ossConfig.default = parseStorageConfig(ossConfig);
    serverConfig.configSources.ossConfig = "env";
  }

  // 检查其他命名配置：OSS_CONFIG_* 和 S3_CONFIG_*
  Object.entries(process.env).forEach(([key, value]) => {
    if (key === "OSS_CONFIG_DEFAULT" || !value) return;

    let configName: string | null = null;
    let forceProvider: StorageProvider | null = null;

    if (key.startsWith("OSS_CONFIG_")) {
      configName = key.replace("OSS_CONFIG_", "").toLowerCase();
    } else if (key.startsWith("S3_CONFIG_")) {
      configName = key.replace("S3_CONFIG_", "").toLowerCase();
      forceProvider = 's3';
    }

    if (configName) {
      try {
        const parsed = JSON.parse(value);
        if (forceProvider) {
          parsed.provider = forceProvider;
        }
        serverConfig.ossConfig[configName] = parseStorageConfig(parsed);
      } catch (error) {
        console.error(`解析环境变量${key}失败:`, error);
      }
    }
  });

  // Figma Token
  if (argv["figma-token"]) {
    serverConfig.figmaToken = argv["figma-token"] as string;
    serverConfig.configSources.figmaToken = "cli";
  } else if (process.env.FIGMA_TOKEN) {
    serverConfig.figmaToken = process.env.FIGMA_TOKEN;
    serverConfig.configSources.figmaToken = "env";
  }

  if (Object.keys(serverConfig.ossConfig).length === 0) {
    console.warn("未找到有效的存储配置。服务器将启动，但上传功能将不可用。");
  }

  if (!isStdioMode) {
    console.log("\n配置信息:");
    console.log(`- 端口: ${serverConfig.port} (来源: ${serverConfig.configSources.port})`);

    if (Object.keys(serverConfig.ossConfig).length > 0) {
      console.log("- 存储配置:");
      Object.entries(serverConfig.ossConfig).forEach(([name, cfg]) => {
        const providerLabel = cfg.provider === 's3' ? 'Amazon S3' : '阿里云 OSS';
        console.log(`  - ${name} (${providerLabel}):`);
        console.log(`    Region: ${cfg.region}`);
        console.log(`    Bucket: ${cfg.bucket}`);
        if (cfg.provider === 'aliyun') {
          console.log(`    Endpoint: ${cfg.endpoint}`);
          console.log(`    AccessKeyId: ${maskSecret(cfg.accessKeyId)}`);
          console.log(`    AccessKeySecret: ${maskSecret(cfg.accessKeySecret)}`);
        } else {
          if (cfg.endpoint) console.log(`    Endpoint: ${cfg.endpoint}`);
          console.log(`    AccessKeyId: ${maskSecret(cfg.accessKeyId)}`);
          console.log(`    SecretAccessKey: ${maskSecret(cfg.secretAccessKey)}`);
        }
      });
    } else {
      console.log("- 存储配置: 未找到");
    }

    if (serverConfig.figmaToken) {
      console.log(`- Figma Token: ${maskSecret(serverConfig.figmaToken)} (来源: ${serverConfig.configSources.figmaToken})`);
    } else {
      console.log("- Figma Token: 未配置（Figma 导出功能不可用）");
    }

    console.log();
  }

  return serverConfig;
}

let cachedFigmaToken: string | undefined;

export function getFigmaToken(): string | undefined {
  if (cachedFigmaToken !== undefined) return cachedFigmaToken || undefined;
  const { figmaToken } = getServerConfig(true);
  cachedFigmaToken = figmaToken || '';
  return figmaToken;
}

// 获取所有存储配置（包含阿里云和 S3）
export function getAllStorageConfigs(): Record<string, StorageConfig> {
  const { ossConfig } = getServerConfig(true);
  return ossConfig;
}

// 获取所有阿里云 OSS 配置（向后兼容，仅返回 aliyun 类型）
export function getAllOssConfigs(): Record<string, OssConfig> {
  const all = getAllStorageConfigs();
  const result: Record<string, OssConfig> = {};
  for (const [name, cfg] of Object.entries(all)) {
    if (cfg.provider === 'aliyun') {
      const { provider: _, ...ossConfig } = cfg;
      result[name] = ossConfig;
    }
  }
  return result;
}

// 获取特定存储配置
export function getStorageConfig(name: string = 'default'): StorageConfig | null {
  const configs = getAllStorageConfigs();
  return configs[name.toLowerCase()] || null;
}

// 获取特定阿里云 OSS 配置（向后兼容）
export function getOssConfig(name: string = 'default'): OssConfig | null {
  const config = getStorageConfig(name);
  if (!config || config.provider !== 'aliyun') return null;
  const { provider: _, ...ossConfig } = config;
  return ossConfig;
}

// 获取所有可用配置名称
export function getAvailableConfigNames(): string[] {
  return Object.keys(getAllStorageConfigs());
}

export function getAvailableOssConfigNames(): string[] {
  return getAvailableConfigNames();
}
