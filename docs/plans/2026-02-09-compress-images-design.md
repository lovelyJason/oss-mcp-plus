# compress_images 工具设计文档

## 概述

新增 `compress_images` MCP 工具，用于批量压缩图片。支持 TinyPNG 和 AnyWebP 两个在线压缩引擎，通过 Playwright MCP 实现网页自动化。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|-----|------|-----|------|
| `images` | `string[]` | 是 | 图片路径数组（本地路径或 OSS URL） |
| `engine` | `enum` | 是 | `tinypng` 或 `anywebp` |
| `outputFormat` | `enum` | 否 | `png`/`jpeg`/`webp`（tinypng 可选，anywebp 固定 webp） |
| `deleteOriginal` | `boolean` | 否 | 转格式时是否删除原文件（默认 false） |
| `configName` | `string` | 否 | OSS 配置名（默认 'default'） |

## 工作流程

```
1. 检测 Playwright MCP 是否可用
   └─ 不可用则返回错误，提示用户配置 Playwright MCP

2. 遍历 images 预处理：
   ├─ OSS URL → 调用 download_file 下载到临时目录
   └─ 本地路径 → 直接使用

3. 根据 engine 分批处理：
   ├─ tinypng: 每批最多 3 个（免费限制）
   │   └─ 处理完一批后刷新页面再传下一批
   └─ anywebp: 每批最多 20 个

4. Playwright 自动化：
   ├─ 打开对应网站
   ├─ 上传文件
   ├─ 等待压缩完成
   ├─ 如需转格式，选择输出格式
   └─ 下载压缩结果

5. 上传回 OSS：
   ├─ 不转格式 → 覆盖原文件
   └─ 转格式 → 新文件名（如 image.png → image.webp）

6. 如果转格式且 deleteOriginal=true：
   └─ 删除 OSS 上的原文件

7. 清理临时文件
```

## 引擎特性

### TinyPNG (https://tinypng.com/)

- 支持格式：PNG, JPEG, WebP
- 可选输出格式：PNG, JPEG, WebP
- 免费限制：每次最多 3 个文件
- 单文件大小限制：5MB

### AnyWebP (https://anywebp.com/convert-to-webp)

- 支持格式：PNG, JPEG, GIF, BMP, TIFF 等
- 固定输出格式：WebP
- 每次最多 20 个文件
- 单文件大小限制：5MB

## 返回结果格式

```
图片压缩完成！

引擎: TinyPNG
处理: 5 个, 成功: 4 个, 失败: 1 个

详细结果:
✅ image1.png: 800KB → 200KB (节省 75%)
✅ image2.png → image2.webp: 1.2MB → 300KB (节省 75%)
✅ image3.jpeg: 500KB → 150KB (节省 70%)
✅ image4.png: 已删除原文件
❌ image5.png: 压缩失败 (文件超过 5MB 限制)
```

## 错误处理

| 错误场景 | 处理方式 |
|---------|---------|
| Playwright MCP 未配置 | 返回错误，提示配置方法 |
| 文件不存在 | 跳过并记录错误 |
| 文件超过大小限制 | 跳过并记录错误 |
| 网络超时 | 重试 1 次，仍失败则记录错误 |
| 网站结构变化 | 返回错误，建议升级工具 |

## 实现说明

由于采用方案 B（纯工具编排），此工具本身不集成 Playwright，而是：

1. 工具返回一个"压缩指令"结构
2. 由调用方（Claude/Cursor）使用已配置的 Playwright MCP 执行实际操作
3. 工具提供详细的操作步骤说明，供 AI 按步骤执行

这样做的好处：
- 不增加 oss-mcp-plus 的依赖
- 用户可以复用已有的 Playwright MCP 配置
- 更灵活，易于适应网站变化
