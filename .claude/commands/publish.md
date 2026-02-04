# 发布到 npm

将包发布到 npm 公共仓库。

## 发布步骤

1. 确保代码已提交到 git
2. 更新 `package.json` 中的版本号
3. 执行发布命令：

```bash
pnpm pub:release
```

## 本地测试

发布前可以先本地打包测试：

```bash
pnpm publish:local
```

这会生成 `.tgz` 文件供本地安装测试。
