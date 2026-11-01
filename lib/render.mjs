const FONT_STACK = '"Times New Roman", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans CN", "WenQuanYi Micro Hei", "Microsoft YaHei", sans-serif';

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

function inlineText(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function sectionHtml(section, className) {
  const body = contentHtml(section);
  if (!body) return '';
  return `<section class="solution-section ${className}">
    <div class="section-label">${escapeHtml(section.label || '解析')}</div>
    <div class="section-body prose">${body}</div>
  </section>`;
}

function renderQuestion(question, position) {
  const number = question.number ?? position;
  const answer = question.answer || '未识别';
  const analyses = (question.analyses || []).map((section) => sectionHtml(section, 'analysis')).join('');

  return `<article class="question">
    <div class="qa-line${question.answer ? '' : ' missing'}">
      <span class="question-number">${escapeHtml(number)}.</span>
      <span class="answer-label">答案</span>
      <span class="answer-value">${inlineText(answer)}</span>
    </div>
    ${analyses}
  </article>`;
}

export function renderHtml({ title, questions, url, generatedAt = new Date(), engine }) {
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
  color: #1f2937;
  background: #fff;
  font-family: ${FONT_STACK};
  font-size: 10.5pt;
  line-height: 1.72;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
a { color: #1d4ed8; text-decoration: underline; text-underline-offset: 2px; }
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
  color: #b91c1c;
  font-size: 8.5pt;
  font-weight: 700;
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
  color: #6b7280;
  font-size: 8.5pt;
  line-height: 1.65;
  margin: 0;
  overflow-wrap: anywhere;
}
.meta .dot { margin: 0 5pt; color: #d1d5db; }
.meta a { color: #6b7280; }
.disclaimer {
  margin-top: 7pt;
  color: #9ca3af;
  font-size: 8pt;
}
.question {
  padding: 11pt 0 13pt;
  border-bottom: 1px solid #e5e7eb;
}
.question:last-child { border-bottom: 0; }
.question:has(.content-image) { break-inside: avoid; }
.qa-line {
  display: flex;
  align-items: baseline;
  gap: 7pt;
  break-inside: avoid;
  break-after: avoid;
}
.question-number {
  color: #b91c1c;
  font-size: 12pt;
  font-weight: 800;
}
.answer-label {
  color: #64748b;
  font-size: 9pt;
  font-weight: 700;
}
.answer-value { color: #166534; font-size: 11.5pt; font-weight: 700; }
.qa-line.missing .answer-value { color: #c2410c; font-weight: 500; }
.solution-section {
  margin-top: 7pt;
  padding-top: 7pt;
  border-top: 1px dashed #dbe1e8;
}
.section-label {
  color: #64748b;
  font-size: 9pt;
  font-weight: 700;
  letter-spacing: 0.5pt;
  margin-bottom: 3pt;
  break-after: avoid;
}
.solution-section.analysis .section-label { color: #1d4ed8; }
.prose { overflow-wrap: anywhere; }
.prose p { orphans: 2; widows: 2; }
.prose h1, .prose h2, .prose h3, .prose h4 { font-size: 10.5pt; margin: 6pt 0 3pt; break-after: avoid; }
.prose figure, .prose img, .prose .formula-unit { break-inside: avoid; }
.prose :first-child { margin-top: 0; }
.prose :last-child { margin-bottom: 0; }
.empty {
  padding: 40pt 0;
  text-align: center;
  color: #6b7280;
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

export function makePdfOptions(footerText = '仅供个人学习使用') {
  const footerTemplate = `<div style="width:100%; padding:0 0.55in; box-sizing:border-box; font-family:${FONT_STACK.replace(/"/g, '&quot;')}; font-size:8px; color:#9ca3af; display:flex; justify-content:space-between; align-items:center;">
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
