import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ossService } from "./services/oss.service.js";
import { figmaService } from "./services/figma.service.js";
import { getFigmaToken } from "./config/oss.config.js";
import express, { Request, Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { IncomingMessage, ServerResponse } from "http";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

export const Logger = {
  log: (...args: any[]) => {
    console.log(...args);
  },
  error: (...args: any[]) => {
    console.error(...args);
  }
};

export class OssMcpServer {
  private readonly server: McpServer;
  private sseTransport: SSEServerTransport | null = null;

  constructor() {
    this.server = new McpServer(
      {
        name: "@yhy2001/oss-mcp",
        version: "1.0.0",
      },
      // 使用正确格式的capabilities配置
      {
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true },
          prompts: { listChanged: true },
          logging: {}
        }
      }
    );

    this.registerTools();
  }

  private registerTools(): void {
    // 获取可用的OSS配置
    const configs = ossService.getConfigs();
    const configNames = configs.map(config => config.id);

    // 工具：上传文件到OSS
    this.server.tool(
      "upload_to_oss",
      "将文件上传到阿里云OSS",
      {
        filePath: z.string().describe("要上传的本地文件路径"),
        targetDir: z.string().optional().describe("OSS中的目标目录路径（可选）"),
        fileName: z.string().optional().describe("上传后的文件名（可选，默认使用原文件名）"),
        configName: z.string().optional().describe(`OSS配置名称（可选，默认为'default'）。可用配置: ${configNames.join(', ') || '无'}`)
      },
      async ({ filePath, targetDir, fileName, configName }) => {
        try {
          Logger.log(`准备上传: ${filePath} 到 ${targetDir || '根目录'}`);

          if (!filePath) {
            throw new Error("文件路径是必需的");
          }

          // 检查文件是否存在
          if (!fs.existsSync(filePath)) {
            throw new Error(`文件不存在: ${filePath}`);
          }

          // 执行上传
          const result = await ossService.uploadFile({
            filePath,
            targetDir,
            fileName,
            configName
          });

          if (result.success) {
            Logger.log(`上传成功: ${result.url}`);
            return {
              content: [{
                type: "text",
                text: `文件上传成功!\n文件名: ${path.basename(filePath)}\n目标位置: ${targetDir || '根目录'}\nURL: ${result.url}\n配置名称: ${result.ossConfigName}`
              }]
            };
          } else {
            Logger.error(`上传失败: ${result.error}`);
            return {
              isError: true,
              content: [{
                type: "text",
                text: `上传失败: ${result.error}`
              }]
            };
          }
        } catch (error) {
          Logger.error(`上传过程中出错:`, error);
          return {
            isError: true,
            content: [{
              type: "text",
              text: `上传出错: ${error}`
            }]
          };
        }
      }
    );

    // 工具：列出可用的OSS配置
    this.server.tool(
      "list_oss_configs",
      "列出可用的阿里云OSS配置",
      {},
      async () => {
        try {
          const configs = ossService.getConfigs();
          const configNames = configs.map(config => config.id);

          if (configNames.length === 0) {
            return {
              content: [{
                type: "text",
                text: "未找到OSS配置。请检查环境变量设置。"
              }]
            };
          }

          return {
            content: [{
              type: "text",
              text: `可用的OSS配置:\n${configNames.map(name => `- ${name}`).join('\n')}`
            }]
          };
        } catch (error) {
          Logger.error(`获取OSS配置列表时出错:`, error);
          return {
            isError: true,
            content: [{
              type: "text",
              text: `获取配置列表失败: ${error}`
            }]
          };
        }
      }
    );

    // 工具：批量重命名OSS文件
    this.server.tool(
      "batch_rename_files",
      "批量重命名阿里云OSS文件。通过copy+delete实现。【重要】首次调用必须使用dryRun=true预览，展示给用户确认后，用户同意才能用dryRun=false执行实际重命名。禁止跳过预览直接执行！",
      {
        directory: z.string().describe("OSS中的目录路径（如 'images/icons'，根目录传空字符串 ''）"),
        renameRules: z.array(z.object({
          oldName: z.string().describe("原文件名"),
          newName: z.string().describe("新文件名")
        })).describe("重命名规则数组，每项包含原文件名和新文件名"),
        configName: z.string().optional().describe(`OSS配置名称（默认为'default'）。可用配置: ${configNames.join(', ') || '无'}`),
        dryRun: z.boolean().optional().describe("是否为预览模式（默认false）。为true时只返回将要执行的操作，不实际重命名")
      },
      async ({ directory, renameRules, configName = 'default', dryRun = false }) => {
        try {
          Logger.log(`OSS批量重命名: 目录=${directory}, 规则数=${renameRules.length}, 配置=${configName}, 预览模式=${dryRun}`);

          let results: { oldName: string; newName: string; success: boolean; error?: string }[];

          if (dryRun) {
            // 预览模式：只返回将要执行的操作
            results = renameRules.map(rule => ({
              oldName: rule.oldName,
              newName: rule.newName,
              success: true
            }));
          } else {
            // 实际执行OSS重命名
            results = await ossService.batchRenameFiles(renameRules, directory, configName);
          }

          const successCount = results.filter(r => r.success).length;
          const failCount = results.filter(r => !r.success).length;

          let resultText = dryRun ? `【预览模式】以下是将要执行的OSS文件重命名操作:\n\n` : `OSS文件批量重命名完成:\n\n`;
          resultText += `配置: ${configName}\n`;
          resultText += `目录: ${directory || '根目录'}\n`;
          resultText += `成功: ${successCount} 个, 失败: ${failCount} 个\n\n`;

          if (results.length > 0) {
            resultText += '详细结果:\n';
            for (const r of results) {
              if (r.success) {
                resultText += `✅ ${r.oldName} → ${r.newName}\n`;
              } else {
                resultText += `❌ ${r.oldName} → ${r.newName} (${r.error})\n`;
              }
            }
          }

          return {
            content: [{
              type: "text",
              text: resultText
            }]
          };
        } catch (error) {
          Logger.error(`OSS批量重命名出错:`, error);
          return {
            isError: true,
            content: [{
              type: "text",
              text: `OSS批量重命名失败: ${error}`
            }]
          };
        }
      }
    );

    // 工具：列出本地目录文件
    this.server.tool(
      "list_directory_files",
      "列出本地文件系统中指定目录下的所有文件。注意：此工具仅支持本地路径，如果要列出 OSS 中的文件，请使用 list_oss_files 工具。",
      {
        directory: z.string().describe("要查看的目录路径"),
        pattern: z.string().optional().describe("文件名过滤模式（可选），如 '*.png' 或 'icon_*'")
      },
      async ({ directory, pattern }) => {
        try {
          Logger.log(`列出目录文件: ${directory}, 过滤: ${pattern || '无'}`);

          // 检查目录是否存在
          if (!fs.existsSync(directory)) {
            throw new Error(`目录不存在: ${directory}`);
          }

          const stat = fs.statSync(directory);
          if (!stat.isDirectory()) {
            throw new Error(`路径不是目录: ${directory}`);
          }

          let files = fs.readdirSync(directory);

          // 过滤掉隐藏文件
          files = files.filter(f => !f.startsWith('.'));

          // 如果有 pattern，进行简单的通配符匹配
          if (pattern) {
            const regex = new RegExp(
              '^' + pattern
                .replace(/\./g, '\\.')
                .replace(/\*/g, '.*')
                .replace(/\?/g, '.') + '$',
              'i'
            );
            files = files.filter(f => regex.test(f));
          }

          // 获取文件信息
          const fileInfos = files.map(f => {
            const filePath = path.join(directory, f);
            const fileStat = fs.statSync(filePath);
            return {
              name: f,
              isDirectory: fileStat.isDirectory(),
              size: fileStat.size
            };
          });

          // 排序：目录在前，文件在后，按名称排序
          fileInfos.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) {
              return a.isDirectory ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
          });

          if (fileInfos.length === 0) {
            return {
              content: [{
                type: "text",
                text: `目录 ${directory} 下没有找到匹配的文件${pattern ? ` (过滤: ${pattern})` : ''}`
              }]
            };
          }

          let resultText = `目录: ${directory}\n`;
          if (pattern) {
            resultText += `过滤: ${pattern}\n`;
          }
          resultText += `共 ${fileInfos.length} 个项目:\n\n`;

          for (const f of fileInfos) {
            if (f.isDirectory) {
              resultText += `📁 ${f.name}/\n`;
            } else {
              const sizeStr = f.size < 1024
                ? `${f.size}B`
                : f.size < 1024 * 1024
                  ? `${(f.size / 1024).toFixed(1)}KB`
                  : `${(f.size / 1024 / 1024).toFixed(1)}MB`;
              resultText += `📄 ${f.name} (${sizeStr})\n`;
            }
          }

          return {
            content: [{
              type: "text",
              text: resultText
            }]
          };
        } catch (error) {
          Logger.error(`列出目录文件出错:`, error);
          return {
            isError: true,
            content: [{
              type: "text",
              text: `列出目录失败: ${error}`
            }]
          };
        }
      }
    );

    // 工具：列出OSS目录文件
    this.server.tool(
      "list_oss_files",
      "列出阿里云OSS指定目录下的所有文件。用于查看 OSS 中的文件以便进行重命名或其他操作。注意：如果要列出本地文件，请使用 list_directory_files 工具。",
      {
        directory: z.string().describe("OSS中的目录路径（如 'images/icons'，根目录传空字符串 ''）"),
        pattern: z.string().optional().describe("文件名过滤模式（可选），如 '*.png' 或 'icon_*'"),
        configName: z.string().optional().describe(`OSS配置名称（默认为'default'）。可用配置: ${configNames.join(', ') || '无'}`)
      },
      async ({ directory, pattern, configName = 'default' }) => {
        try {
          Logger.log(`列出OSS目录文件: ${directory || '根目录'}, 过滤: ${pattern || '无'}, 配置: ${configName}`);

          const result = await ossService.listFiles(directory, configName, pattern);

          if (!result.success) {
            return {
              isError: true,
              content: [{
                type: "text",
                text: `列出OSS文件失败: ${result.error}`
              }]
            };
          }

          const files = result.files || [];

          if (files.length === 0) {
            return {
              content: [{
                type: "text",
                text: `OSS目录 ${directory || '根目录'} 下没有找到匹配的文件${pattern ? ` (过滤: ${pattern})` : ''}\n配置: ${configName}`
              }]
            };
          }

          const sizeStr = (size: number) => size < 1024
            ? `${size}B`
            : size < 1024 * 1024
              ? `${(size / 1024).toFixed(1)}KB`
              : `${(size / 1024 / 1024).toFixed(1)}MB`;

          let resultText = `OSS目录: ${directory || '根目录'}\n`;
          resultText += `配置: ${configName}\n`;
          if (pattern) {
            resultText += `过滤: ${pattern}\n`;
          }
          resultText += `共 ${files.length} 个文件:\n\n`;

          for (const f of files) {
            resultText += `📄 ${f.name} (${sizeStr(f.size)})\n`;
          }

          return {
            content: [{
              type: "text",
              text: resultText
            }]
          };
        } catch (error) {
          Logger.error(`列出OSS目录文件出错:`, error);
          return {
            isError: true,
            content: [{
              type: "text",
              text: `列出OSS目录失败: ${error}`
            }]
          };
        }
      }
    );

    // 工具：删除OSS文件
    // 检查环境变量是否允许删除操作
    const allowDeleteOperation = process.env.ALLOW_DELETE_OPERATION === 'true';

    this.server.tool(
      "delete_oss_files",
      `删除阿里云OSS中的文件。支持单个删除、批量删除和通配符匹配。

【⚠️ 安全限制】此工具需要配置环境变量 ALLOW_DELETE_OPERATION=true 才能使用。
当前状态: ${allowDeleteOperation ? '✅ 已启用' : '❌ 未启用（需要在 MCP 配置中添加 "env": { "ALLOW_DELETE_OPERATION": "true" }）'}

【重要】首次调用必须使用 dryRun=true 预览，展示给用户确认后，用户同意才能用 dryRun=false 执行实际删除。禁止跳过预览直接执行！`,
      {
        directory: z.string().describe("OSS中的目录路径（如 'images/icons'，根目录传空字符串 ''）"),
        fileNames: z.array(z.string()).optional().describe("要删除的文件名数组（与 pattern 二选一）"),
        pattern: z.string().optional().describe("文件名通配符模式（如 '*.tmp' 或 'test_*'），与 fileNames 二选一"),
        configName: z.string().optional().describe(`OSS配置名称（默认为'default'）。可用配置: ${configNames.join(', ') || '无'}`),
        dryRun: z.boolean().optional().describe("是否为预览模式（默认false）。为true时只返回将要删除的文件列表，不实际删除")
      },
      async ({ directory, fileNames, pattern, configName = 'default', dryRun = false }) => {
        try {
          // 检查是否允许删除操作
          if (!allowDeleteOperation) {
            return {
              isError: true,
              content: [{
                type: "text",
                text: `❌ 删除操作被禁止！

要启用删除功能，请在 MCP 配置中添加环境变量：

{
  "mcpServers": {
    "oss-mcp-plus": {
      "command": "npx",
      "args": ["oss-mcp-plus", ...],
      "env": {
        "ALLOW_DELETE_OPERATION": "true"
      }
    }
  }
}

这是一个安全措施，防止误删除文件。`
              }]
            };
          }

          Logger.log(`删除OSS文件: 目录=${directory}, 配置=${configName}, 预览模式=${dryRun}`);

          // 必须提供 fileNames 或 pattern 之一
          if (!fileNames && !pattern) {
            return {
              isError: true,
              content: [{
                type: "text",
                text: "请提供 fileNames（文件名数组）或 pattern（通配符模式）之一"
              }]
            };
          }

          let filesToDelete: string[] = [];

          if (fileNames && fileNames.length > 0) {
            // 直接使用提供的文件名
            filesToDelete = fileNames;
          } else if (pattern) {
            // 使用通配符匹配文件
            const listResult = await ossService.listFiles(directory, configName, pattern);
            if (!listResult.success) {
              return {
                isError: true,
                content: [{
                  type: "text",
                  text: `列出文件失败: ${listResult.error}`
                }]
              };
            }
            filesToDelete = (listResult.files || []).map(f => f.name);
          }

          if (filesToDelete.length === 0) {
            return {
              content: [{
                type: "text",
                text: `没有找到匹配的文件${pattern ? ` (模式: ${pattern})` : ''}\n目录: ${directory || '根目录'}\n配置: ${configName}`
              }]
            };
          }

          if (dryRun) {
            // 预览模式：只返回将要删除的文件列表
            let resultText = `【预览模式】以下是将要删除的文件:\n\n`;
            resultText += `配置: ${configName}\n`;
            resultText += `目录: ${directory || '根目录'}\n`;
            if (pattern) {
              resultText += `匹配模式: ${pattern}\n`;
            }
            resultText += `文件数量: ${filesToDelete.length}\n\n`;
            resultText += `文件列表:\n`;
            for (const fileName of filesToDelete) {
              resultText += `🗑️ ${fileName}\n`;
            }
            resultText += `\n⚠️ 确认要删除这些文件后，请使用 dryRun=false 执行实际删除。`;

            return {
              content: [{
                type: "text",
                text: resultText
              }]
            };
          }

          // 实际执行删除
          const results = await ossService.batchDeleteFiles(filesToDelete, directory, configName);

          const successCount = results.filter(r => r.success).length;
          const failCount = results.filter(r => !r.success).length;

          let resultText = `OSS文件删除完成:\n\n`;
          resultText += `配置: ${configName}\n`;
          resultText += `目录: ${directory || '根目录'}\n`;
          resultText += `成功: ${successCount} 个, 失败: ${failCount} 个\n\n`;

          if (results.length > 0) {
            resultText += '详细结果:\n';
            for (const r of results) {
              if (r.success) {
                resultText += `✅ ${r.fileName} 已删除\n`;
              } else {
                resultText += `❌ ${r.fileName} (${r.error})\n`;
              }
            }
          }

          return {
            content: [{
              type: "text",
              text: resultText
            }]
          };
        } catch (error) {
          Logger.error(`删除OSS文件出错:`, error);
          return {
            isError: true,
            content: [{
              type: "text",
              text: `删除OSS文件失败: ${error}`
            }]
          };
        }
      }
    );

    // 工具：下载文件
    this.server.tool(
      "download_file",
      "从 URL 下载文件到本地目录。支持 HTTP/HTTPS 链接，可自定义保存文件名。",
      {
        url: z.string().describe("要下载的文件 URL"),
        targetDir: z.string().describe("保存文件的本地目录路径"),
        fileName: z.string().optional().describe("保存的文件名（可选，默认从 URL 提取）")
      },
      async ({ url, targetDir, fileName }) => {
        try {
          Logger.log(`下载文件: ${url} 到 ${targetDir}`);

          // 检查目录是否存在，不存在则创建
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
            Logger.log(`创建目录: ${targetDir}`);
          }

          const stat = fs.statSync(targetDir);
          if (!stat.isDirectory()) {
            throw new Error(`路径不是目录: ${targetDir}`);
          }

          // 从 URL 提取文件名
          let finalFileName = fileName;
          if (!finalFileName) {
            const urlObj = new URL(url);
            finalFileName = path.basename(urlObj.pathname);
            // 如果 URL 没有文件名，生成一个
            if (!finalFileName || finalFileName === '/') {
              finalFileName = `download_${Date.now()}`;
            }
          }

          const filePath = path.join(targetDir, finalFileName);

          // 检查文件是否已存在
          if (fs.existsSync(filePath)) {
            throw new Error(`文件已存在: ${filePath}`);
          }

          // 下载文件
          await new Promise<void>((resolve, reject) => {
            const urlObj = new URL(url);
            const protocol = urlObj.protocol === 'https:' ? https : http;

            const request = protocol.get(url, (response) => {
              // 处理重定向
              if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                  Logger.log(`重定向到: ${redirectUrl}`);
                  const redirectProtocol = redirectUrl.startsWith('https:') ? https : http;
                  redirectProtocol.get(redirectUrl, (redirectResponse) => {
                    if (redirectResponse.statusCode !== 200) {
                      reject(new Error(`下载失败，HTTP 状态码: ${redirectResponse.statusCode}`));
                      return;
                    }
                    const fileStream = fs.createWriteStream(filePath);
                    redirectResponse.pipe(fileStream);
                    fileStream.on('finish', () => {
                      fileStream.close();
                      resolve();
                    });
                    fileStream.on('error', (err) => {
                      fs.unlink(filePath, () => {});
                      reject(err);
                    });
                  }).on('error', reject);
                  return;
                }
              }

              if (response.statusCode !== 200) {
                reject(new Error(`下载失败，HTTP 状态码: ${response.statusCode}`));
                return;
              }

              const fileStream = fs.createWriteStream(filePath);
              response.pipe(fileStream);

              fileStream.on('finish', () => {
                fileStream.close();
                resolve();
              });

              fileStream.on('error', (err) => {
                fs.unlink(filePath, () => {});
                reject(err);
              });
            });

            request.on('error', (err) => {
              fs.unlink(filePath, () => {});
              reject(err);
            });

            request.setTimeout(60000, () => {
              request.destroy();
              fs.unlink(filePath, () => {});
              reject(new Error('下载超时（60秒）'));
            });
          });

          // 获取文件大小
          const downloadedStat = fs.statSync(filePath);
          const sizeStr = downloadedStat.size < 1024
            ? `${downloadedStat.size}B`
            : downloadedStat.size < 1024 * 1024
              ? `${(downloadedStat.size / 1024).toFixed(1)}KB`
              : `${(downloadedStat.size / 1024 / 1024).toFixed(1)}MB`;

          return {
            content: [{
              type: "text",
              text: `文件下载成功!\n源URL: ${url}\n保存路径: ${filePath}\n文件大小: ${sizeStr}`
            }]
          };
        } catch (error) {
          Logger.error(`下载文件出错:`, error);
          return {
            isError: true,
            content: [{
              type: "text",
              text: `下载失败: ${error}`
            }]
          };
        }
      }
    );

    // 工具：检查压缩图片的前置条件
    this.server.tool(
      "check_compress_prerequisites",
      `检查图片压缩的前置条件并返回用户询问模板。

【⚠️ 极其重要 - AI 必须严格按以下顺序执行】

第 1 步：检查 Playwright MCP（必须在调用本工具之前完成！）
- 调用 browser_snapshot 工具
- 如果成功：继续执行
- 如果失败/报错：立即停止，告知用户需要启用 Playwright MCP

第 2 步：如果图片在 OSS 上（必须在调用本工具之前完成！）
- 先使用 list_oss_files 列出文件
- ⚠️ 重要：下载到【项目目录】下的 .tmp-compress/ 文件夹，不能用 /tmp/！
  （Playwright MCP 只能访问项目目录内的文件）
- 使用 download_file 将图片下载到项目目录下
- 只有下载到本地后才能调用本工具

第 3 步：调用本工具
- 传入本地图片路径数组
- 获取用户询问模板

第 4 步：询问用户
- 使用 AskUserQuestion 询问压缩引擎、输出格式等

第 5 步：执行压缩
- 调用 compress_images 工具`,
      {
        images: z.array(z.string()).describe("要压缩的【本地】图片路径数组。如果图片在 OSS 上，必须先用 download_file 下载到本地！")
      },
      async ({ images }) => {
        try {
          // 验证图片文件
          const validImages: { path: string; name: string; ext: string; size: number }[] = [];
          const errors: string[] = [];

          for (const imgPath of images) {
            if (!fs.existsSync(imgPath)) {
              errors.push(`文件不存在: ${imgPath}`);
              continue;
            }
            const stat = fs.statSync(imgPath);
            if (stat.size > 5 * 1024 * 1024) {
              errors.push(`文件超过 5MB 限制: ${imgPath}`);
              continue;
            }
            const ext = path.extname(imgPath).toLowerCase().slice(1);
            if (!['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff'].includes(ext)) {
              errors.push(`不支持的格式: ${imgPath}`);
              continue;
            }
            validImages.push({
              path: imgPath,
              name: path.basename(imgPath, path.extname(imgPath)),
              ext: ext === 'jpg' ? 'jpeg' : ext,
              size: stat.size
            });
          }

          if (validImages.length === 0) {
            return {
              isError: true,
              content: [{
                type: "text",
                text: `没有有效的图片可处理:\n${errors.join('\n')}`
              }]
            };
          }

          // 构建需要询问用户的问题
          const questions = {
            playwrightCheck: {
              instruction: "请先使用 browser_snapshot 工具测试 Playwright MCP 是否可用。如果报错说明未配置。"
            },
            engineQuestion: {
              question: "请选择压缩引擎",
              header: "压缩引擎",
              options: [
                { label: "TinyPNG (推荐)", description: "支持 PNG/JPEG/WebP 输出，压缩质量高，每批最多 3 个文件" },
                { label: "AnyWebP", description: "固定输出 WebP 格式，每批最多 20 个文件" }
              ]
            },
            formatQuestion: {
              question: "是否需要转换输出格式？",
              header: "输出格式",
              options: [
                { label: "保持原格式", description: "不转换格式，仅压缩" },
                { label: "转换为 WebP", description: "转换为 WebP 格式，体积更小" },
                { label: "转换为 JPEG", description: "转换为 JPEG 格式（仅 TinyPNG）" },
                { label: "转换为 PNG", description: "转换为 PNG 格式（仅 TinyPNG）" }
              ]
            },
            deleteOriginalQuestion: {
              question: "转换格式后是否删除原文件？",
              header: "删除原文件",
              options: [
                { label: "保留原文件", description: "在 OSS 上保留原格式文件" },
                { label: "删除原文件", description: "转换后删除 OSS 上的原格式文件" }
              ],
              condition: "仅当选择了转换格式时才需要询问"
            }
          };

          const sizeStr = (size: number) => size < 1024
            ? `${size}B`
            : size < 1024 * 1024
              ? `${(size / 1024).toFixed(1)}KB`
              : `${(size / 1024 / 1024).toFixed(1)}MB`;

          let resultText = `## 图片压缩前置检查\n\n`;
          resultText += `### ✅ 有效图片 (${validImages.length} 个)\n`;
          for (const img of validImages) {
            resultText += `- ${path.basename(img.path)} (${sizeStr(img.size)})\n`;
          }

          if (errors.length > 0) {
            resultText += `\n### ⚠️ 跳过的文件\n`;
            for (const err of errors) {
              resultText += `- ${err}\n`;
            }
          }

          resultText += `\n### 📋 AI 执行步骤\n\n`;
          resultText += `1. **检查 Playwright**: 调用 \`browser_snapshot\` 测试是否可用\n`;
          resultText += `   - 如果报错，提示用户需要配置 Playwright MCP\n`;
          resultText += `2. **询问用户**: 使用 AskUserQuestion 一次性询问以下问题:\n`;
          resultText += `   - 选择压缩引擎 (TinyPNG / AnyWebP)\n`;
          resultText += `   - 是否转换格式 (保持原格式 / WebP / JPEG / PNG)\n`;
          resultText += `   - 如果转格式，是否删除原文件\n`;
          resultText += `3. **执行压缩**: 根据用户选择调用 \`compress_images\`\n`;

          return {
            content: [
              {
                type: "text",
                text: resultText
              },
              {
                type: "text",
                text: `\n---\n**询问模板 (JSON)**:\n\`\`\`json\n${JSON.stringify(questions, null, 2)}\n\`\`\``
              }
            ]
          };
        } catch (error) {
          Logger.error(`检查前置条件出错:`, error);
          return {
            isError: true,
            content: [{
              type: "text",
              text: `检查失败: ${error}`
            }]
          };
        }
      }
    );

    // 工具：压缩图片（生成压缩指令，由 AI 调用 Playwright MCP 执行）
    this.server.tool(
      "compress_images",
      `压缩图片工具。生成 Playwright 自动化压缩指令。

【⚠️ 禁止直接调用！必须先完成以下步骤】

✅ 第 1 步：验证 Playwright MCP 可用
   → 调用 browser_snapshot，如果报错则停止并提示用户启用

✅ 第 2 步：确保图片在项目目录内
   → OSS 图片必须先用 download_file 下载到【项目目录】下的 .tmp-compress/ 文件夹
   → ⚠️ 不能用 /tmp/，Playwright 无法访问项目外的路径！

✅ 第 3 步：调用 check_compress_prerequisites
   → 验证文件并获取询问模板

✅ 第 4 步：询问用户偏好
   → 使用 AskUserQuestion 询问引擎、格式、是否删除原文件

✅ 第 5 步：调用本工具
   → 传入用户选择的参数

【后续流程】
1. 按返回的指令使用 Playwright MCP 执行网页自动化
2. 下载压缩结果
3. 使用 upload_to_oss 上传回 OSS`,
      {
        images: z.array(z.string()).describe("要压缩的本地图片路径数组"),
        engine: z.enum(['tinypng', 'anywebp']).describe("压缩引擎 (必须先询问用户选择)"),
        outputFormat: z.enum(['png', 'jpeg', 'webp']).optional().describe("输出格式 (必须先询问用户选择，仅 tinypng 支持多格式)"),
        deleteOriginal: z.boolean().optional().describe("转格式时是否删除原文件 (必须先询问用户选择)"),
        ossDirectory: z.string().optional().describe("OSS 目标目录 (用于上传压缩后的文件)"),
        configName: z.string().optional().describe(`OSS配置名称（默认为'default'）。可用配置: ${configNames.join(', ') || '无'}`)
      },
      async ({ images, engine, outputFormat, deleteOriginal = false, ossDirectory, configName = 'default' }) => {
        try {
          Logger.log(`压缩图片: 引擎=${engine}, 格式=${outputFormat || '原格式'}, 图片数=${images.length}`);

          // 验证图片文件存在
          const validImages: { path: string; name: string; ext: string; size: number }[] = [];
          const errors: string[] = [];

          for (const imgPath of images) {
            if (!fs.existsSync(imgPath)) {
              errors.push(`文件不存在: ${imgPath}`);
              continue;
            }
            const stat = fs.statSync(imgPath);
            if (stat.size > 5 * 1024 * 1024) {
              errors.push(`文件超过 5MB 限制: ${imgPath}`);
              continue;
            }
            const ext = path.extname(imgPath).toLowerCase().slice(1);
            if (!['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff'].includes(ext)) {
              errors.push(`不支持的格式: ${imgPath}`);
              continue;
            }
            validImages.push({
              path: imgPath,
              name: path.basename(imgPath, path.extname(imgPath)),
              ext: ext === 'jpg' ? 'jpeg' : ext,
              size: stat.size
            });
          }

          if (validImages.length === 0) {
            return {
              isError: true,
              content: [{
                type: "text",
                text: `没有有效的图片可处理:\n${errors.join('\n')}`
              }]
            };
          }

          // 生成压缩指令
          const actualOutputFormat = engine === 'anywebp' ? 'webp' : (outputFormat || null);
          const batchSize = engine === 'tinypng' ? 3 : 20;
          const batches: typeof validImages[] = [];

          for (let i = 0; i < validImages.length; i += batchSize) {
            batches.push(validImages.slice(i, i + batchSize));
          }

          // 构建指令文本
          let instructions = `## 图片压缩指令\n\n`;
          instructions += `**引擎**: ${engine === 'tinypng' ? 'TinyPNG (https://tinypng.com/)' : 'AnyWebP (https://anywebp.com/convert-to-webp)'}\n`;
          instructions += `**输出格式**: ${actualOutputFormat || '保持原格式'}\n`;
          instructions += `**总图片数**: ${validImages.length}\n`;
          instructions += `**批次数**: ${batches.length} (每批最多 ${batchSize} 个)\n\n`;

          if (errors.length > 0) {
            instructions += `### ⚠️ 跳过的文件\n`;
            for (const err of errors) {
              instructions += `- ${err}\n`;
            }
            instructions += `\n`;
          }

          instructions += `### 📋 执行步骤\n\n`;
          instructions += `**前置检查**: 请确认 Playwright MCP 已配置并可用\n\n`;

          if (engine === 'tinypng') {
            instructions += this.generateTinyPngInstructions(batches, actualOutputFormat);
          } else {
            instructions += this.generateAnyWebPInstructions(batches);
          }

          // 添加后续处理指令
          instructions += `\n### 📤 后续处理\n\n`;
          instructions += `压缩完成后，请执行以下操作:\n\n`;

          for (const img of validImages) {
            const newExt = actualOutputFormat || img.ext;
            const isFormatChange = newExt !== img.ext;
            const newFileName = `${img.name}.${newExt}`;
            const downloadPath = path.join(path.dirname(img.path), `${img.name}-compressed.${newExt}`);

            instructions += `**${path.basename(img.path)}**:\n`;
            instructions += `1. 下载压缩结果到: \`${downloadPath}\`\n`;

            if (ossDirectory) {
              if (isFormatChange) {
                instructions += `2. 上传到 OSS: \`upload_to_oss("${downloadPath}", "${ossDirectory}", "${newFileName}", "${configName}")\`\n`;
                if (deleteOriginal) {
                  instructions += `3. 删除原文件: 在 OSS 上删除 \`${ossDirectory}/${path.basename(img.path)}\`\n`;
                }
              } else {
                instructions += `2. 覆盖上传到 OSS: \`upload_to_oss("${downloadPath}", "${ossDirectory}", "${path.basename(img.path)}", "${configName}")\`\n`;
              }
            }
            instructions += `\n`;
          }

          // 返回信息
          const resultInfo = {
            engine,
            outputFormat: actualOutputFormat,
            deleteOriginal: actualOutputFormat ? deleteOriginal : false,
            ossDirectory,
            configName,
            totalImages: validImages.length,
            batches: batches.length,
            batchSize,
            images: validImages.map(img => ({
              originalPath: img.path,
              originalName: path.basename(img.path),
              originalExt: img.ext,
              originalSize: img.size,
              newExt: actualOutputFormat || img.ext,
              isFormatChange: (actualOutputFormat || img.ext) !== img.ext
            }))
          };

          return {
            content: [
              {
                type: "text",
                text: instructions
              },
              {
                type: "text",
                text: `\n---\n**压缩任务数据 (JSON)**:\n\`\`\`json\n${JSON.stringify(resultInfo, null, 2)}\n\`\`\``
              }
            ]
          };
        } catch (error) {
          Logger.error(`生成压缩指令出错:`, error);
          return {
            isError: true,
            content: [{
              type: "text",
              text: `生成压缩指令失败: ${error}`
            }]
          };
        }
      }
    );

    // 工具：导出 Figma 多倍图
    const figmaTokenConfigured = !!getFigmaToken();

    this.server.tool(
      "export_figma_images",
      `从 Figma 导出多倍图（支持 1x/2x/3x/4x）。使用 Figma REST API 直接导出指定倍率的图片，弥补 Figma MCP 不支持多倍图导出的不足。

支持两种模式：
- 导出到本地目录
- 导出后直接上传到阿里云 OSS

当前状态: ${figmaTokenConfigured ? '✅ Figma Token 已配置' : '❌ 未配置 Figma Token（需要 --figma-token 参数或 FIGMA_TOKEN 环境变量）'}

【使用说明】
- fileKey 和 nodeId 可从 Figma URL 中提取：
  figma.com/design/:fileKey/:fileName?node-id=:nodeId
  注意：URL 中的 node-id 用 "-" 分隔，需要替换为 ":"（如 "14-123" → "14:123"）
- scales 支持 1/2/3/4，可同时导出多个倍率
- 导出到本地时文件命名格式：{prefix}.png, {prefix}@2x.png, {prefix}@3x.png
- 如果同时指定了 ossTargetDir，导出后会自动上传到 OSS`,
      {
        fileKey: z.string().describe("Figma 文件 Key（从 URL 中提取）"),
        nodeId: z.string().describe("Figma 节点 ID（格式如 '14:123'，URL 中的 '-' 需替换为 ':'）"),
        scales: z.array(z.number().min(0.01).max(4)).default([1, 2]).describe("导出倍率数组，默认 [1, 2]。常用值: [1, 2], [1, 2, 3]"),
        format: z.enum(['png', 'jpg', 'svg', 'pdf']).default('png').describe("导出格式，默认 png"),
        localTargetDir: z.string().describe("本地保存目录路径"),
        fileNamePrefix: z.string().optional().describe("文件名前缀（可选，默认使用 nodeId 生成）"),
        ossTargetDir: z.string().optional().describe("OSS 目标目录（可选，填写则导出后自动上传到 OSS）"),
        configName: z.string().optional().describe(`OSS配置名称（默认为'default'，仅上传到 OSS 时需要）。可用配置: ${configNames.join(', ') || '无'}`)
      },
      async ({ fileKey, nodeId, scales, format, localTargetDir, fileNamePrefix, ossTargetDir, configName = 'default' }) => {
        try {
          if (!figmaTokenConfigured) {
            return {
              isError: true,
              content: [{
                type: "text",
                text: `❌ 未配置 Figma Token！

请在 MCP 配置中添加 Figma Token：

方式一：CLI 参数
{
  "command": "npx",
  "args": ["oss-mcp-plus", "--figma-token=figd_xxxxx", "--oss-config='{...}'", "--stdio"]
}

方式二：环境变量
{
  "command": "npx",
  "args": ["oss-mcp-plus", "--oss-config='{...}'", "--stdio"],
  "env": {
    "FIGMA_TOKEN": "figd_xxxxx"
  }
}

获取 Token: Figma → Settings → Personal Access Tokens`
              }]
            };
          }

          Logger.log(`导出 Figma 多倍图: fileKey=${fileKey}, nodeId=${nodeId}, scales=${scales.join(',')}, format=${format}`);

          // Step 1: 导出到本地
          const results = await figmaService.exportToLocal(
            { fileKey, nodeId, scales, format },
            localTargetDir,
            fileNamePrefix,
          );

          // Step 2: 如果指定了 OSS 目录，上传到 OSS
          if (ossTargetDir) {
            for (const result of results) {
              if (!result.localPath) continue;
              const uploadResult = await ossService.uploadFile({
                filePath: result.localPath,
                targetDir: ossTargetDir,
                fileName: result.fileName,
                configName,
              });
              if (uploadResult.success) {
                result.ossUrl = uploadResult.url;
              } else {
                Logger.error(`上传 ${result.fileName} 到 OSS 失败: ${uploadResult.error}`);
              }
            }
          }

          // 构建结果文本
          const sizeStr = (size: number) => size < 1024
            ? `${size}B`
            : size < 1024 * 1024
              ? `${(size / 1024).toFixed(1)}KB`
              : `${(size / 1024 / 1024).toFixed(1)}MB`;

          let resultText = `## Figma 多倍图导出完成\n\n`;
          resultText += `**文件 Key**: ${fileKey}\n`;
          resultText += `**节点 ID**: ${nodeId}\n`;
          resultText += `**格式**: ${format}\n`;
          resultText += `**倍率**: ${scales.join('x, ')}x\n\n`;

          resultText += `### 导出结果\n\n`;
          for (const r of results) {
            const localSize = r.localPath && fs.existsSync(r.localPath)
              ? sizeStr(fs.statSync(r.localPath).size)
              : '未知';

            resultText += `**${r.fileName}** (${r.scale}x, ${localSize})\n`;
            resultText += `- 本地路径: \`${r.localPath}\`\n`;
            if (r.ossUrl) {
              resultText += `- OSS URL: ${r.ossUrl}\n`;
            }
            resultText += `\n`;
          }

          if (ossTargetDir) {
            const uploadedCount = results.filter(r => r.ossUrl).length;
            resultText += `\n### OSS 上传\n`;
            resultText += `- 目录: ${ossTargetDir}\n`;
            resultText += `- 配置: ${configName}\n`;
            resultText += `- 成功: ${uploadedCount}/${results.length}\n`;
          }

          return {
            content: [{
              type: "text",
              text: resultText
            }]
          };
        } catch (error) {
          Logger.error(`导出 Figma 多倍图出错:`, error);
          return {
            isError: true,
            content: [{
              type: "text",
              text: `导出 Figma 多倍图失败: ${error instanceof Error ? error.message : error}`
            }]
          };
        }
      }
    );
  }

  // 生成 TinyPNG 自动化指令
  private generateTinyPngInstructions(batches: { path: string; name: string; ext: string; size: number }[][], outputFormat: string | null): string {
    let instructions = '';

    // 添加重要提示
    instructions += `### ⚠️ 重要提示\n\n`;
    instructions += `1. **图片必须在项目目录内**：Playwright MCP 只能访问项目目录下的文件。\n`;
    instructions += `   - 不能使用 \`/tmp/\` 等系统临时目录\n`;
    instructions += `   - 请将图片下载到项目根目录下的 \`.tmp-compress/\` 文件夹\n`;
    instructions += `2. **上传前必须先触发文件选择框**：先点击上传区域，等待 Modal state 显示 "File chooser" 后再调用 \`browser_file_upload\`\n\n`;

    const needsFormatConversion = outputFormat && outputFormat !== 'png';

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      instructions += `#### 批次 ${i + 1}/${batches.length}\n\n`;
      instructions += `**文件**: ${batch.map(img => path.basename(img.path)).join(', ')}\n\n`;

      let stepNum = 1;
      instructions += `${stepNum++}. **打开网站**: 使用 \`browser_navigate\` 访问 \`https://tinypng.com/\`\n`;
      instructions += `${stepNum++}. **等待加载**: 使用 \`browser_snapshot\` 确认页面加载完成\n`;

      // 如果需要转换格式（WebP/JPEG），先开启开关
      if (needsFormatConversion) {
        instructions += `${stepNum++}. **开启格式转换开关**: \n`;
        instructions += `   - 在页面底部找到 "Convert my images automatically" 开关\n`;
        instructions += `   - 使用 \`browser_click\` 点击开关开启它（如果是关闭状态）\n`;
        instructions += `   - 开启后会出现格式选择选项\n`;
        instructions += `${stepNum++}. **选择输出格式**: \n`;
        instructions += `   - 点击选择 "${outputFormat!.toUpperCase()}" 格式\n`;
      }

      instructions += `${stepNum++}. **触发文件选择框**: \n`;
      instructions += `   - 使用 \`browser_click\` 点击上传区域（"Drop your .webp, .png or .jpg files here!" 文字区域）\n`;
      instructions += `   - 等待 \`browser_snapshot\` 返回结果中 Modal state 显示 "[File chooser]"\n`;
      instructions += `${stepNum++}. **上传文件**: 使用 \`browser_file_upload\` 上传以下文件:\n`;
      for (const img of batch) {
        instructions += `   - \`${img.path}\`\n`;
      }
      instructions += `${stepNum++}. **等待压缩**: 使用 \`browser_wait_for\` 等待 "Download all" 或各文件的 "download" 按钮出现\n`;
      instructions += `${stepNum++}. **下载结果**: 点击 "Download all" 或逐个下载\n`;

      if (i < batches.length - 1) {
        instructions += `${stepNum++}. **刷新页面**: 使用 \`browser_navigate\` 重新访问 \`https://tinypng.com/\` 准备下一批\n`;
      }
      instructions += `\n`;
    }

    return instructions;
  }

  // 生成 AnyWebP 自动化指令
  private generateAnyWebPInstructions(batches: { path: string; name: string; ext: string; size: number }[][]): string {
    let instructions = '';

    // 添加重要提示
    instructions += `### ⚠️ 重要提示\n\n`;
    instructions += `1. **图片必须在项目目录内**：Playwright MCP 只能访问项目目录下的文件。\n`;
    instructions += `   - 不能使用 \`/tmp/\` 等系统临时目录\n`;
    instructions += `   - 请将图片下载到项目根目录下的 \`.tmp-compress/\` 文件夹\n`;
    instructions += `2. **上传前必须先触发文件选择框**：先点击上传区域，等待 Modal state 显示 "File chooser" 后再调用 \`browser_file_upload\`\n\n`;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      instructions += `#### 批次 ${i + 1}/${batches.length}\n\n`;
      instructions += `**文件**: ${batch.map(img => path.basename(img.path)).join(', ')}\n\n`;

      let stepNum = 1;
      instructions += `${stepNum++}. **打开网站**: 使用 \`browser_navigate\` 访问 \`https://anywebp.com/convert-to-webp.html\`\n`;
      instructions += `${stepNum++}. **等待加载**: 使用 \`browser_snapshot\` 确认页面加载完成\n`;
      instructions += `${stepNum++}. **触发文件选择框**: \n`;
      instructions += `   - 使用 \`browser_click\` 点击 "Drop your images here!" 上传区域\n`;
      instructions += `   - 等待 \`browser_snapshot\` 返回结果中 Modal state 显示 "[File chooser]"\n`;
      instructions += `${stepNum++}. **上传文件**: 使用 \`browser_file_upload\` 上传以下文件:\n`;
      for (const img of batch) {
        instructions += `   - \`${img.path}\`\n`;
      }
      instructions += `${stepNum++}. **等待转换**: 使用 \`browser_wait_for\` 等待转换完成，出现 "Download" 按钮\n`;
      instructions += `${stepNum++}. **下载结果**: 点击 "Download All" 或逐个下载 WebP 文件\n`;

      if (i < batches.length - 1) {
        instructions += `${stepNum++}. **刷新页面**: 使用 \`browser_navigate\` 重新访问准备下一批\n`;
      }
      instructions += `\n`;
    }

    return instructions;
  }

  async connect(transport: Transport): Promise<void> {
    try {
      await this.server.connect(transport);

      Logger.log = (...args: any[]) => {
        try {
          this.server.server.sendLoggingMessage({
            level: "info",
            data: args,
          });
        } catch (error) {
          console.log(...args);
        }
      };

      Logger.error = (...args: any[]) => {
        try {
          this.server.server.sendLoggingMessage({
            level: "error",
            data: args,
          });
        } catch (error) {
          console.error(...args);
        }
      };

      Logger.log("OSS MCP服务器已连接并准备处理请求");
    } catch (error) {
      console.error("连接到传输时出错:", error);
    }
  }

  async startHttpServer(port: number): Promise<void> {
    const app = express();

    // SSE连接端点 - 修复头部发送冲突
    app.get("/sse", (req: Request, res: Response) => {
      // 初始化SSE传输，不再自己设置头部，而是让SDK处理
      this.sseTransport = new SSEServerTransport(
        "/messages",
        res as unknown as ServerResponse<IncomingMessage>
      );

      try {
        // 连接到传输层
        this.server.connect(this.sseTransport)
          .catch((err) => {
            console.error("连接到SSE传输时出错:", err);
          });

        // 处理客户端断开连接
        req.on('close', () => {
          console.log('SSE客户端断开连接');
          this.sseTransport = null;
        });
      } catch (error) {
        console.error("建立SSE连接时出错:", error);
        // 如果连接失败，关闭响应
        if (!res.writableEnded) {
          res.status(500).end();
        }
      }
    });

    // 消息端点
    app.post("/messages", async (req: Request, res: Response) => {
      if (!this.sseTransport) {
        console.log("尝试发送消息，但SSE传输未初始化");
        res.status(400).json({
          error: 'SSE连接未建立',
          message: '请先连接到/sse端点'
        });
        return;
      }

      try {
        await this.sseTransport.handlePostMessage(
          req as unknown as IncomingMessage,
          res as unknown as ServerResponse<IncomingMessage>
        );
      } catch (error) {
        console.error("处理消息时出错:", error);
        if (!res.writableEnded) {
          res.status(500).json({
            error: "内部服务器错误",
            message: String(error)
          });
        }
      }
    });

    // 启动服务器
    app.listen(port, () => {
      Logger.log = console.log;
      Logger.error = console.error;

      Logger.log(`HTTP服务器监听端口: ${port}`);
      Logger.log(`SSE端点: http://localhost:${port}/sse`);
      Logger.log(`消息端点: http://localhost:${port}/messages`);
    });
  }
}
