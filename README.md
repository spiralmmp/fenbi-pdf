# 粉笔答案解析导出工具

将粉笔（Fenbi）试卷的“答案解析页面”导出为 PDF：按题号整理，只保留答案和解析，不包含题干、选项和材料。

- 登录一次，之后直接粘贴链接即可导出
- 优先调用粉笔解析接口，避免页面扫描导致的错漏
- 生成真实文本 PDF，可搜索、可复制（公式和插图仍以图片保留）
- 零第三方依赖，只需要 Node.js 和 Chrome

> 本工具仅用于导出**本人已购买或有权访问**的试卷内容，不会绕过登录、会员、付费或任何访问控制。请遵守粉笔的用户协议与版权规定，不要传播导出内容。

## 环境要求

- Node.js 22 或更高版本（使用内置 `fetch` 和全局 `WebSocket`，无需安装依赖）
- Chrome / Chromium / Edge
- 首次登录需要图形界面；登录完成后可使用 `--headless`
- 字体（可选，仅影响排版外观）：
  - Times New Roman（西文）
  - Noto Sans CJK SC（中文）
  - 缺失时 Chrome 会自动回退到系统字体，PDF 仍可正常生成，但字宽和分页可能不同
  - Linux 安装示例：`noto-fonts-cjk`（Arch）、`fonts-noto-cjk`（Debian/Ubuntu）

## 安装

```bash
git clone https://github.com/spiralmmp/fenbi-pdf.git
cd fenbi-pdf
```

无需 `npm install`。

## 使用

```bash
node index.mjs
```

按提示粘贴**答案解析页面**的 URL（地址栏中包含 `/ti/exam/solution/`），回车开始导出。

也可以直接带 URL 运行：

```bash
node index.mjs "https://spa.fenbi.com/ti/exam/solution/..."
```

### 首次登录

```bash
node index.mjs --login
```

浏览器会打开粉笔首页，手动完成扫码或账号登录，然后回到终端按回车。登录状态保存在本地 `browser-profile/`，以后直接导出即可。

- 带 URL 的 `--login` 会在登录后继续导出：`node index.mjs --login "<URL>"`
- 未登录时直接打开解析页可能显示 `about:blank`，这是粉笔页面的行为，先登录即可
- 登录失效时重新运行 `--login`

### 常用选项

| 选项 | 说明 |
| --- | --- |
| `--login` | 打开浏览器完成登录后退出；带 URL 时登录后继续导出 |
| `--headless` | 使用无头浏览器（必须先完成过一次可见登录） |
| `--out <目录>` | PDF 输出目录，默认 `./output` |
| `--title <名称>` | 自定义 PDF 标题 |
| `--wait <毫秒>` | 页面打开后的额外等待时间，默认 `500` |
| `--max-pages <数量>` | 最多翻页数，默认 `60` |
| `--chrome <路径>` | 指定 Chrome/Chromium 可执行文件 |
| `--no-expand` | 不自动点击“展开解析”等按钮 |
| `--no-pagination` | 只导出当前页 |
| `--no-api` | 不使用粉笔接口，仅解析页面（可能混入推荐题，不建议） |
| `--debug` | 保存 HTML、截图和提取结果到 `./debug/<时间>` |
| `-h, --help` | 显示帮助 |

### 输出

PDF 默认写入 `output/`，文件名由试卷标题和时间戳组成，例如：

```
output/粉笔_<试卷名>_<日期-时间>.pdf
```

## 工作原理

1. 启动使用独立配置目录的 Chrome
2. 打开解析页，从网络请求中定位粉笔的 `combine/static/solution` 接口
3. 读取题号、正确答案和解析 HTML，并清洗不安全的标签与属性
4. 拼接打印专用 HTML，等待图片和字体加载完成
5. 调用 Chrome `Page.printToPDF` 生成 A4 PDF

PDF 中的文字来自接口返回的 HTML，是真实文本，不是截图或 OCR。解析中的公式和插图在粉笔侧本身只有图片，因此保留为图片。

## 项目结构

```
index.mjs                    CLI 入口
lib/cdp.mjs                  Chrome DevTools Protocol 连接与导航
lib/extract-fenbi-api.mjs    粉笔接口提取
lib/extract-fenbi.mjs        粉笔页面提取（接口不可用时回退）
lib/extract-generic.mjs      通用页面提取
lib/page-scripts.mjs         页面内执行脚本
lib/render.mjs               HTML 排版与 PDF 渲染
test/                        本地测试页面
```

## 已知限制

- 一次只处理一份试卷
- 需要账号对该试卷有访问权限；未购买或无权限的内容不会导出
- 新版粉笔解析页若接口识别失败，默认停止并报错，避免把推荐题等内容混进来；确需尝试页面解析可加 `--no-api`
- 公式在粉笔接口中仅提供 PNG 图片，原始 LaTeX 为加密数据，无法直接还原为文本
- 字体缺失、Chrome 版本不同都可能导致 PDF 分页和字宽略有差异
- 粉笔页面结构或接口变更可能导致提取失败

## 常见问题

**打开的是 `about:blank`**

先运行 `node index.mjs --login` 完成登录。

**提示找不到 Chrome**

安装 Chrome/Chromium，或用 `--chrome /path/to/chrome` 指定路径。

**导出 0 题或提示接口失败**

确认 URL 是“答案解析”页面（包含 `/ti/exam/solution/`），而不是试卷页或练习页；加 `--debug` 后会保存现场 HTML、截图和提取结果便于排查。

**换电脑后需要重新登录**

`browser-profile/` 是本机登录状态，不随仓库同步，在新机器上重新 `--login` 即可。

## 隐私与安全

- 工具不会收集或上传任何数据，所有请求只发往粉笔和本地 Chrome
- 登录 Cookie 仅保存在本地 `browser-profile/`，该目录已在 `.gitignore` 中忽略
- 工具不保存、不脚本化账号密码，登录始终由你在浏览器中手动完成
- `browser-profile/`、`output/`、`debug/` 包含登录状态或试卷内容，请不要提交、分享或上传

## 免责声明

本工具仅用于个人学习与备份。请仅导出你已购买或有权访问的内容，并遵守粉笔的用户协议与版权规定。因使用本工具产生的任何后果由使用者自行承担。
