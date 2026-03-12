# 发布到 npm

将包发布到 npm 公共仓库（https://registry.npmjs.org）。

## 发布步骤

### 1. 检查 npm registry

检查当前 registry 是否为 npm 官方源，如果不是则切换：

```bash
nrm current
```

如果输出不是 `npm`，则执行：

```bash
nrm use npm
```

### 2. 提交代码并推送到 GitHub

确保所有改动已提交到 git 并推送到远程仓库：

```bash
git add -A
git status
```

如果有未提交的改动，生成合适的 commit message 并提交：

```bash
git commit -m "描述性的提交信息"
git push origin HEAD
```

### 3. 更新版本号

根据改动类型更新 `package.json` 中的版本号：

- **patch** (1.0.x): bug 修复、文档更新
- **minor** (1.x.0): 新功能、向后兼容的改动
- **major** (x.0.0): 破坏性变更

### 4. 构建并发布

```bash
pnpm pub:release
```

### 5. 发布后确认

```bash
npm view oss-mcp-plus version
```

确认版本号与 `package.json` 一致。

## 本地测试

发布前可以先本地打包测试：

```bash
pnpm publish:local
```

这会生成 `.tgz` 文件供本地安装测试。
