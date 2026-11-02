import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CANDIDATES = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/brave-browser',
  '/usr/bin/brave',
  '/usr/bin/microsoft-edge-stable',
  '/usr/bin/microsoft-edge',
  '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

function fromPath(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function findChrome(explicit) {
  const wanted = explicit || process.env.CHROME_PATH;
  if (wanted) {
    if (!existsSync(wanted)) {
      throw new Error(`找不到 Chrome/Chromium：${wanted}`);
    }
    return wanted;
  }
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  for (const name of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'brave', 'msedge']) {
    const found = fromPath(name);
    if (found) return found;
  }
  throw new Error('未找到 Chrome/Chromium。请安装浏览器，或用 --chrome /path/to/chrome 指定。');
}

async function fetchJson(url, timeout = 1500) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function openWebSocket(url, timeout = 10000) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      cleanup();
      try { ws.close(); } catch {}
      reject(new Error('连接 DevTools WebSocket 超时'));
    }, timeout);
    const cleanup = () => {
      clearTimeout(timer);
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
      ws.removeEventListener('close', onClose);
    };
    const onOpen = () => { cleanup(); resolve(ws); };
    const onError = () => { cleanup(); reject(new Error('无法连接 DevTools WebSocket')); };
    const onClose = () => { cleanup(); reject(new Error('DevTools WebSocket 在连接前关闭')); };
    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onError);
    ws.addEventListener('close', onClose);
  });
}

export class CDP {
  constructor(ws, label = 'CDP') {
    this.ws = ws;
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;
    ws.addEventListener('message', (event) => this._onMessage(event));
    ws.addEventListener('close', () => this._onClose());
    ws.addEventListener('error', () => {});
  }

  static async connect(url, label) {
    return new CDP(await openWebSocket(url), label);
  }

  _onMessage(event) {
    let message;
    try {
      const text = typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8');
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(`${this.label} ${pending.method}: ${message.error.message}`));
      } else {
        pending.resolve(message.result || {});
      }
      return;
    }
    if (message.method) {
      const handlers = this.handlers.get(message.method);
      if (!handlers) return;
      for (const handler of [...handlers]) {
        try { handler(message.params || {}); } catch {}
      }
    }
  }

  _onClose() {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`${this.label} 连接已关闭`));
    }
    this.pending.clear();
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set());
    this.handlers.get(method).add(handler);
    return () => this.handlers.get(method)?.delete(handler);
  }

  waitEvent(method, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (params) => {
        clearTimeout(timer);
        off();
        resolve(params);
      });
      const timer = setTimeout(() => {
        off();
        reject(new Error(`${this.label} 等待事件 ${method} 超时`));
      }, timeout);
    });
  }

  send(method, params = {}, timeout = 30000) {
    if (this.closed) return Promise.reject(new Error(`${this.label} 连接已关闭`));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.label} ${method} 超时（${timeout} ms）`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression, options = {}) {
    const { awaitPromise = true, timeout = 30000 } = options;
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    }, timeout);
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails;
      const description = detail.exception?.description || detail.text || '页面脚本执行失败';
      throw new Error(description);
    }
    return result.result?.value;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`${this.label} 连接已关闭`));
    }
    this.pending.clear();
    try { this.ws.close(); } catch {}
  }
}

export class ChromeSession {
  constructor({ proc, browser, page, executable, profileDir, port, stderr }) {
    this.proc = proc;
    this.browser = browser;
    this.page = page;
    this.executable = executable;
    this.profileDir = profileDir;
    this.port = port;
    this._stderr = stderr;
    this._exited = new Promise((resolve) => {
      if (proc.exitCode !== null) resolve(proc.exitCode);
      else proc.once('exit', resolve);
    });
    this.page.on('Page.javascriptDialogOpening', () => {
      this.page.send('Page.handleJavaScriptDialog', { accept: true }, 5000).catch(() => {});
    });
  }

  static async launch(options = {}) {
    const {
      chromePath,
      profileDir = path.join(process.cwd(), 'browser-profile'),
      headless = true,
      startupTimeout = 30000,
      env,
    } = options;
    const executable = findChrome(chromePath);
    mkdirSync(profileDir, { recursive: true });
    rmSync(path.join(profileDir, 'DevToolsActivePort'), { force: true });

    const args = [
      `--user-data-dir=${path.resolve(profileDir)}`,
      '--remote-debugging-port=0',
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-features=Translate',
      '--lang=zh-CN',
      '--window-size=1440,1000',
      'about:blank',
    ];
    if (headless) args.unshift('--headless=new');
    if (process.env.CHROME_NO_SANDBOX === '1') args.unshift('--no-sandbox');

    const proc = spawn(executable, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env,
    });
    let stderr = '';
    proc.stderr?.setEncoding('utf8');
    proc.stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-8000);
    });

    let exitCode = null;
    proc.once('exit', (code) => { exitCode = code; });
    const failTail = () => stderr.trim().split('\n').slice(-8).join('\n') || '（Chrome 没有输出错误信息）';
    const fail = (message) => {
      try { proc.kill('SIGTERM'); } catch {}
      throw new Error(`${message}\n${failTail()}`);
    };

    const portFile = path.join(profileDir, 'DevToolsActivePort');
    const deadline = Date.now() + startupTimeout;
    let port = 0;
    let browserPath = '';
    while (Date.now() < deadline) {
      if (exitCode !== null) fail(`Chrome 启动失败（退出码 ${exitCode}）。`);
      if (existsSync(portFile)) {
        try {
          const [portLine, wsLine] = readFileSync(portFile, 'utf8').split('\n');
          const parsedPort = Number.parseInt(portLine, 10);
          if (parsedPort > 0 && wsLine?.startsWith('/devtools/browser/')) {
            port = parsedPort;
            browserPath = wsLine.trim();
            break;
          }
        } catch {}
      }
      await sleep(150);
    }
    if (!port) fail('Chrome 已启动，但没有开放调试端口（可能浏览器拒绝启动）。');

    let browser;
    try {
      browser = await CDP.connect(`ws://127.0.0.1:${port}${browserPath}`, '浏览器');
    } catch (error) {
      fail(`无法连接 Chrome 调试端口：${error.message}`);
    }

    let pageInfo = null;
    const targetDeadline = Date.now() + 10000;
    while (Date.now() < targetDeadline) {
      try {
        const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
        pageInfo = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
        if (pageInfo) break;
      } catch {}
      await sleep(150);
    }
    if (!pageInfo) {
      try {
        pageInfo = await fetchJson(`http://127.0.0.1:${port}/json/new?about:blank`, 3000);
      } catch (error) {
        browser.close();
        fail(`无法创建浏览器页面：${error.message}`);
      }
    }
    if (!pageInfo?.webSocketDebuggerUrl) {
      browser.close();
      fail('Chrome 没有返回可用的页面调试地址。');
    }

    let page;
    try {
      page = await CDP.connect(pageInfo.webSocketDebuggerUrl, '页面');
      await page.send('Page.enable');
      await page.send('Runtime.enable');
    } catch (error) {
      browser.close();
      page?.close();
      fail(`无法初始化浏览器页面：${error.message}`);
    }

    return new ChromeSession({ proc, browser, page, executable, profileDir, port, stderr });
  }

  async navigate(url, options = {}) {
    const { timeout = 60000, settle = 900 } = options;
    const loadEvent = this.page.waitEvent('Page.loadEventFired', timeout).catch(() => null);
    const result = await this.page.send('Page.navigate', { url }, timeout);
    if (result.errorText) {
      throw new Error(`页面打开失败：${result.errorText}`);
    }
    await loadEvent;
    const deadline = Date.now() + Math.min(timeout, 15000);
    while (Date.now() < deadline) {
      try {
        if (await this.page.evaluate('document.readyState', { timeout: 3000 }) === 'complete') break;
      } catch {}
      await sleep(200);
    }
    if (settle > 0) await sleep(settle);
    return await this.url();
  }

  async url() {
    try {
      return await this.page.evaluate('location.href', { timeout: 5000 });
    } catch {
      return '';
    }
  }

  async evaluate(expression, options = {}) {
    return this.page.evaluate(expression, options);
  }

  async screenshot(filePath) {
    const { data } = await this.page.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    }, 30000);
    await writeFile(filePath, Buffer.from(data, 'base64'));
    return filePath;
  }

  async printToPDF(params = {}) {
    const { data } = await this.page.send('Page.printToPDF', params, 120000);
    return Buffer.from(data, 'base64');
  }

  async close() {
    try {
      await this.browser.send('Browser.close', {}, 3000);
    } catch {}
    this.browser.close();
    this.page.close();
    const timeout = sleep(3500).then(() => 'timeout');
    const outcome = await Promise.race([this._exited, timeout]);
    if (outcome === 'timeout') {
      try { this.proc.kill('SIGTERM'); } catch {}
      const term = await Promise.race([this._exited, sleep(2000).then(() => 'timeout')]);
      if (term === 'timeout') {
        try { this.proc.kill('SIGKILL'); } catch {}
      }
    }
  }
}
