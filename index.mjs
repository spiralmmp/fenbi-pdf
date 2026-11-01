#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { ChromeSession } from './lib/cdp.mjs';
import { fenbiExtractScript } from './lib/extract-fenbi.mjs';
import { fenbiApiExtractScript } from './lib/extract-fenbi-api.mjs';
import { genericExtractScript } from './lib/extract-generic.mjs';
import {
  makePrepareScript,
  nextPageScript,
  pageSignatureScript,
  printReadyScript,
  makePrintScript,
} from './lib/page-scripts.mjs';
import { buildFileName, makePdfOptions, renderHtml } from './lib/render.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(ROOT, 'browser-profile');
const LOGIN_MARKER = path.join(PROFILE_DIR, '.login-ok');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ENTRY = path.relative(process.cwd(), fileURLToPath(import.meta.url)) || 'index.mjs';
const RUN_COMMAND = `node ${/\s/.test(ENTRY) ? `"${ENTRY}"` : ENTRY}`;
let currentSession = null;
let shuttingDown = false;

function printHelp() {
  console.log(`粉笔试卷解析导出工具

仅用于导出本人已购买或有权访问的试卷内容，不会绕过会员、付费或登录限制。
PDF 按题号整理，仅包含答案和解析，不包含题干、选项和材料。

用法：
  ${RUN_COMMAND} <答案解析页面URL>
  ${RUN_COMMAND} --login [答案解析页面URL]
  ${RUN_COMMAND} <答案解析页面URL> --headless

选项：
  --login            打开浏览器完成登录后退出（带 URL 时登录后继续导出）
  --headless         使用无头浏览器（首次登录必须使用可见浏览器）
  --out <目录>       PDF 输出目录，默认 ./output
  --title <名称>     自定义 PDF 标题
  --wait <毫秒>      页面打开后的额外等待时间，默认 500
  --max-pages <数量> 最多翻页数，默认 60
  --chrome <路径>    指定 Chrome/Chromium 可执行文件
  --no-expand        不自动点击“展开解析”等按钮
  --no-pagination    只导出当前页
  --no-api           不使用粉笔接口提取，仅解析页面
  --debug            保存 HTML、截图和提取结果到 ./debug/<时间>
  -h, --help         显示帮助

首次使用：
  直接运行工具，按提示粘贴试卷的“答案解析页面”链接（地址栏中包含
  /ti/exam/solution/ 的页面）。未登录时会先打开粉笔首页，请手动完成登录，
  再回到终端按回车；登录状态保存在 browser-profile/ 中。
  该目录包含登录 Cookie，请勿分享或上传。
  注意：未登录时直接打开解析页可能显示 about:blank，这是粉笔的页面行为。

示例：
  ${RUN_COMMAND} "https://spa.fenbi.com/ti/exam/solution/..." --out ~/Documents/fenbi
  ${RUN_COMMAND} --login
`);
}

function parseArgs(argv) {
  const options = {
    url: '',
    login: false,
    headless: false,
    debug: false,
    expand: true,
    pagination: true,
    api: true,
    wait: 500,
    maxPages: 60,
    out: path.join(ROOT, 'output'),
    title: '',
    chrome: '',
    help: false,
  };
  const positionals = [];
  const readValue = (inline, argvList, index, flag) => {
    if (inline !== undefined) {
      if (!inline) throw new Error(`${flag} 需要参数。`);
      return inline;
    }
    const value = argvList[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} 需要参数。`);
    return value;
  };
  const integer = (value, flag, min, max) => {
    if (!/^\d+$/.test(value)) throw new Error(`${flag} 需要整数。`);
    const number = Number(value);
    if (number < min || number > max) throw new Error(`${flag} 的范围是 ${min} 到 ${max}。`);
    return number;
  };

  for (let index = 0; index < argv.length; index++) {
    const original = argv[index];
    let token = original;
    let inline;
    if (token.startsWith('--') && token.includes('=')) {
      const split = token.indexOf('=');
      inline = token.slice(split + 1);
      token = token.slice(0, split);
    }
    const booleanFlag = () => {
      if (inline !== undefined) throw new Error(`${token} 不接受参数。`);
    };
    switch (token) {
      case '--login':
        booleanFlag();
        options.login = true;
        break;
      case '--headless':
        booleanFlag();
        options.headless = true;
        break;
      case '--debug':
        booleanFlag();
        options.debug = true;
        break;
      case '--no-expand':
        booleanFlag();
        options.expand = false;
        break;
      case '--no-pagination':
        booleanFlag();
        options.pagination = false;
        break;
      case '--no-api':
        booleanFlag();
        options.api = false;
        break;
      case '--out':
        options.out = path.resolve(process.cwd(), readValue(inline, argv, index, token));
        if (inline === undefined) index++;
        break;
      case '--title':
        options.title = readValue(inline, argv, index, token);
        if (inline === undefined) index++;
        break;
      case '--wait':
        options.wait = integer(readValue(inline, argv, index, token), token, 0, 120000);
        if (inline === undefined) index++;
        break;
      case '--max-pages':
        options.maxPages = integer(readValue(inline, argv, index, token), token, 1, 200);
        if (inline === undefined) index++;
        break;
      case '--chrome':
        options.chrome = readValue(inline, argv, index, token);
        if (inline === undefined) index++;
        break;
      case '-h':
      case '--help':
        booleanFlag();
        options.help = true;
        break;
      default:
        if (token.startsWith('-')) throw new Error(`未知选项：${original}`);
        positionals.push(original);
        break;
    }
  }

  if (positionals.length > 1) {
    throw new Error('一次只能处理一个答案解析页面 URL。');
  }
  options.url = positionals[0] || '';
  return options;
}

function normalizeUrl(input) {
  let text = String(input || '').trim();
  if (!text) throw new Error('URL 不能为空。');
  const embedded = text.match(/(?:https?|file):\/\/[^\s<>"']+/i);
  if (embedded) text = embedded[0];
  text = text.replace(/[)\]}>，。；;、]+$/g, '');
  if (!/^(?:https?|file):\/\//i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`无法识别的 URL：${text}`);
  }
  if (!['http:', 'https:', 'file:'].includes(url.protocol)) {
    throw new Error('只支持 http、https 或 file URL。');
  }
  return url.href;
}

function isFenbiUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'fenbi.com' || host.endsWith('.fenbi.com');
  } catch {
    return false;
  }
}

async function ask(question) {
  if (!process.stdin.isTTY) throw new Error('当前环境不是交互终端，无法等待输入。');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function extractCurrentPage(session, preferredEngine) {
  const errors = [];
  let fenbi = null;
  let generic = null;

  if (preferredEngine !== 'generic') {
    try {
      fenbi = await session.evaluate(fenbiExtractScript, { timeout: 180000 });
    } catch (error) {
      errors.push(`粉笔结构化提取失败：${error.message}`);
    }
  }

  const fenbiQuestions = fenbi?.questions || [];
  const fenbiHasAnalysis = fenbiQuestions.some((question) => question.analyses?.length);
  let shouldTryGeneric = false;
  if (preferredEngine === 'generic') shouldTryGeneric = true;
  else if (preferredEngine === 'fenbi') shouldTryGeneric = fenbiQuestions.length === 0;
  else shouldTryGeneric = fenbiQuestions.length === 0 || !fenbiHasAnalysis;

  if (shouldTryGeneric) {
    try {
      generic = await session.evaluate(genericExtractScript, { timeout: 180000 });
    } catch (error) {
      errors.push(`通用提取失败：${error.message}`);
    }
  }

  const genericQuestions = generic?.questions || [];
  const genericHasAnalysis = genericQuestions.some((question) => question.analyses?.length);
  let chosen = null;
  if (preferredEngine === 'generic') {
    chosen = genericQuestions.length ? generic : fenbi;
  } else if (preferredEngine === 'fenbi') {
    chosen = fenbiQuestions.length ? fenbi : (genericQuestions.length ? generic : fenbi);
  } else if (!fenbiQuestions.length) {
    chosen = genericQuestions.length ? generic : fenbi;
  } else if (!fenbiHasAnalysis && genericQuestions.length && genericHasAnalysis) {
    chosen = generic;
  } else {
    chosen = fenbi;
  }

  if (!chosen && errors.length) {
    throw new Error(errors.join('\n'));
  }
  return { result: chosen, errors };
}

function stemSignature(question) {
  return String(question.stem?.text || '')
    .replace(/\s+/g, '')
    .slice(0, 90);
}

function pageFingerprint(questions) {
  return questions.map((question) => `${question.number}:${stemSignature(question)}`).join('|');
}

function questionWeight(question) {
  const analysisLength = (question.analyses || []).reduce((sum, section) => sum + (section.text || '').length, 0);
  const extraLength = (question.extras || []).reduce((sum, section) => sum + (section.text || '').length, 0);
  return analysisLength + extraLength + (question.options?.length || 0) * 20 +
    (question.stem?.text?.length || 0) + (question.material?.text?.length || 0);
}

function mergeQuestions(pageEntries) {
  const merged = [];
  const map = new Map();
  let order = 0;
  let duplicates = 0;
  for (const entry of pageEntries) {
    for (const question of entry.result.questions) {
      const identity = stemSignature(question) || String(question.answer || '') || `empty-${entry.page}-${order}`;
      const key = `${question.number}|${identity}`;
      const existing = map.get(key);
      if (existing) {
        duplicates++;
        if (questionWeight(question) > questionWeight(existing)) {
          const number = existing.number;
          const firstOrder = existing._order;
          Object.assign(existing, question, { number, _order: firstOrder });
        }
        continue;
      }
      const copy = { ...question, _order: order++ };
      map.set(key, copy);
      merged.push(copy);
    }
  }
  merged.sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0) || a._order - b._order);
  return { questions: merged, duplicates };
}

async function waitForPageChange(session, beforeSignature, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await sleep(600);
    try {
      const signature = await session.evaluate(pageSignatureScript, { timeout: 5000 });
      if (signature && signature !== beforeSignature) return true;
    } catch {}
  }
  return false;
}

function createDebugDirectory() {
  const base = path.join(ROOT, 'debug');
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  let directory = path.join(base, stamp);
  let suffix = 2;
  while (existsSync(directory)) directory = path.join(base, `${stamp}-${suffix++}`);
  return mkdir(directory, { recursive: true }).then(() => directory);
}

async function capturePageDebug(session, directory, pageNumber, result, snapshot = false) {
  const prefix = path.join(directory, `page-${String(pageNumber).padStart(2, '0')}`);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(`${prefix}.json`, JSON.stringify({
      url: await session.url().catch(() => ''),
      result,
    }, null, 2));
    if (!snapshot) return;
    await session.screenshot(`${prefix}.png`).catch(() => {});
    const html = await session.evaluate('document.documentElement.outerHTML', { timeout: 30000 }).catch(() => '');
    if (html) await writeFile(`${prefix}.html`, html);
  } catch (error) {
    console.warn(`调试信息保存失败：${error.message}`);
  }
}

async function printHtmlToPdf(session, html, filePath) {
  await session.evaluate(makePrintScript(html), { timeout: 30000 });
  await sleep(350);
  let state = null;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      state = await session.evaluate(printReadyScript, { timeout: 5000 });
      if (state?.ready && state.readyState === 'complete' && state.fonts !== 'loading' && state.pendingImages === 0) {
        break;
      }
    } catch {}
    await sleep(350);
  }
  if (!state?.ready) {
    throw new Error('打印页面准备失败，已停止以免导出错误内容。');
  }
  await sleep(250);
  const pdf = await session.printToPDF(makePdfOptions());
  if (pdf.subarray(0, 4).toString() !== '%PDF') {
    throw new Error('浏览器返回的 PDF 数据无效。');
  }
  await writeFile(filePath, pdf);
  return { pdf, state };
}

function uniqueOutputPath(directory, fileName) {
  let candidate = path.join(directory, fileName);
  if (!existsSync(candidate)) return candidate;
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  for (let index = 2; index < 1000; index++) {
    candidate = path.join(directory, `${base}-${index}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error('无法生成不重复的输出文件名。');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function pageInfo(session) {
  let finalUrl = '';
  let title = '';
  try { finalUrl = await session.url(); } catch {}
  try { title = await session.evaluate('document.title', { timeout: 5000 }); } catch {}
  return { finalUrl, title };
}

function isBlankPage(info) {
  return !info.finalUrl || /^about:blank(?:[#?]|$)/i.test(info.finalUrl);
}

async function saveLoginMarker() {
  await mkdir(PROFILE_DIR, { recursive: true });
  await writeFile(LOGIN_MARKER, `${new Date().toISOString()}\n`);
}

async function buildNoQuestionsError(session, extraction, debugDirectory, sourceUrl = '') {
  const info = await pageInfo(session);
  const loginLikely = /login|passport|signin|account/i.test(info.finalUrl) || /登录|扫码/.test(info.title || '');
  const loginCommand = sourceUrl ? `${RUN_COMMAND} --login "${sourceUrl}"` : `${RUN_COMMAND} --login`;
  const error = new Error('没有从页面中提取到任何题目。');
  const lines = [];
  if (isBlankPage(info)) {
    lines.push('粉笔把页面跳转到了 about:blank，通常表示尚未登录或登录已过期。');
    lines.push('请重新运行登录（登录页会打开粉笔首页，而不是试卷页）：');
    lines.push(loginCommand);
    lines.push('在首页完成登录、确认能看到账号信息后，再回到终端按回车。');
  } else if (loginLikely) {
    lines.push('页面看起来停留在登录界面。请重新运行登录：');
    lines.push(loginCommand);
  } else {
    lines.push('请确认链接是试卷的“答案解析页面”，而不是答题页、首页或已失效的分享页。');
    lines.push('如果页面确实需要登录，或登录已过期，请运行：');
    lines.push(loginCommand);
    lines.push('本工具只导出当前账户可见的内容，不会绕过会员或付费限制。');
  }
  if (extraction?.errors?.length) lines.push(`提取错误：${extraction.errors.join('；')}`);
  if (debugDirectory) lines.push(`调试文件：${debugDirectory}`);
  error.hint = lines.join('\n');
  return error;
}

function reportFailure(error, options) {
  console.error('');
  console.error(`错误：${error.message}`);
  if (error.hint) {
    console.error('');
    console.error(error.hint);
  } else if (/Chrome|调试端口|DevTools/.test(error.message)) {
    console.error('');
    console.error('请确认 Chrome/Chromium 已安装，且没有其他程序占用同一个 browser-profile。');
  } else if (!options?.help) {
    console.error(`如需排查，可加 --debug 重试；使用 ${RUN_COMMAND} --help 查看全部选项。`);
  }
  if (options?.debug && error.stack) {
    console.error('');
    console.error(error.stack);
  }
}

async function exportPaper(session, url, options, context = {}) {
  const { loginFlow = false } = context;
  let debugDirectory = null;
  if (options.debug) {
    debugDirectory = await createDebugDirectory();
    console.log(`调试目录：${debugDirectory}`);
  }

  console.log(`正在打开：${url}`);
  await session.navigate(url, { timeout: 90000, settle: 1200 });
  if (options.wait) await sleep(options.wait);
  let opened = await pageInfo(session);
  if (loginFlow && isBlankPage(opened)) {
    await sleep(1500);
    opened = await pageInfo(session);
  }
  if (loginFlow && isBlankPage(opened)) {
    const error = new Error('登录后试卷页仍然跳转到了 about:blank。');
    error.hint = [
      '这说明登录尚未完成，或登录状态没有生效。',
      '请重新运行：',
      `${RUN_COMMAND} --login "${url}"`,
      '在打开的粉笔首页完成登录（确认能看到账号信息或题库），再回到终端按回车。',
    ].join('\n');
    throw error;
  }
  if (opened.finalUrl && opened.finalUrl !== url) {
    console.log(`页面地址：${opened.finalUrl}`);
  }

  const fenbi = isFenbiUrl(url);
  const finalAddress = opened.finalUrl || url;
  const strictApi = (() => {
    try {
      const parsed = new URL(finalAddress);
      return /^spa\.fenbi\.com$/i.test(parsed.hostname) && /^\/ti\/exam\/solution\//i.test(parsed.pathname);
    } catch {
      return false;
    }
  })();
  const pageEntries = [];
  const fingerprints = [];
  const warningSet = new Set();
  let engine = null;
  let title = '';
  let pageNumber = 1;
  let apiUsed = false;

  if (fenbi && options.api && !isBlankPage(opened)) {
    console.log('正在尝试粉笔接口提取...');
    let apiResult = null;
    try {
      apiResult = await session.evaluate(fenbiApiExtractScript, { timeout: 30000 });
    } catch (error) {
      if (options.debug) console.log(`接口提取失败：${error.message}`);
    }
    const apiQuestions = apiResult?.ok ? (apiResult.questions || []) : [];
    const meaningful = apiQuestions.filter((question) => question.answer || question.analyses?.length);
    if (meaningful.length) {
      apiUsed = true;
      engine = 'fenbi-api';
      title = apiResult.title || '';
      for (const warning of apiResult.warnings || []) warningSet.add(warning);
      pageEntries.push({
        page: 1,
        result: { engine, title, questions: apiQuestions, warnings: apiResult.warnings || [] },
        warnings: [],
      });
      console.log(`接口提取：${apiQuestions.length} 题。`);
    } else if (strictApi) {
      const error = new Error('未能从粉笔接口读取到答案和解析，已停止以免导出错误内容。');
      error.hint = [
        `接口原因：${apiResult?.reason || '返回内容为空'}`,
        '请确认登录状态仍有效，或加 --debug 重试。',
        '新版粉笔页面用页面解析可能把推荐题也混进来；确需尝试可加 --no-api。',
      ].join('\n');
      throw error;
    } else if (options.debug) {
      console.log(`接口不可用：${apiResult?.reason || '返回内容为空'}，改用页面提取。`);
    }
  }

  while (!apiUsed) {
    console.log(pageNumber === 1 ? '正在展开并读取当前页...' : `正在读取第 ${pageNumber} 页...`);
    let prepared = null;
    try {
      prepared = await session.evaluate(makePrepareScript({ expand: options.expand, scroll: true }), { timeout: 300000 });
    } catch (error) {
      warningSet.add(`页面预处理未完整完成：${error.message}`);
    }
    if (pageNumber === 1 && prepared?.expanded) {
      console.log(`已自动展开 ${prepared.expanded} 处内容。`);
    }
    if (prepared?.navigated) {
      warningSet.add('自动展开时页面发生了跳转，请检查导出内容是否完整。');
    }

    let extraction = await extractCurrentPage(session, engine);
    if (!extraction.result?.questions?.length) {
      await sleep(1200);
      extraction = await extractCurrentPage(session, engine);
    }
    const questions = extraction.result?.questions || [];
    if (!questions.length) {
      if (pageNumber === 1) {
        if (!debugDirectory) debugDirectory = await createDebugDirectory();
        await capturePageDebug(session, debugDirectory, pageNumber, extraction.result, true);
        throw await buildNoQuestionsError(session, extraction, debugDirectory, url);
      }
      warningSet.add(`第 ${pageNumber} 页没有提取到题目，已停止翻页并保留前面页面的内容。`);
      break;
    }

    if (!engine) {
      engine = extraction.result.engine;
      if (fenbi && engine === 'generic') {
        console.log('未命中粉笔结构化结构，已切换到通用页面提取。');
      }
    } else if (extraction.result.engine !== engine) {
      warningSet.add(`第 ${pageNumber} 页使用了备用提取模式。`);
    }
    if (extraction.result.title) title ||= extraction.result.title;
    for (const warning of extraction.result.warnings || []) warningSet.add(warning);

    const fingerprint = pageFingerprint(questions);
    if (pageNumber > 1 && fingerprints.includes(fingerprint)) {
      warningSet.add('翻页后页面内容没有变化，已停止以避免重复导出。');
      break;
    }
    fingerprints.push(fingerprint);
    pageEntries.push({ page: pageNumber, result: extraction.result, warnings: extraction.errors });
    if (options.debug && debugDirectory) {
      await capturePageDebug(session, debugDirectory, pageNumber, extraction.result, pageNumber === 1);
    }
    console.log(`第 ${pageNumber} 页：${questions.length} 题。`);

    if (!options.pagination) break;
    if (pageEntries.length >= options.maxPages) {
      warningSet.add(`已达到 --max-pages 上限（${options.maxPages} 页），未继续检查后续页面。`);
      break;
    }

    let beforeSignature = '';
    try {
      beforeSignature = await session.evaluate(pageSignatureScript, { timeout: 5000 });
    } catch {}
    let next;
    try {
      next = await session.evaluate(nextPageScript, { timeout: 10000 });
    } catch (error) {
      warningSet.add(`翻页失败：${error.message}`);
      break;
    }
    if (!next?.clicked) {
      if (next?.reason && !['last-page', 'no-pager', 'no-next'].includes(next.reason)) {
        warningSet.add(`没有继续翻页：${next.reason}`);
      }
      break;
    }
    console.log('正在翻到下一页...');
    const changed = await waitForPageChange(session, beforeSignature);
    if (!changed) {
      warningSet.add('点击翻页后没有检测到内容变化，已停止。若页面正在加载，可增大 --wait 后重试。');
      break;
    }
    await sleep(700);
    pageNumber++;
  }

  const { questions, duplicates } = mergeQuestions(pageEntries);
  if (duplicates) warningSet.add(`合并时去除了 ${duplicates} 道重复题。`);
  const numberCounts = new Map();
  for (const question of questions) numberCounts.set(question.number, (numberCounts.get(question.number) || 0) + 1);
  const repeatedNumbers = [...numberCounts].filter(([, count]) => count > 1).map(([number]) => number);
  if (repeatedNumbers.length) {
    warningSet.add(`检测到重复题号：${repeatedNumbers.slice(0, 10).join('、')}${repeatedNumbers.length > 10 ? ' 等' : ''}。`);
  }
  if (!questions.length) {
    throw new Error('翻页后没有得到可导出的题目。');
  }
  questions.forEach((question) => { delete question._order; });

  const finalTitle = (context.title || options.title).trim() || title.trim() || '粉笔试卷解析';
  const generatedAt = new Date();
  const html = renderHtml({
    title: finalTitle,
    questions,
    url,
    generatedAt,
    engine,
  });

  await mkdir(options.out, { recursive: true });
  const pdfPath = uniqueOutputPath(options.out, buildFileName(finalTitle, generatedAt));

  if (debugDirectory) {
    await writeFile(path.join(debugDirectory, 'extracted.json'), JSON.stringify({
      sourceUrl: url,
      finalUrl: opened.finalUrl,
      title: finalTitle,
      engine,
      generatedAt: generatedAt.toISOString(),
      questions,
      warnings: [...warningSet],
    }, null, 2));
    await writeFile(path.join(debugDirectory, 'print.html'), html);
  }

  console.log('正在排版并生成 PDF...');
  let printInfo;
  try {
    printInfo = await printHtmlToPdf(session, html, pdfPath);
  } catch (error) {
    if (debugDirectory) await writeFile(path.join(debugDirectory, 'print.html'), html);
    throw error;
  }
  if (printInfo.state?.pendingImages) {
    warningSet.add(`${printInfo.state.pendingImages} 张图片在打印前仍未加载完成，PDF 中可能显示空白。`);
  }
  if (printInfo.state?.brokenImages) {
    warningSet.add(`${printInfo.state.brokenImages} 张图片加载失败，相关图片可能缺失。`);
  }

  const analysisCount = questions.filter((question) => question.analyses?.length).length;
  console.log('');
  console.log(`完成：${questions.length} 题，${analysisCount} 题含解析。`);
  console.log(`PDF：${pdfPath}`);
  console.log(`大小：${formatBytes(printInfo.pdf.length)}`);
  if (warningSet.size) {
    console.log('');
    console.log('注意：');
    for (const warning of warningSet) console.log(`- ${warning}`);
  }
  if (debugDirectory) console.log(`调试文件：${debugDirectory}`);

  return {
    url,
    finalUrl: opened.finalUrl,
    title: finalTitle,
    engine,
    questionCount: questions.length,
    analysisCount,
    warnings: [...warningSet],
    pdfPath,
    pdfSize: printInfo.pdf.length,
  };
}

async function main() {
  let options;

  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }
    if (typeof WebSocket === 'undefined') {
      throw new Error('当前 Node.js 不支持 WebSocket，请升级到 Node.js 22 或更高版本。');
    }
    if (options.url) options.url = normalizeUrl(options.url);
    if (!options.url && !options.login) {
      options.url = normalizeUrl(await ask('请输入粉笔试卷“答案解析页面”的 URL：'));
    }

    const fenbi = Boolean(options.url) && isFenbiUrl(options.url);
    if (options.url && !fenbi && !options.url.startsWith('file:')) {
      console.log('提示：这不是粉笔域名，将尝试使用通用页面提取。');
    }
    const loginFlow = options.login || (fenbi && !existsSync(LOGIN_MARKER));
    let headless = options.headless;
    if (loginFlow) {
      if (!process.stdin.isTTY) {
        throw new Error('登录需要在交互终端中完成，无法在非交互环境打开登录流程。');
      }
      if (headless) {
        console.warn('登录流程需要可见浏览器，本次已忽略 --headless。');
        headless = false;
      }
    }

    console.log('正在启动浏览器...');
    currentSession = await ChromeSession.launch({
      profileDir: PROFILE_DIR,
      headless,
      chromePath: options.chrome || undefined,
    });
    const session = currentSession;

    if (loginFlow) {
      console.log('正在打开粉笔首页（登录入口）...');
      await session.navigate('https://www.fenbi.com/', { timeout: 90000, settle: 1500 }).catch((error) => {
        console.warn(`登录页打开不完整：${error.message}`);
      });
      if (isBlankPage(await pageInfo(session))) {
        throw new Error('粉笔首页仍显示 about:blank，请检查网络或代理设置后重试。');
      }
      console.log('');
      console.log('请在弹出的浏览器中完成登录（扫码或账号密码）。');
      console.log('登录成功、能看到自己的题库后，回到本终端按回车继续。');
      await ask('登录完成后按回车：');
      if (!options.url) {
        await saveLoginMarker();
        console.log('登录状态已保存在本地浏览器配置中。');
        console.log(`如需导出，请运行：${RUN_COMMAND} "<答案解析页面URL>"`);
        return;
      }
      await sleep(400);
    }

    await exportPaper(session, options.url, options, {
      loginFlow,
      title: options.title,
    });
    if (loginFlow && !existsSync(LOGIN_MARKER)) {
      await saveLoginMarker();
      console.log('登录状态已保存在本地浏览器配置中。');
    }
  } catch (error) {
    reportFailure(error, options);
    process.exitCode = 1;
  } finally {
    if (currentSession) {
      try {
        await currentSession.close();
      } catch {}
      currentSession = null;
    }
  }
}

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`\n收到 ${signal}，正在关闭浏览器...`);
  try { await currentSession?.close(); } catch {}
  process.exit(130);
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

await main();
