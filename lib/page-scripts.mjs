const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function preparePage(settings = {}) {
  const expand = settings.expand !== false;
  const scroll = settings.scroll !== false;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = (element) => {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  };
  const actionPattern = /(?:展开|显示|查看).{0,6}(?:解析|答案|详解)|(?:解析|答案).{0,3}(?:展开|显示)|全部展开|展开全部|文字解析/;
  const excluded = /收起|隐藏|折叠|会员|购买|解锁|开通|付费|充值|视频|笔记|评论|提问|纠错|分享|收藏|下载|打印/;
  const clicked = new WeakSet();
  let clickCount = 0;
  const startUrl = location.href;

  const safeAnchor = (element) => {
    const anchor = element.closest('a[href]');
    if (!anchor) return true;
    const raw = anchor.getAttribute('href') || '';
    if (!raw || raw === '#' || raw.startsWith('javascript:')) return true;
    try {
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin) return false;
      return url.pathname === location.pathname && url.search === location.search;
    } catch {
      return false;
    }
  };

  const clickTarget = (element) => {
    const target = element.closest('button, [role="button"], a, [class*="expand"], [class*="toggle"], [class*="open"]') || element;
    if (clicked.has(target)) return false;
    clicked.add(target);
    const before = location.href;
    try {
      target.click();
      if (location.href !== before) return false;
      return true;
    } catch {
      return false;
    }
  };

  const expandVisibleSections = async () => {
    let acted = 0;
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || seen.has(parent)) continue;
      const text = clean(node.nodeValue);
      if (!text || text.length > 28 || !actionPattern.test(text) || excluded.test(text)) continue;
      seen.add(parent);
      if (!visible(parent) || !safeAnchor(parent)) continue;
      if (clickTarget(parent)) {
        clickCount++;
        acted++;
        await wait(180);
      }
    }
    return acted;
  };

  let rounds = 0;
  while (expand && rounds < 4) {
    const acted = await expandVisibleSections();
    rounds++;
    if (!acted && rounds > 1) break;
    await wait(350);
  }

  let lastHeight = 0;
  let stable = 0;
  for (let step = 0; scroll && step < 260; step++) {
    const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
    window.scrollBy(0, Math.max(480, window.innerHeight * 0.85));
    await wait(150);
    const atBottom = window.scrollY + window.innerHeight >= height - 8;
    if (atBottom) {
      if (expand) await expandVisibleSections();
      await wait(300);
      const newHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
      if (newHeight <= lastHeight + 3) stable++;
      else stable = 0;
      lastHeight = newHeight;
      if (stable >= 2) break;
      window.scrollTo(0, newHeight);
      await wait(250);
    }
  }

  window.scrollTo(0, 0);
  await wait(250);
  return {
    expanded: clickCount,
    height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0),
    url: location.href,
    navigated: location.href !== startUrl,
  };
}

function goNextPage() {
  const visible = (element) => {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  };
  const disabled = (element, boundary) => {
    let node = element;
    while (node && node !== boundary?.parentElement) {
      const className = typeof node.className === 'string' ? node.className : '';
      if (/disabled|disable|forbid|banned/.test(className)) return true;
      if (node.disabled || node.getAttribute?.('aria-disabled') === 'true' || node.getAttribute?.('disabled') !== null) return true;
      if (node === boundary) break;
      node = node.parentElement;
    }
    return false;
  };

  const pagers = [...document.querySelectorAll('fb-pager, .fb-pager, [class*="pager"], [class*="pagination"]')]
    .filter((element) => visible(element));
  let pager = pagers.find((element) => element.querySelector('.houpage, .next, [class*="next"]')) || pagers[0];
  if (!pager) return { found: false, clicked: false, reason: 'no-pager' };

  const selectors = ['.houpage', '.next', '[class~="next"]', 'a[title*="下一页"]', 'button[title*="下一页"]'];
  let target = null;
  for (const selector of selectors) {
    target = [...pager.querySelectorAll(selector)].find(visible);
    if (target) break;
  }
  if (!target) {
    const candidates = [...pager.querySelectorAll('button, a, [role="button"], .page-item, li, span')];
    target = candidates.find((element) => visible(element) && /^(?:下一页|后一页|下一頁|›|»|>)$/.test((element.innerText || '').trim()));
  }

  const pagerText = (pager.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!target) return { found: true, clicked: false, reason: 'no-next', pagerText };
  if (disabled(target, pager)) return { found: true, clicked: false, reason: 'last-page', pagerText };

  try {
    target.click();
    return { found: true, clicked: true, pagerText };
  } catch (error) {
    return { found: true, clicked: false, reason: String(error?.message || error), pagerText };
  }
}

function getPageSignature() {
  const numbers = [];
  for (const element of document.querySelectorAll('a[name], [id^="question-"], [class*="question-num"]')) {
    const value = (element.getAttribute('name') || element.getAttribute('id') || element.innerText || '').match(/\d{1,4}/);
    if (value) numbers.push(value[0]);
  }
  const pager = document.querySelector('fb-pager, .fb-pager, [class*="pager"], [class*="pagination"]');
  const active = pager?.querySelector('.on, .active, [class*="active"], [class*="current"]');
  const firstSolution = document.querySelector('.solution-item .question-content, .question-content');
  return JSON.stringify({
    numbers: numbers.slice(0, 8),
    pager: (pager?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    active: (active?.innerText || '').trim(),
    stem: (firstSolution?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    count: document.querySelectorAll('.solution-item').length,
  });
}

function makePrintScript(html) {
  const literal = JSON.stringify(html)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `(() => {
    const html = ${literal};
    setTimeout(() => {
      document.open();
      document.write(html);
      document.close();
    }, 80);
    return true;
  })()`;
}

function printReadyState() {
  const marker = document.querySelector('meta[name="fenbi-print-ready"]');
  const images = [...document.images];
  return {
    ready: Boolean(marker),
    readyState: document.readyState,
    fonts: document.fonts?.status || 'unknown',
    totalImages: images.length,
    pendingImages: images.filter((image) => !image.complete).length,
    brokenImages: images.filter((image) => image.complete && image.naturalWidth === 0).length,
  };
}

export const prepareScript = `(${preparePage.toString()})({expand:true,scroll:true})`;
export function makePrepareScript({ expand = true, scroll = true } = {}) {
  return `(${preparePage.toString()})(${JSON.stringify({ expand, scroll })})`;
}
export const nextPageScript = `(${goNextPage.toString()})()`;
export const pageSignatureScript = `(${getPageSignature.toString()})()`;
export const printReadyScript = `(${printReadyState.toString()})()`;
export { makePrintScript, sleep };
