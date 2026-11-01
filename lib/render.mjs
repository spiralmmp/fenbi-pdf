const DEFAULT_LATIN_FONTS = ['Times New Roman', 'Liberation Serif', 'Nimbus Roman'];
const DEFAULT_LABEL_FONTS = [
  'SimHei',
  '黑体',
  'Heiti SC',
  'STHeiti',
  'Microsoft YaHei',
  'PingFang SC',
  'Source Han Sans SC',
  'Noto Sans CJK SC',
  'WenQuanYi Micro Hei',
];
const DEFAULT_CJK_FONTS = [
  'SimSun',
  '宋体',
  'NSimSun',
  '新宋体',
  'Songti SC',
  'Songti TC',
  'STSong',
  'Source Han Serif SC',
  'Source Han Serif CN',
  'Noto Serif CJK SC',
  'Noto Serif SC',
  'AR PL UMing CN',
  'AR PL UMing TW',
  'AR PL SungtiL GB',
  'Microsoft YaHei',
  'PingFang SC',
  'Noto Sans CJK SC',
  'WenQuanYi Micro Hei',
];

function escapeCssString(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\3c ')
    .replace(/>/g, '\\3e ')
    .replace(/\r?\n/g, '\\a ');
}

function buildLabelFontStack() {
  return [...DEFAULT_LABEL_FONTS.map((name) => `"${escapeCssString(name)}"`), 'sans-serif'].join(', ');
}

function buildFontStack({ fontLatin, fontCn } = {}) {
  const families = [];
  const add = (name) => {
    const value = String(name || '').trim();
    if (!value || /[<>"\r\n\u0000-\u001f]/.test(value)) return;
    if (!families.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      families.push(value);
    }
  };
  add(fontLatin);
  DEFAULT_LATIN_FONTS.forEach(add);
  add(fontCn);
  DEFAULT_CJK_FONTS.forEach(add);
  return [...families.map((name) => `"${escapeCssString(name)}"`), 'serif', 'sans-serif'].join(', ');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToParagraphs(text) {
  const lines = String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
}

const ELLIPSIS_PATTERN = /[\u00b7\u2022\u30fb\uff65\u22c5]{2,}/g;

function normalizeEllipsis(html) {
  return String(html || '').replace(ELLIPSIS_PATTERN, '……');
}

function contentHtml(part) {
  if (!part) return '';
  if (part.html && part.html.trim()) return normalizeEllipsis(part.html);
  if (part.text) return textToParagraphs(normalizeEllipsis(part.text));
  return '';
}

function hasVisibleContent(html) {
  return /<img\b/i.test(html) ||
    String(html || '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, '')
      .length > 0;
}

function splitFinalAnswer(html) {
  const pattern = /故(?:本题)?正确答案(?:为|是)[^<。！？\n]{1,40}(?:[。！？]|$)/g;
  return String(html || '').replace(/<p(\s[^>]*)?>([\s\S]*?)<\/p>/gi, (match, attributes, inner) => {
    const matches = [...inner.matchAll(pattern)];
    if (!matches.length) return match;
    const last = matches[matches.length - 1];
    const start = last.index;
    const end = start + last[0].length;
    let before = inner.slice(0, start).trim();
    const finalSentence = inner.slice(start, end).trim();
    const rest = inner.slice(end).trim();
    if (/本题为选非题[，,。；;：:]?\s*$/.test(before)) {
      before = before.replace(/[，,；;：:]\s*$/, '。');
      if (!/[。！？]$/.test(before)) before += '。';
    }
    const hasBefore = hasVisibleContent(before);
    const hasRest = hasVisibleContent(rest);
    if (!hasBefore && !hasRest) return match;

    const paragraphs = [];
    if (hasBefore) paragraphs.push(`<p${attributes || ''}>${before}</p>`);
    paragraphs.push(`<p${attributes || ''}>${finalSentence}</p>`);
    if (hasRest) paragraphs.push(`<p${attributes || ''}>${rest}</p>`);
    return paragraphs.join('');
  });
}

function normalizeSelectionNote(html) {
  const source = String(html || '');
  const paragraphPattern = /<p(\s[^>]*)?>([\s\S]*?)<\/p>/gi;
  const textOf = (inner) => inner
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, '')
    .trim();

  const tokens = [];
  let cursor = 0;
  let match;
  while ((match = paragraphPattern.exec(source))) {
    if (match.index > cursor) tokens.push({ type: 'text', raw: source.slice(cursor, match.index) });
    tokens.push({
      type: 'p',
      attributes: match[1] || '',
      inner: match[2],
      raw: match[0],
    });
    cursor = paragraphPattern.lastIndex;
  }
  if (cursor < source.length) tokens.push({ type: 'text', raw: source.slice(cursor) });
  if (!tokens.some((token) => token.type === 'p')) return source;

  const answerIndex = tokens.findLastIndex((token) =>
    token.type === 'p' && /故(?:本题)?正确答案(?:为|是)/.test(textOf(token.inner))
  );
  if (answerIndex < 0) return source;

  const notePattern = /(?:^|(?<=[。！？；;，,]))\s*((?:综上[，,]\s*)?本题为选非题)[，,。；;：:]?/;
  const findNote = (token) => {
    if (token.type !== 'p') return null;
    const found = token.inner.match(notePattern);
    return found ? { index: found.index, raw: found[0], text: found[1] } : null;
  };

  let noteTokenIndex = -1;
  let note = null;
  for (let index = answerIndex - 1; index >= 0; index--) {
    note = findNote(tokens[index]);
    if (note) {
      noteTokenIndex = index;
      break;
    }
  }
  if (!note) {
    for (let index = answerIndex + 1; index < tokens.length; index++) {
      note = findNote(tokens[index]);
      if (note) {
        noteTokenIndex = index;
        break;
      }
    }
  }
  if (!note) return source;

  const noteToken = tokens[noteTokenIndex];
  let noteSentence = note.text.trim().replace(/[，,；;：:]\s*$/, '。');
  if (!/[。！？]$/.test(noteSentence)) noteSentence += '。';

  let remaining = (noteToken.inner.slice(0, note.index) + noteToken.inner.slice(note.index + note.raw.length)).trim();
  if (remaining && /[，,；;：:]\s*$/.test(remaining)) {
    remaining = remaining.replace(/[，,；;：:]\s*$/, '。');
  }
  if (hasVisibleContent(remaining)) {
    noteToken.inner = remaining;
    noteToken.raw = `<p${noteToken.attributes}>${remaining}</p>`;
  } else {
    noteToken.removed = true;
  }

  const noteRaw = `<p${tokens[answerIndex].attributes}>${noteSentence}</p>`;
  const result = [];
  tokens.forEach((token, index) => {
    if (index === answerIndex) result.push({ type: 'p', raw: noteRaw });
    if (!token.removed) result.push(token);
  });
  return result.map((token) => token.raw).join('');
}

function normalizeBracketLabels(html) {
  return String(html || '').replace(/【([^【】<>]{1,24})】|〔([^〔〕<>]{1,24})〕|〖([^〖〗<>]{1,24})〗/g, (match, a, b, c) => {
    const inner = a ?? b ?? c ?? '';
    return `<span class="inline-label"><span class="label-bracket">【</span><span class="label-text">${escapeHtml(inner)}</span><span class="label-bracket">】</span></span>`;
  });
}

function bracketLabel(label) {
  const raw = String(label || '').trim();
  const inner = raw.replace(/^【([\s\S]*)】$/, '$1').replace(/^〔([\s\S]*)〕$/, '$1').replace(/^〖([\s\S]*)〗$/, '$1');
  return `<span class="label-bracket">【</span><span class="label-text">${escapeHtml(inner || raw)}</span><span class="label-bracket">】</span>`;
}

function prefixSectionLabel(html, label) {
  const body = String(html || '').trim();
  if (!body) return '';
  const labelHtml = `<span class="section-label">${bracketLabel(label)}</span>`;
  const opening = body.match(/^<p(?:\s[^>]*)?>/i);
  if (!opening) return `<p>${labelHtml}</p>${body}`;
  return `${opening[0]}${labelHtml}${body.slice(opening[0].length)}`;
}

function inlineText(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function answerText(text) {
  return escapeHtml(text)
    .replace(/(（[^）]*）|\([^)]*\))/g, '<span class="answer-paren">$1</span>')
    .replace(/\n/g, '<br>');
}

function sectionHtml(section, className) {
  const body = normalizeBracketLabels(normalizeSelectionNote(splitFinalAnswer(contentHtml(section))));
  if (!body) return '';
  const rawLabel = String(section.label || '解析').trim() || '解析';
  const label = /^[【〔〖].*[】〕〗]$/.test(rawLabel) ? rawLabel : `【${rawLabel}】`;
  return `<section class="solution-section ${className}">
    <div class="section-body prose">${prefixSectionLabel(body, label)}</div>
  </section>`;
}

function renderQuestion(question, position) {
  const number = question.number ?? position;
  const answer = question.answer || '未识别';
  const analyses = (question.analyses || []).map((section) => sectionHtml(section, 'analysis')).join('');
  const source = question.source ? inlineText(question.source) : '';
  const sourceLine = source
    ? `<p class="source-line"><span class="inline-label"><span class="label-bracket">【</span><span class="source-label">来源</span><span class="label-bracket">】</span></span>${source}</p>`
    : '';

  return `<article class="question">
    <div class="qa-line${question.answer ? '' : ' missing'}">
      <span class="question-number">${escapeHtml(number)}.</span><span class="answer-label"><span class="label-bracket">【</span><span class="label-text">答案</span><span class="label-bracket">】</span></span><span class="answer-value">${answerText(answer)}</span>
    </div>
    ${analyses}
    ${sourceLine}
  </article>`;
}

export function renderHtml({ title, questions, url, generatedAt = new Date(), engine, fontCn, fontLatin }) {
  const fontStack = buildFontStack({ fontCn, fontLatin });
  const labelFontStack = buildLabelFontStack();
  const safeTitle = escapeHtml(title || '粉笔试卷解析');
  const safeUrl = escapeHtml(url || '');
  const count = questions.length;
  const dateText = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(generatedAt);
  const body = questions.map((question, index) => renderQuestion(question, index + 1)).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="fenbi-print-ready" content="1">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'; img-src http: https: data:; style-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
:root { color-scheme: light; }
@page { size: A4; }
* { box-sizing: border-box; }
html { background: #fff; }
body {
  margin: 0;
  color: #000;
  background: #fff;
  font-family: ${fontStack};
  font-size: 10.5pt;
  line-height: 1.72;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
a { color: #000; text-decoration: underline; text-underline-offset: 2px; }
b, strong, th, h1, h2, h3, h4, h5, h6 { font-weight: 400; }
p { margin: 0 0 5pt; }
p:last-child { margin-bottom: 0; }
img { max-width: 100% !important; height: auto !important; break-inside: avoid; }
.prose img.content-image { display: block; margin: 8pt auto 9pt; }
.prose img.formula-image { vertical-align: middle; }
.formula-unit {
  display: inline-block;
  max-width: 100%;
  margin: 1pt 0;
  vertical-align: middle;
  white-space: nowrap;
  break-inside: avoid;
}
.formula-unit img.formula-image { display: inline; margin: 0; }
table { width: 100%; border-collapse: collapse; margin: 6pt 0; font-size: 9.5pt; }
th, td { border: 1px solid #d1d5db; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #f3f4f6; }
ul, ol { margin: 4pt 0; padding-left: 18pt; }
li { margin: 1pt 0; }
blockquote { margin: 6pt 0; padding: 6pt 10pt; background: #f9fafb; border-left: 3px solid #d1d5db; }
pre { white-space: pre-wrap; word-break: break-word; }
hr { border: 0; border-top: 1px solid #e5e7eb; margin: 8pt 0; }
.doc-header {
  border-top: 4pt solid #b91c1c;
  padding: 12pt 0 10pt;
  margin-bottom: 14pt;
  border-bottom: 1px solid #e5e7eb;
  break-after: avoid;
}
.eyebrow {
  color: #000;
  font-size: 8.5pt;
  font-weight: 400;
  letter-spacing: 1.5pt;
  margin-bottom: 3pt;
}
h1 {
  margin: 0 0 6pt;
  font-size: 20pt;
  line-height: 1.35;
  letter-spacing: 0.2pt;
}
.meta {
  color: #000;
  font-size: 8.5pt;
  line-height: 1.65;
  margin: 0;
  overflow-wrap: anywhere;
}
.meta .dot { margin: 0 5pt; color: #000; }
.meta a { color: #000; }
.disclaimer {
  margin-top: 7pt;
  color: #000;
  font-size: 8pt;
}
.question {
  padding: 11pt 0 13pt;
}
.question:has(.content-image) { break-inside: avoid; }
.qa-line {
  text-indent: 2em;
  color: #000;
  font-size: 11pt;
  font-weight: 400;
  break-inside: avoid;
  break-after: avoid;
}
.qa-line .question-number,
.qa-line .answer-label,
.qa-line .answer-value {
  color: #000;
  font-size: inherit;
  font-weight: inherit;
}
.qa-line.missing .answer-value { color: #000; font-weight: inherit; }
.label-bracket {
  font-weight: 400;
  font-size: 0.92em;
  padding: 0 0.04em;
}
.label-text, .source-label { font-family: ${labelFontStack}; font-weight: 400; }
.inline-label, .section-label, .answer-label { white-space: nowrap; }
.answer-paren { font-weight: 400; }
.solution-section {
  margin-top: 4pt;
}
.section-label {
  color: #000;
  font-size: inherit;
  letter-spacing: normal;
}
.solution-section.analysis .section-label { color: #000; }
.prose { overflow-wrap: anywhere; }
.prose p { text-indent: 2em; orphans: 2; widows: 2; }
.source-line {
  margin: 5pt 0 0;
  text-indent: 2em;
  color: #000;
}
.prose h1, .prose h2, .prose h3, .prose h4 { font-size: 10.5pt; margin: 6pt 0 3pt; break-after: avoid; }
.prose figure, .prose img, .prose .formula-unit { break-inside: avoid; }
.prose :first-child { margin-top: 0; }
.prose :last-child { margin-bottom: 0; }
.empty {
  padding: 40pt 0;
  text-align: center;
  color: #000;
}
@media screen {
  body { max-width: 820px; margin: 0 auto; padding: 24px; background: #f6f7f9; }
  .question, .doc-header { background: #fff; }
}
</style>
</head>
<body>
<header class="doc-header">
  <div class="eyebrow">粉笔试卷解析 · 个人学习存档</div>
  <h1>${safeTitle}</h1>
  <p class="meta">
    导出时间 ${escapeHtml(dateText)}<span class="dot">·</span>共 ${count} 题${engine ? `<span class="dot">·</span>${engine === 'fenbi-api' ? '接口提取' : engine === 'fenbi' ? '页面结构化提取' : '通用页面提取'}` : ''}
  </p>
  ${safeUrl ? `<p class="meta">来源：<a href="${safeUrl}">${safeUrl}</a></p>` : ''}
  <p class="disclaimer">本文件由本人账户当前可见内容自动整理，仅供个人学习使用，请勿传播、售卖或用于商业用途。</p>
</header>
${body || '<div class="empty">没有可导出的题目。</div>'}
</body>
</html>`;
}

export function buildFileName(title, date = new Date()) {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
  ].join('');
  const safeTitle = String(title || '粉笔试卷')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72) || '粉笔试卷';
  return `粉笔_${safeTitle}_${stamp}.pdf`;
}

export function makePdfOptions(footerText = '仅供个人学习使用', fontOptions = {}) {
  const footerFontStack = buildFontStack(fontOptions)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
  const footerTemplate = `<div style="width:100%; padding:0 0.55in; box-sizing:border-box; font-family:${footerFontStack}; font-size:8px; color:#000; display:flex; justify-content:space-between; align-items:center;">
    <span>${escapeHtml(footerText)}</span>
    <span>第 <span class="pageNumber"></span> / <span class="totalPages"></span> 页</span>
  </div>`;
  return {
    landscape: false,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate,
    paperWidth: 8.27,
    paperHeight: 11.69,
    marginTop: 0.55,
    marginBottom: 0.7,
    marginLeft: 0.55,
    marginRight: 0.55,
    preferCSSPageSize: false,
    scale: 1,
  };
}
