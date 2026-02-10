# OSS MCP Plus 🚀

一个基于 Model Context Protocol (MCP) 的服务器，用于将文件上传到阿里云 OSS。此服务器使大型语言模型能够直接将文件上传到阿里云对象存储服务，并提供文件管理相关的实用工具。

> Fork 自 [1yhy/oss-mcp](https://github.com/1yhy/oss-mcp)，新增批量重命名、目录列表、文件下载，图片批量删除，以及图片批量压缩等实用重磅工具。

<img width="1280" height="2034" alt="image" src="https://github.com/user-attachments/assets/c03c3716-109b-49a5-ab7c-113a6777c868" />

**批量重命名**：

![oss-mcp-plus](https://github.com/user-attachments/assets/62689a86-92c8-4475-aa59-dde6eabd5bb2)


**压缩图片**：

内置tinypng和anywebp压缩引擎，会自动启用playwright mcp，进行oss上的图片压缩操作

<img width="758" height="699" alt="image" src="https://github.com/user-attachments/assets/e0d1c221-18c8-44dd-a76a-c87e75647830" />

## 💡 使用场景

OSS MCP服务器能够与其他MCP工具无缝集成，为您提供强大的工作流程：

- **与[Playwright MCP](https://github.com/executeautomation/mcp-playwright)集成**：可以先使用Playwright MCP抓取网页截图或下载网页资源，然后直接上传到阿里云OSS存储。
- **与[Figma MCP](https://github.com/1yhy/Figma-Context-MCP)集成**：下载图片资源到本地后直接上传OSS、或者Figma网络文件直接上传OSS。
- **与[Filesystem MCP](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)集成**：可以浏览和选择本地文件系统中的文件，然后一步上传到云存储。
- **数据备份流程**：将重要数据从本地或其他服务自动备份到OSS。
- **媒体处理流程**：结合其他处理工具，可以对图片、视频进行处理后直接上传并获取可访问的URL。
- **多OSS账号管理**：便捷地在多个OSS账号间切换上传目标。

## ✨ 功能特点

- 📁 支持多个阿里云 OSS 配置
- 🗂️ 可指定上传目录
- 🔄 简单易用的接口
- 📥 支持从 URL 下载文件到本地
- 📂 列出本地/OSS目录文件，支持通配符过滤
- ✏️ 批量重命名文件，支持预览模式
- 🗑️ 批量删除文件，支持通配符和环境变量安全控制
- 🗜️ 批量压缩图片（支持 TinyPNG / AnyWebP）

## 🔧 安装

> 💡 **AI 工具用户**：如果你使用 Claude Code、Cursor、Windsurf 等 AI 工具，可直接跳转到 [与 AI 工具集成](#ai-integration) 章节进行配置。

您可以通过 npm 或从源码安装：

### 使用npm安装

```bash
# 使用npm全局安装
npm install -g oss-mcp-plus

# 或使用pnpm全局安装
pnpm add -g oss-mcp-plus
```

### 使用示例

```bash
# 直接启动 (stdio模式)
oss-mcp-plus --oss-config='{\"default\":{\"region\":\"oss-cn-shenzhen\",\"accessKeyId\":\"YOUR_KEY\",\"accessKeySecret\":\"YOUR_SECRET\",\"bucket\":\"YOUR_BUCKET\",\"endpoint\":\"oss-cn-shenzhen.aliyuncs.com\"}}'


# 使用Inspector调试
oss-mcp-plus --oss-config='{ "region": "oss-cn-shenzhen", "accessKeyId": "YOUR_KEY", "accessKeySecret": "YOUR_SECRET", "bucket": "BUCKET_NAME", "endpoint": "oss-cn-shenzhen.aliyuncs.com" }' --inspect
```

### 从源码安装

```bash
# 克隆仓库
git clone https://github.com/lovelyJason/oss-mcp-plus.git
cd oss-mcp-plus

# 安装依赖
pnpm install

# 构建项目
pnpm build
```

## ⚙️ 配置

您可以通过以下方式配置阿里云OSS参数：

### 方式一：使用.env文件

在项目根目录创建`.env`文件，参考`.env.example`模板。您可以配置多个阿里云OSS服务：

```ini
# 默认OSS配置
OSS_CONFIG_DEFAULT={"region":"oss-cn-hangzhou","accessKeyId":"your-access-key-id","accessKeySecret":"your-access-key-secret","bucket":"your-bucket-name","endpoint":"oss-cn-hangzhou.aliyuncs.com"}

# 其他OSS配置
OSS_CONFIG_TEST={"region":"oss-cn-beijing","accessKeyId":"your-access-key-id-2","accessKeySecret":"your-access-key-secret-2","bucket":"your-bucket-name-2","endpoint":"oss-cn-beijing.aliyuncs.com"}
```

### 方式二：直接设置环境变量

您也可以直接在系统中或启动命令中设置环境变量：

```bash
# 设置环境变量并启动
pnpm dev --oss-config='{ "default": { "region": "oss-cn-shenzhen", "accessKeyId": "YOUR_KEY", "accessKeySecret": "YOUR_SECRET", "bucket": "BUCKET_NAME", "endpoint": "oss-cn-shenzhen.aliyuncs.com" }, "test": { "region": "oss-cn-beijing", "accessKeyId": "YOUR_KEY", "accessKeySecret": "YOUR_SECRET", "bucket": "BUCKET_NAME", "endpoint": "oss-cn-beijing.aliyuncs.com" } }'
```

## 🔍 参数说明

- `region`: 阿里云OSS区域
- `accessKeyId`: 阿里云访问密钥ID
- `accessKeySecret`: 阿里云访问密钥Secret
- `bucket`: OSS存储桶名称
- `endpoint`: OSS终端节点

## 📋 使用方法

### 命令行选项

```
选项:
  -s, --stdio    使用stdio传输启动服务器
  -h, --http     使用HTTP传输启动服务器
  -p, --port     HTTP服务器端口 (默认: 3000)
  -i, --inspect  使用Inspector工具启动
  -?, --help     显示帮助信息
```


### 从源码启动

```bash
# 开发模式
pnpm dev

# 启动服务 (stdio模式)
pnpm start

# 启动HTTP服务
pnpm start:http

# 使用Inspector调试
pnpm inspect
```

<a id="ai-integration"></a>
## 🛠️ 与Claude/Cursor等AI工具集成

### Cursor等配置方法

1. 在Cursor中打开设置（Settings）
2. 转到MCP服务器（MCP Servers）部分
3. 添加新服务器配置：

```json
{
  "mcpServers": {
    "oss-mcp-plus": {
      "command": "npx",
      "args": [
        "oss-mcp-plus",
        "--oss-config='{\"default\":{\"region\":\"oss-cn-shenzhen\",\"accessKeyId\":\"YOUR_KEY\",\"accessKeySecret\":\"YOUR_SECRET\",\"bucket\":\"YOUR_BUCKET\",\"endpoint\":\"oss-cn-shenzhen.aliyuncs.com\"}}'",
        "--stdio"
      ]
    }
  }
}
```

### 配置多个OSS账号

使用环境变量方式可以轻松配置多个OSS账号：

```json
{
  "mcpServers": {
    "oss-mcp-plus": {
      "command": "npx",
      "args": [
        "oss-mcp-plus",
        "--oss-config='{\"default\":{\"region\":\"oss-cn-shenzhen\",\"accessKeyId\":\"YOUR_KEY\",\"accessKeySecret\":\"YOUR_SECRET\",\"bucket\":\"YOUR_BUCKET\",\"endpoint\":\"oss-cn-shenzhen.aliyuncs.com\"}, \"test\":{\"region\":\"oss-cn-shenzhen\",\"accessKeyId\":\"YOUR_KEY\",\"accessKeySecret\":\"YOUR_SECRET\",\"bucket\":\"YOUR_BUCKET\",\"endpoint\":\"oss-cn-shenzhen.aliyuncs.com\"}}'",
        "--stdio"
      ]
    }
  }
}
```

### 启用删除功能（可选）

出于安全考虑，删除 OSS 文件功能默认禁用。如需启用，请添加 `ALLOW_DELETE_OPERATION` 环境变量：

```json
{
  "mcpServers": {
    "oss-mcp-plus": {
      "command": "npx",
      "args": [
        "oss-mcp-plus",
        "--oss-config='{...}'",
        "--stdio"
      ],
      "env": {
        "ALLOW_DELETE_OPERATION": "true"
      }
    }
  }
}
```

> ⚠️ **安全提示**: 仅在确实需要删除功能时才启用此选项。未配置时，`delete_oss_files` 工具将拒绝执行任何删除操作。

### 推荐方式：使用 MCP Switch 客户端

现在AI编辑器太多了，且不同软件的配置方式有细微差别，比如claude有cli命令可以管理，因此为了抹平这个差异造成的心智负担：

借助本作者的另一客户端软件 [MCP Switch](https://github.com/lovelyJason/mcp-switch)，可以通过可视化界面轻松添加和管理 MCP 服务器：

![MCP Switch 界面](https://github.com/user-attachments/assets/b1630964-08ea-4dde-8ded-6fa00cf590bc)

## 🧰 可用工具

服务器提供以下工具：

### 1. 上传文件到OSS (`upload_to_oss`)

**参数**:
- `filePath`: 本地文件路径（必需）
- `targetDir`: 目标目录路径（可选）
- `fileName`: 文件名（可选，默认使用原文件名）
- `configName`: OSS配置名称（可选，默认使用'default'）

### 2. 列出可用的OSS配置 (`list_oss_configs`)

无参数，返回所有可用的OSS配置名称。

### 3. 批量重命名OSS文件 (`batch_rename_files`)

批量重命名阿里云OSS文件，通过 copy + delete 实现。

**参数**:
- `directory`: OSS中的目录路径（必需），如 `images/icons`，根目录传空字符串 `''`
- `renameRules`: 重命名规则数组，每项包含 `oldName` 和 `newName`（必需）
- `configName`: OSS配置名称（可选，默认为 `default`）
- `dryRun`: 是否为预览模式（可选，默认 false）。为 true 时只返回将要执行的操作，不实际重命名

### 4. 列出本地目录文件 (`list_directory_files`)

列出**本地文件系统**中指定目录下的所有文件。

**参数**:
- `directory`: 本地目录路径（必需）
- `pattern`: 文件名过滤模式（可选），如 `*.png` 或 `icon_*`

> ⚠️ **注意**: 此工具仅支持本地文件系统路径。如果要列出 OSS 中的文件，请使用 `list_oss_files`。

### 5. 列出OSS目录文件 (`list_oss_files`) 🆕

列出**阿里云OSS**中指定目录下的所有文件。

**参数**:
- `directory`: OSS中的目录路径（必需），如 `images/icons`，根目录传空字符串 `''`
- `pattern`: 文件名过滤模式（可选），如 `*.png` 或 `icon_*`
- `configName`: OSS配置名称（可选，默认为 `default`）

### 6. 下载文件 (`download_file`)

从 URL 下载文件到本地目录，支持 HTTP/HTTPS 链接。

**参数**:
- `url`: 要下载的文件 URL（必需）
- `targetDir`: 保存文件的本地目录路径（必需）
- `fileName`: 保存的文件名（可选，默认从 URL 提取）

### 7. 删除OSS文件 (`delete_oss_files`) 🆕

删除阿里云OSS中的文件，支持单个删除、批量删除和通配符匹配。

> ⚠️ **安全限制**: 此工具需要配置环境变量 `ALLOW_DELETE_OPERATION=true` 才能使用。详见 [启用删除功能](#启用删除功能可选) 章节。

**参数**:
- `directory`: OSS中的目录路径（必需），如 `images/icons`，根目录传空字符串 `''`
- `fileNames`: 要删除的文件名数组（与 `pattern` 二选一）
- `pattern`: 文件名通配符模式（与 `fileNames` 二选一），如 `*.tmp` 或 `test_*`
- `configName`: OSS配置名称（可选，默认为 `default`）
- `dryRun`: 是否为预览模式（可选，默认 false）。为 true 时只返回将要删除的文件列表，不实际删除

**使用示例**:

```
用户: 删除 OSS 上 temp 目录下所有 .tmp 文件
AI:
1. 先用 dryRun=true 预览将要删除的文件
2. 确认后用 dryRun=false 执行实际删除
```

### 8. 压缩图片 (`compress_images`)

批量压缩图片工具，支持 TinyPNG 和 AnyWebP 两个在线压缩引擎。需配合 Playwright MCP 使用。

**参数**:
- `images`: 要压缩的本地图片路径数组（必需）
- `engine`: 压缩引擎（必需），可选值:
  - `tinypng`: 支持 PNG/JPEG/WebP 输出，每批最多 3 个文件
  - `anywebp`: 固定输出 WebP，每批最多 20 个文件
- `outputFormat`: 输出格式（可选，仅 tinypng 有效），可选值: `png`/`jpeg`/`webp`
- `deleteOriginal`: 转格式时是否删除原文件（可选，默认 false）
- `ossDirectory`: OSS 目标目录（可选）
- `configName`: OSS 配置名称（可选，默认为 `default`）

**使用示例**:

```
用户: 帮我压缩这几张图片并上传到 OSS
AI:
1. 调用 compress_images 获取压缩指令
2. 使用 Playwright MCP 执行网页自动化压缩
3. 下载压缩结果
4. 使用 upload_to_oss 上传回 OSS
```

**注意事项**:
- 需要同时配置 Playwright MCP 才能完成压缩
- TinyPNG 免费版每次最多上传 3 个文件，超过会自动分批处理
- 单个文件大小限制为 5MB

## 📦 发布

```bash
# 发布到npm
pnpm pub:release

# 本地打包测试
pnpm publish:local
```

## 📄 许可证

[MIT](LICENSE)

## 🙏 致谢

本项目基于 [1yhy/oss-mcp](https://github.com/1yhy/oss-mcp) 开发，感谢原作者的贡献！
