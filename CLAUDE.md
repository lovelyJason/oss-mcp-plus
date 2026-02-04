# OSS MCP Server

> 让 LLM 能够直接上传文件到阿里云 OSS 的 MCP 服务器

## 项目概述

这是一个基于 Model Context Protocol (MCP) 标准的 Node.js 服务，使 Claude、Cursor 等 AI 工具能够无缝上传文件到阿里云对象存储服务 (OSS)。

## 技术栈

- **语言**: TypeScript 5.4.2
- **运行时**: Node.js 18.0.0+ (ES2022)
- **模块系统**: ESM (ECMAScript Modules)
- **包管理器**: pnpm

### 核心依赖

| 依赖 | 用途 |
|------|------|
| `@modelcontextprotocol/sdk` | MCP 协议实现 |
| `ali-oss` | 阿里云 OSS SDK |
| `express` | HTTP 服务器 (SSE 模式) |
| `zod` | 运行时 Schema 验证 |
| `yargs` | CLI 参数解析 |
| `dotenv` | 环境变量加载 |

### 开发工具

| 工具 | 用途 |
|------|------|
| `tsup` | TypeScript 打包构建 |
| `eslint` | 代码检查 |
| `prettier` | 代码格式化 |
| `nodemon` | 开发热重载 |

## 项目结构

```
oss-mcp/
├── src/
│   ├── index.ts                 # 入口文件 (CLI 可执行)
│   ├── server.ts                # MCP 服务器实现
│   ├── config/
│   │   └── oss.config.ts        # 配置解析器 (CLI + 环境变量)
│   └── services/
│       └── oss.service.ts       # OSS 业务逻辑
├── dist/                        # 构建输出
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── .eslintrc.js
├── .prettierrc
└── .env.example                 # 环境变量模板
```

## 常用命令

```bash
# 开发模式 (热重载 + HTTP 服务)
pnpm dev

# 构建
pnpm build

# 运行 (Stdio 模式)
pnpm start

# 运行 (HTTP 模式，端口 3000)
pnpm start:http

# MCP Inspector 调试
pnpm inspect

# 代码检查
pnpm lint

# 代码格式化
pnpm format

# 发布到 npm
pnpm pub:release
```

## 架构说明

### MCP 工具

服务器注册了两个 MCP 工具：

1. **`upload_to_oss`** - 文件上传
   - `filePath` (必需): 本地文件路径
   - `targetDir` (可选): OSS 目标目录
   - `fileName` (可选): 自定义文件名
   - `configName` (可选): 使用的 OSS 配置名

2. **`list_oss_configs`** - 列出可用的 OSS 配置

### 传输模式

- **Stdio**: 标准输入输出 (默认，用于 CLI 集成)
- **HTTP + SSE**: Server-Sent Events (用于 Web 集成)

### 配置方式

支持三种配置方式 (优先级从高到低)：

1. CLI 参数: `--oss-config='{"default":{...}}'`
2. 环境变量: `OSS_CONFIG_DEFAULT`, `OSS_CONFIG_TEST` 等
3. `.env` 文件

## 代码规范

### ESLint

- TypeScript 严格模式
- 禁止未使用变量 (下划线前缀除外)
- 推荐使用显式返回类型

### Prettier

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

### 命名约定

- **文件**: kebab-case (`oss.service.ts`)
- **类**: PascalCase (`OssMcpServer`)
- **函数/变量**: camelCase (`uploadToOss`)
- **常量**: UPPER_SNAKE_CASE (`OSS_CONFIG_DEFAULT`)

## 设计模式

- **单例模式**: `ossService` - 全局唯一 OSS 服务实例
- **策略模式**: Stdio / HTTP 双传输协议
- **工厂模式**: OSS 客户端创建与缓存
- **服务层分离**: MCP 服务器逻辑与 OSS 操作分离

## 开发注意事项

1. **配置敏感信息**: 不要将 `accessKeyId` 和 `accessKeySecret` 提交到代码仓库
2. **环境变量**: 开发时使用 `.env` 文件，生产时使用环境变量
3. **类型安全**: 使用 Zod 进行运行时类型验证
4. **错误处理**: 所有 OSS 操作都应有完善的错误处理

## 测试

```bash
# 使用 MCP Inspector 进行调试测试
pnpm inspect
```

## 发布流程

1. 更新 `package.json` 版本号
2. 运行 `pnpm build` 构建
3. 运行 `pnpm pub:release` 发布到 npm

## 相关链接

- [GitHub 仓库](https://github.com/lovelyJason/oss-mcp)
- [npm 包](https://www.npmjs.com/package/oss-mcp)
- [MCP 协议文档](https://modelcontextprotocol.io/)
- [阿里云 OSS 文档](https://help.aliyun.com/product/31815.html)
