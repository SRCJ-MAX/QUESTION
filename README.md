# 刷题本

一个专门面向 iPhone Safari 的本地优先刷题 PWA。题库、错题、收藏、作答记录和统计信息默认保存在浏览器本地 IndexedDB 中，首次加载后支持离线使用。

## 运行

```powershell
$env:Path='C:\Users\12844\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:Path
C:\Users\12844\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd install
C:\Users\12844\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd run dev -- --host 127.0.0.1 --port 4173
```

浏览器打开：

```text
http://127.0.0.1:4173/
```

## 构建

```powershell
$env:Path='C:\Users\12844\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:Path
$env:CI='true'
C:\Users\12844\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd run build
```

构建产物在 `dist/`。

## 题库格式

支持导入：

- JSON
- CSV
- Excel `.xlsx`

推荐字段：

```text
题型, 题目, 选项, 答案, 解析, 章节
```

也支持英文表头：

```text
type, question, options, answer, analysis, chapter
```

Excel/CSV 的选项可以写在一个 `选项` 字段里，用分号、竖线或换行分隔；也可以拆成 `A/B/C/D` 或 `选项A/选项B/选项C/选项D` 多列。示例文件在 `samples/example-bank.json`。

## GitHub Pages 部署

1. 新建一个 GitHub 仓库，把本项目所有文件提交上去。
2. 本地运行构建命令，确认生成 `dist/`。
3. 在仓库 Settings -> Pages 中选择部署来源。
4. 推荐使用 GitHub Actions 部署。新建 `.github/workflows/deploy.yml`，内容如下：

```yaml
name: Deploy PWA

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

部署完成后，用 iPhone Safari 打开 Pages 地址，点击分享按钮，选择“添加到主屏幕”。
