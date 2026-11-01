# 粉笔答案解析导出工具

将粉笔（Fenbi）试卷的“答案解析页面”导出为 PDF：按题号整理，只保留答案和解析，不包含题干、选项和材料。

- 登录一次，之后直接粘贴链接即可导出
- 优先调用粉笔解析接口，避免页面扫描导致的错漏
- 生成真实文本 PDF，可搜索、可复制（公式和插图仍以图片保留）
- 默认中文宋体、西文 Times New Roman，支持自定义本机已安装的字体
- 零第三方依赖，只需要 Node.js 和 Chrome

> 本工具仅用于导出**本人已购买或有权访问**的试卷内容，不会绕过登录、会员、付费或任何访问控制。请遵守粉笔的用户协议与版权规定，不要传播导出内容。

> **平台说明**：当前版本仅在 **Linux** 上完成实际测试。Windows 和 macOS 理论上可以运行，但**尚未实测**，请按对应平台的说明自行测试。

## 依赖环境

### 依赖清单

| 依赖 | 是否必需 | 版本 / 说明 |
| --- | --- | --- |
| Node.js | 必需 | 22 或更高版本；使用内置 `fetch`、全局 `WebSocket` 和 ESM，无需任何 npm 包 |
| Chrome / Chromium / Edge | 必需 | 较新版本即可；负责登录、读取接口、渲染和打印 PDF |
| 粉笔账号 | 必需 | 账号需对目标试卷有访问权限 |
| 网络 | 必需 | 能访问粉笔相关域名（`fenbi.com`、`spa.fenbi.com`、`tiku.fenbi.com`）及图片 CDN |
| 图形界面 | 首次登录必需 | 扫码或账号登录需要可见浏览器；登录完成后可用 `--headless` |
| Git | 可选 | 仅用于克隆仓库；也可以直接下载 ZIP |
| 宋体 / Songti / Noto Serif CJK 等 | 可选 | 默认中文字体优先宋体；缺失时自动回退到其他中文字体 |
| Times New Roman | 可选 | 默认西文字体；缺失时回退到 Liberation Serif、Nimbus Roman 或系统衬线字体 |
| npm / Python / 数据库 / OCR | 不需要 | 项目零第三方依赖，无构建步骤 |

### 已测试环境

- 操作系统：Linux x86_64
- Node.js：v26.12.1（最低要求 22）
- 浏览器：Google Chrome 156.0.8078.79
- 字体：SimSun（宋体）、Times New Roman；另测试过 Noto Serif CJK SC + Arial 的自定义组合

Windows 10/11 与 macOS **尚未实测**，请按对应平台说明自行测试。

### 运行条件

- 需要对项目目录有写权限；运行时会在项目下创建 `browser-profile/`、`output/`、`debug/`
- 首次运行会生成 Chrome 配置目录，可能占用几十到几百 MB
- Chrome 调试端口随机分配且仅本机使用，无需开放入站端口
- 如使用代理，请确保系统代理或 Chrome 能正常访问粉笔
- 一般不需要管理员权限；Linux 容器或 root 环境如遇沙箱启动失败，可临时设置 `CHROME_NO_SANDBOX=1`（会降低浏览器安全性）

### 平台与 Chrome 查找位置

| 平台 | 实测状态 | Chrome 查找位置 |
| --- | --- | --- |
| Linux | **已实测** | `/usr/bin/google-chrome`、`chromium` 等，以及 PATH 中的 `msedge` / `brave` |
| Windows 10/11 | 未实测，需自行测试 | `C:\Program Files\Google\Chrome\Application\chrome.exe` 等 |
| macOS | 未实测，需自行测试 | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |

自动查找失败时，可用 `--chrome <路径>` 手动指定，或设置环境变量 `CHROME_PATH`。

### 浏览器兼容性

工具通过 Chrome DevTools Protocol 控制浏览器，并调用 `Page.printToPDF` 生成 PDF，因此需要 Chromium 内核：

| 浏览器 | 支持情况 |
| --- | --- |
| Google Chrome | **已实测**，推荐 |
| Chromium | 理论支持，未实测 |
| Microsoft Edge | 理论支持，未实测；可自动查找 |
| Brave | 理论支持，未实测；Linux 下可自动查找 |
| Vivaldi / Opera 等其他 Chromium 浏览器 | 理论支持，未实测；通常需用 `--chrome` 指定路径 |
| Firefox | 不支持，不使用 CDP，也没有 `Page.printToPDF` |
| Safari | 不支持 |

360、QQ 等 Chromium 套壳浏览器未验证，内核版本可能较旧，不保证可用。

自动查找只覆盖常见浏览器的默认安装位置，其他 Chromium 浏览器请手动指定：

```bash
node index.mjs "<URL>" --chrome "/path/to/browser"
```

不同浏览器或版本生成的 PDF 在字体嵌入和分页上可能略有差异；切换浏览器后如果登录态异常，重新运行 `--login` 即可。

### 字体说明

默认字体栈不是写死单一字体，而是逐级回退：

- 西文：Times New Roman → Liberation Serif → Nimbus Roman → 系统衬线字体
- 中文：SimSun（宋体）→ 宋体别名 → Songti SC / STSong → Source Han Serif / Noto Serif CJK → AR PL UMing → 微软雅黑 / 苹方 / Noto Sans CJK → 系统无衬线字体

因此即使本机没有宋体也能正常导出：会使用其他宋体类字体，或退到系统中文字体。只有系统完全没有中文字体时，中文才可能显示方框（Linux 可安装 `noto-fonts-cjk`）。

字体不是运行必需项；缺少字体或 Chrome 版本不同，可能导致字宽、换行和分页与示例不同。

自定义字体：

```bash
# 列出本机已安装字体
node index.mjs --list-fonts

# 自定义中文字体（默认宋体）
node index.mjs "<URL>" --font "Noto Serif CJK SC"

# 自定义西文字体（默认 Times New Roman）
node index.mjs "<URL>" --font-latin "Arial"
```

指定的字体必须已经安装在本机；如果字体名称不存在，会自动回退到默认字体链，不会导致导出失败。

## 安装

```bash
git clone https://github.com/spiralmmp/fenbi-pdf.git
cd fenbi-pdf
```

无需 `npm install`。各平台的准备步骤如下。

> 下面的命令假设仓库克隆在用户主目录；如果放在其他位置，请把 `~/fenbi-pdf`（macOS/Linux）或 `$HOME\fenbi-pdf`（Windows）换成实际路径。

### Windows

1. 安装 Node.js 22 或更高版本：从 [nodejs.org](https://nodejs.org/) 下载 LTS 安装包，或运行：
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
   安装完成后重新打开 PowerShell。
2. 安装 Chrome 或 Edge。
3. 进入项目目录并运行：
   ```powershell
   cd $HOME\fenbi-pdf
   node index.mjs "https://spa.fenbi.com/ti/exam/solution/..."
   ```
4. 找不到浏览器时手动指定路径：
   ```powershell
   node index.mjs "<URL>" --chrome "C:\Program Files\Google\Chrome\Application\chrome.exe"
   ```
5. 字体：Times New Roman 和宋体（SimSun）系统自带，默认就是宋体 + Times New Roman。如果系统精简掉了宋体，会自动回退到微软雅黑等其他中文字体。

### macOS

1. 安装 Node.js 22 或更高版本：
   ```bash
   brew install node
   ```
   或从 [nodejs.org](https://nodejs.org/) 下载安装包。
2. 安装 Google Chrome。
3. 进入项目目录并运行：
   ```bash
   cd ~/fenbi-pdf
   node index.mjs "https://spa.fenbi.com/ti/exam/solution/..."
   ```
4. 找不到浏览器时手动指定路径：
   ```bash
   node index.mjs "<URL>" --chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
   ```
5. 字体：Times New Roman 和 Songti SC（宋体）系统自带，默认使用 Songti SC；如果缺失会回退到苹方等其他中文字体。

### Linux

1. 安装 Node.js 22 或更高版本，例如 Arch：
   ```bash
   sudo pacman -S nodejs
   ```
   Debian/Ubuntu 建议通过 NodeSource 或 nvm 安装较新版本。
2. 安装 Chrome / Chromium。
3. 安装中文字体（推荐，包含 Noto Serif CJK，宋体缺失时作为回退）：
   ```bash
   sudo pacman -S noto-fonts-cjk
   # Debian/Ubuntu: sudo apt install fonts-noto-cjk
   ```
4. 如需严格使用宋体，可自行安装 SimSun；西文如需严格使用 Times New Roman，可安装 `ttf-mscorefonts-installer` 或发行版对应包。两者缺失都会自动回退。
5. 进入项目目录并运行：
   ```bash
   cd ~/fenbi-pdf
   node index.mjs "https://spa.fenbi.com/ti/exam/solution/..."
   ```

## 使用

```bash
node index.mjs
```

按提示粘贴**答案解析页面**的 URL（地址栏中包含 `/ti/exam/solution/`），回车开始导出。

也可以直接带 URL 运行：

```bash
node index.mjs "https://spa.fenbi.com/ti/exam/solution/..."
```

> URL 中可能包含 `?`、`&` 等字符，Windows PowerShell / cmd 下请务必用双引号包住整个 URL。

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
| `--font <名称>` | 自定义中文字体（需本机已安装，默认宋体） |
| `--font-latin <名称>` | 自定义西文字体（默认 Times New Roman） |
| `--list-fonts` | 列出本机已安装字体后退出 |
| `--wait <毫秒>` | 页面打开后的额外等待时间，默认 `500` |
| `--max-pages <数量>` | 最多翻页数，默认 `60` |
| `--chrome <路径>` | 指定 Chrome/Chromium 可执行文件 |
| `--no-expand` | 不自动点击“展开解析”等按钮 |
| `--no-pagination` | 只导出当前页 |
| `--no-api` | 不使用粉笔接口，仅解析页面（可能混入推荐题，不建议） |
| `--debug` | 保存 HTML、截图和提取结果到 `./debug/<时间>` |
| `-h, --help` | 显示帮助 |

### 输出

PDF 默认写入**项目目录下的 `output/`**（与 `index.mjs` 同级的文件夹），不是系统的“下载”目录。`output/` 不在 Git 仓库中是正常的：它在首次导出时自动创建，并已被 `.gitignore` 忽略，避免试卷内容进入公开仓库。导出结束时终端会打印完整路径：

```
PDF：/path/to/fenbi-pdf/output/粉笔_<试卷名>_20261101-1430.pdf
```

文件名由试卷标题和时间戳组成；重复导出不会覆盖，会自动追加 `-2`、`-3`。

自定义输出目录：

```bash
# macOS / Linux
node index.mjs "<URL>" --out ~/Documents/fenbi

# Windows PowerShell
node index.mjs "<URL>" --out "$HOME\Documents\fenbi"
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
browser-profile/             运行时生成：登录状态（已忽略，勿分享）
output/                      运行时生成：导出的 PDF（已忽略）
debug/                       运行时生成：调试文件（已忽略）
```

## 已知限制

- 仅在 Linux 上实测；Windows / macOS 未实测，可能需要自行调整 Chrome 路径或字体
- 一次只处理一份试卷
- 需要账号对该试卷有访问权限；未购买或无权限的内容不会导出
- 新版粉笔解析页若接口识别失败，默认停止并报错，避免把推荐题等内容混进来；确需尝试页面解析可加 `--no-api`
- 公式在粉笔接口中仅提供 PNG 图片，原始 LaTeX 为加密数据，无法直接还原为文本
- 缺少默认字体会自动回退，不会导致导出失败，但不同字体或 Chrome 版本可能导致 PDF 分页和字宽略有差异
- 粉笔页面结构或接口变更可能导致提取失败

## 常见问题

**打开的是 `about:blank`**

先运行 `node index.mjs --login` 完成登录。

**提示找不到 Chrome**

安装 Chrome/Chromium，或用 `--chrome` 指定路径：

```bash
# Windows PowerShell
node index.mjs "<URL>" --chrome "C:\Program Files\Google\Chrome\Application\chrome.exe"

# macOS
node index.mjs "<URL>" --chrome "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# Linux
node index.mjs "<URL>" --chrome /usr/bin/google-chrome-stable
```

**Windows / macOS 能用吗？**

理论上可以，代码中已经包含对应平台的 Chrome 路径查找。但当前版本只在 Linux 上实测过，Windows 和 macOS 尚未验证，请按上面的平台说明自行测试；遇到问题可加 `--debug` 排查。

**没有宋体会不会导出失败？**

不会。默认中文字体会按字体栈依次回退到其他宋体类字体或系统中文字体；只有系统完全没有中文字体时才可能显示方框，此时安装 `noto-fonts-cjk` 即可。

**自定义字体没有生效？**

先运行 `node index.mjs --list-fonts` 确认字体家族名称；指定的字体不存在时会自动回退到默认字体链。

**导出 0 题或提示接口失败**

确认 URL 是“答案解析”页面（包含 `/ti/exam/solution/`），而不是试卷页或练习页；加 `--debug` 后会保存现场 HTML、截图和提取结果便于排查。

**找不到导出的 PDF**

默认在项目目录的 `output/`，不是系统“下载”目录。仓库里看不到 `output/` 也正常：它首次导出时才创建，并且不会提交到 Git。查看终端最后打印的 `PDF：...` 绝对路径；如果用过 `--out`，则去指定目录。只运行 `--login` 不会生成 PDF。

**换电脑后需要重新登录**

`browser-profile/` 是本机登录状态，不随仓库同步，在新机器上重新 `--login` 即可。

## 隐私与安全

- 工具不会收集或上传任何数据，所有请求只发往粉笔和本地 Chrome
- 登录 Cookie 仅保存在本地 `browser-profile/`，该目录已在 `.gitignore` 中忽略
- 工具不保存、不脚本化账号密码，登录始终由你在浏览器中手动完成
- `browser-profile/`、`output/`、`debug/` 包含登录状态或试卷内容，请不要提交、分享或上传

## 免责声明

本工具仅用于个人学习与备份。请仅导出你已购买或有权访问的内容，并遵守粉笔的用户协议与版权规定。因使用本工具产生的任何后果由使用者自行承担。
