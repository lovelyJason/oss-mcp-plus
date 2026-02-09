import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ossService } from "./services/oss.service.js";
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

    // 工具：列出目录文件
    this.server.tool(
      "list_directory_files",
      "列出指定目录下的所有文件，用于查看当前文件名以便进行重命名操作",
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

    // 工具：压缩图片（生成压缩指令，由 AI 调用 Playwright MCP 执行）
    this.server.tool(
      "compress_images",
      `压缩图片工具。生成压缩指令，需配合 Playwright MCP 执行。

【重要】调用此工具前，请确保：
1. 已配置并启用 Playwright MCP
2. 如果图片在 OSS 上，先用 download_file 下载到本地

【工作流程】
1. 调用此工具获取压缩指令
2. 按指令使用 Playwright MCP 执行网页自动化
3. 下载压缩结果到本地
4. 使用 upload_to_oss 上传回 OSS`,
      {
        images: z.array(z.string()).describe("要压缩的本地图片路径数组"),
        engine: z.enum(['tinypng', 'anywebp']).describe("压缩引擎: tinypng (支持 PNG/JPEG/WebP 输出) 或 anywebp (固定输出 WebP)"),
        outputFormat: z.enum(['png', 'jpeg', 'webp']).optional().describe("输出格式 (仅 tinypng 有效，anywebp 固定为 webp)"),
        deleteOriginal: z.boolean().optional().describe("转格式时是否删除原文件 (默认 false，仅当输出格式与原格式不同时生效)"),
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
  }

  // 生成 TinyPNG 自动化指令
  private generateTinyPngInstructions(batches: { path: string; name: string; ext: string; size: number }[][], outputFormat: string | null): string {
    let instructions = '';

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      instructions += `#### 批次 ${i + 1}/${batches.length}\n\n`;
      instructions += `**文件**: ${batch.map(img => path.basename(img.path)).join(', ')}\n\n`;

      instructions += `1. **打开网站**: 使用 \`browser_navigate\` 访问 \`https://tinypng.com/\`\n`;
      instructions += `2. **等待加载**: 使用 \`browser_snapshot\` 确认页面加载完成\n`;
      instructions += `3. **上传文件**: 使用 \`browser_file_upload\` 上传以下文件:\n`;
      for (const img of batch) {
        instructions += `   - \`${img.path}\`\n`;
      }
      instructions += `4. **等待压缩**: 使用 \`browser_wait_for\` 等待 "Download all" 或各文件的 "download" 按钮出现\n`;

      if (outputFormat && outputFormat !== 'png') {
        instructions += `5. **选择输出格式**: \n`;
        instructions += `   - 点击压缩结果右侧的格式选择下拉框\n`;
        instructions += `   - 选择 "${outputFormat.toUpperCase()}"\n`;
      }

      instructions += `${outputFormat && outputFormat !== 'png' ? '6' : '5'}. **下载结果**: 点击 "Download all" 或逐个下载\n`;

      if (i < batches.length - 1) {
        instructions += `${outputFormat && outputFormat !== 'png' ? '7' : '6'}. **刷新页面**: 使用 \`browser_navigate\` 重新访问 \`https://tinypng.com/\` 准备下一批\n`;
      }
      instructions += `\n`;
    }

    return instructions;
  }

  // 生成 AnyWebP 自动化指令
  private generateAnyWebPInstructions(batches: { path: string; name: string; ext: string; size: number }[][]): string {
    let instructions = '';

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      instructions += `#### 批次 ${i + 1}/${batches.length}\n\n`;
      instructions += `**文件**: ${batch.map(img => path.basename(img.path)).join(', ')}\n\n`;

      instructions += `1. **打开网站**: 使用 \`browser_navigate\` 访问 \`https://anywebp.com/convert-to-webp.html\`\n`;
      instructions += `2. **等待加载**: 使用 \`browser_snapshot\` 确认页面加载完成，找到 "Drop your images here" 区域\n`;
      instructions += `3. **上传文件**: 使用 \`browser_file_upload\` 上传以下文件:\n`;
      for (const img of batch) {
        instructions += `   - \`${img.path}\`\n`;
      }
      instructions += `4. **等待转换**: 使用 \`browser_wait_for\` 等待转换完成，出现 "Download" 按钮\n`;
      instructions += `5. **下载结果**: 点击 "Download All" 或逐个下载 WebP 文件\n`;

      if (i < batches.length - 1) {
        instructions += `6. **刷新页面**: 使用 \`browser_navigate\` 重新访问准备下一批\n`;
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
