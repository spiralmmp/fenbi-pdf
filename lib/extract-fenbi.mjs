function extractFenbiPage() {
  const clean = (value) => String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();

  const readText = (element) => {
    if (!element) return '';
    const value = element.innerText && element.innerText.trim() ? element.innerText : element.textContent;
    return clean(value);
  };

  const classString = (element) => {
    if (!element) return '';
    const own = typeof element.className === 'string' ? element.className : '';
    const children = [...element.querySelectorAll('[class]')]
      .map((child) => typeof child.className === 'string' ? child.className : '')
      .join(' ');
    return `${own} ${children}`;
  };

  const DROP = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED',
    'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'VIDEO',
    'AUDIO', 'SOURCE', 'TRACK', 'CANVAS', 'SVG', 'MATH', 'LINK', 'META',
    'HEAD', 'NAV',
  ]);
  const KEEP = new Set([
    'P', 'DIV', 'SPAN', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUB',
    'SUP', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR',
    'TD', 'TH', 'BLOCKQUOTE', 'PRE', 'CODE', 'H1', 'H2', 'H3', 'H4',
    'H5', 'H6', 'IMG', 'A', 'HR', 'FIGURE', 'FIGCAPTION', 'DL', 'DT',
    'DD', 'RUBY', 'RT', 'RP', 'PICTURE',
  ]);
  const UI_TEXT = /^(?:收起|展开|显示|隐藏|查看|点击查看|点击展开).{0,10}(?:解析|答案|详解|选项)?$|^(?:我要纠错|纠错|收藏|分享|笔记|提问|举报|视频解析|相关推荐|查看更多)$/;

  const absoluteImage = (raw) => {
    if (!raw) return '';
    const value = raw.trim();
    if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(value)) return value;
    if (/^data:image\/gif;base64,R0lGODlhAQABA/i.test(value)) return '';
    try {
      const url = new URL(value, document.baseURI);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    } catch {}
    return '';
  };

  const sanitize = (source, options = {}) => {
    if (!source) return '';
    const clone = source.cloneNode(true);
    const wrapper = document.createElement('div');
    wrapper.appendChild(clone);
    if (options.leadingHeader) {
      const header = clone.querySelector(':scope > h4, :scope > h3, :scope > [class*="title"], :scope > [class*="header"]');
      header?.remove();
    }
    for (const selector of options.drop || []) {
      clone.querySelectorAll(selector).forEach((element) => element.remove());
    }
    clone.querySelectorAll([...DROP].join(',').toLowerCase()).forEach((element) => element.remove());
    clone.querySelectorAll('[hidden], [aria-hidden="true"]').forEach((element) => element.remove());
    clone.querySelectorAll('[style]').forEach((element) => {
      const style = (element.getAttribute('style') || '').replace(/\s+/g, '');
      if (/display:none|visibility:hidden/i.test(style)) element.remove();
    });

    const comments = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
    const commentNodes = [];
    while (comments.nextNode()) commentNodes.push(comments.currentNode);
    commentNodes.forEach((node) => node.remove());

    const all = [...wrapper.querySelectorAll('*')];
    for (const element of all) {
      if (!wrapper.contains(element)) continue;
      const tag = element.tagName;
      if (DROP.has(tag)) {
        element.remove();
        continue;
      }
      if (!KEEP.has(tag)) {
        const parent = element.parentNode;
        if (!parent) continue;
        while (element.firstChild) parent.insertBefore(element.firstChild, element);
        element.remove();
        continue;
      }
      const rawAttributes = {};
      for (const attribute of element.getAttributeNames()) {
        rawAttributes[attribute] = element.getAttribute(attribute) || '';
        element.removeAttribute(attribute);
      }
      if (tag === 'IMG') {
        const candidates = ['data-src', 'data-original', 'data-lazy-src', 'data-actualsrc', 'data-url', 'src'];
        let imageUrl = '';
        for (const attribute of candidates) {
          imageUrl = absoluteImage(rawAttributes[attribute]);
          if (imageUrl) break;
        }
        if (!imageUrl) {
          element.remove();
          continue;
        }
        element.setAttribute('src', imageUrl);
        element.setAttribute('loading', 'eager');
        element.setAttribute('decoding', 'sync');
      } else if (tag === 'A') {
        const href = (rawAttributes.href || '').trim();
        if (/^https?:\/\//i.test(href)) {
          element.setAttribute('href', href);
          element.setAttribute('rel', 'noopener noreferrer');
        }
      } else if (tag === 'TD' || tag === 'TH') {
        for (const attribute of ['colspan', 'rowspan']) {
          const value = rawAttributes[attribute];
          if (value && /^\d{1,2}$/.test(value)) element.setAttribute(attribute, value);
        }
      } else if (tag === 'OL') {
        const start = rawAttributes.start;
        if (start && /^\d{1,4}$/.test(start)) element.setAttribute('start', start);
      }
      if (!element.children.length && !element.textContent.trim() &&
          !['BR', 'HR', 'IMG', 'TD', 'TH', 'PICTURE'].includes(tag)) {
        element.remove();
      }
    }

    for (const element of [...wrapper.querySelectorAll('*')].reverse()) {
      if (!wrapper.contains(element)) continue;
      const text = (element.textContent || '').trim();
      const selfIsContent = ['IMG', 'BR', 'HR'].includes(element.tagName);
      if (!text && !selfIsContent && !element.querySelector('img, br, hr')) {
        element.remove();
        continue;
      }
      if (!element.children.length && !element.querySelector('img') && text.length <= 30 && UI_TEXT.test(text)) {
        element.remove();
      }
    }

    return wrapper.innerHTML.trim();
  };

  const headingPattern = /解析|分析|详解|解答|答案|考点|知识点|来源|难度|作者|笔记|统计|会员|视频|提问|评论|纠错/;
  const skipSection = /笔记|统计|会员|视频|提问|评论|纠错|收藏|举报|相关推荐/;
  const analysisPattern = /解析|分析|详解|解答/;
  const extraPattern = /考点|知识点|来源|难度|作者|题目来源|材料来源/;
  const typePattern = /(?:单项选择|多项选择|不定项选择|单选|多选|选择|判断|填空|简答|分析|论述|写作|计算|综合|案例)题/;

  const getQuestionUnits = () => {
    const allItems = [...document.querySelectorAll('.solution-item')]
      .filter((item) => item.querySelector('.question-content, .fb-ng-solution, .fb-solution-sub'));
    const items = allItems.filter((item) => !item.parentElement?.closest('.solution-item'));
    if (items.length) return items;

    const apps = [...document.querySelectorAll('app-fb-solution, fb-ng-solution')]
      .filter((element) => !element.parentElement?.closest('app-fb-solution, fb-ng-solution'));
    const usable = apps.filter((element) => element.querySelector('.question-content, .choice-options, .truefalse-options'));
    if (usable.length) return usable;

    return [...document.querySelectorAll('.question-content')]
      .filter((element) => !element.parentElement?.closest('.question-content'))
      .map((element) => element.closest('.solution-item, app-fb-solution, fb-ng-solution, article, section') || element);
  };

  const getNumber = (unit, sequence) => {
    for (const anchor of unit.querySelectorAll('a[name]')) {
      const value = (anchor.getAttribute('name') || '').trim();
      if (/^\d{1,4}$/.test(value)) return Number(value);
    }
    for (const element of [unit, ...unit.querySelectorAll('[id]')]) {
      const id = element.getAttribute?.('id') || '';
      const match = id.match(/(?:question|ques|q)[-_]?(\d{1,4})/i);
      if (match) return Number(match[1]);
    }
    const numberEl = unit.querySelector('.question-num, .question-number, .serial-number, .subject-index');
    if (numberEl) {
      const match = readText(numberEl).match(/\d{1,4}/);
      if (match) return Number(match[0]);
    }
    const leading = readText(unit).slice(0, 120);
    const match = leading.match(/^(?:第\s*)?(\d{1,4})\s*(?:题|[.、．])\s*/);
    if (match) return Number(match[1]);
    return sequence;
  };

  const getType = (unit) => {
    const candidates = [
      unit.querySelector('.ques-type'),
      unit.querySelector('.question-type'),
      unit.querySelector('.type-tag'),
      unit.querySelector('.options-title'),
    ].filter(Boolean);
    for (const element of candidates) {
      const text = readText(element).replace(/^[一二三四五六七八九十]+[、.．]\s*/, '');
      if (text.length <= 24 && typePattern.test(text)) {
        const match = text.match(typePattern);
        if (match) return match[0];
      }
    }
    const top = readText(unit).slice(0, 160);
    const match = top.match(/^.*?([\u4e00-\u9fa5]{0,4}题)/);
    if (match?.[1] && typePattern.test(match[1]) && match[1].length <= 8) return match[1];
    return '';
  };

  const getMaterial = (unit) => {
    const candidates = [
      ...unit.querySelectorAll('.fb-ng-question-material .material-content'),
      ...unit.querySelectorAll('.question-material .material-content, .material-content'),
    ];
    const element = candidates.find((candidate) =>
      !candidate.closest('.solution-content, fb-ng-solution-detail-content') &&
      (readText(candidate) || candidate.querySelector('img')));
    if (!element) return null;
    const html = sanitize(element);
    const text = readText(element);
    return html || text ? {
      html,
      text: text.slice(0, 2000),
      charCount: text.length,
    } : null;
  };

  const getStem = (unit) => {
    const element = unit.querySelector('.question-content, .fb-ng-question-content, .stem-content, .subject-content');
    if (!element) return { html: '', text: '' };
    const html = sanitize(element, {
      drop: ['.fb-ng-question-material', '.material-content', 'ul.choice-options', 'ul.truefalse-options'],
    });
    const text = readText(element);
    return { html, text };
  };

  const getOptions = (unit) => {
    const lists = [...unit.querySelectorAll('ul.choice-options, ul.truefalse-options, ul.question-options')]
      .filter((list) => !list.closest('.solution-content, fb-ng-solution-detail-content'));
    if (!lists.length) return [];
    const seen = new Set();
    const options = [];
    for (const item of lists[0].querySelectorAll(':scope > li, :scope > .option-item')) {
      if (seen.has(item)) continue;
      seen.add(item);
      const labelEl = item.querySelector('.fb-radioInput, .option-label, .choice-label, .radio-label, [class*="label"]');
      let label = readText(labelEl).match(/^[A-H]/)?.[0] || '';
      const contentEl = item.querySelector('.opt-content, .option-content, .choice-content, .option-text');
      const bodyHtml = sanitize(contentEl || item);
      let bodyText = readText(contentEl || item);
      if (!label) {
        const match = bodyText.match(/^([A-H])\s*[.、．:：]?\s*/);
        if (match) {
          label = match[1];
          bodyText = bodyText.slice(match[0].length);
        }
      }
      const classes = classString(item);
      const correct = /\b(?:right-options|correct-option|correct-options|is-correct|right-answer|answer-right)\b/.test(classes);
      if (!label && !bodyText && !bodyHtml) continue;
      options.push({ label, text: bodyText, html: bodyHtml, correct });
    }
    return options;
  };

  const stripAnswerPrefix = (value) => clean(value)
    .replace(/^【\s*(?:正确答案|参考答案|答案)\s*】\s*/i, '')
    .replace(/^(?:正确答案|参考答案|答案)\s*(?:是|为)?\s*[:：]?\s*/i, '')
    .replace(/\s*(?:我的答案|你的答案|作答结果|考生答案)\s*[:：].*$/i, '')
    .trim();

  const getSections = (unit) => {
    const sectionSelector = 'fb-ng-solution-detail-item, .fb-ng-solution-detail-item, .solu-detail-item, .solution-detail-item';
    const nodes = [...unit.querySelectorAll(sectionSelector)]
      .filter((element) => !element.parentElement?.closest(sectionSelector));
    const sections = [];
    const seen = new Set();
    for (const element of nodes) {
      if (seen.has(element)) continue;
      seen.add(element);
      const header = element.querySelector(':scope > h4, :scope > h3, :scope > [class*="title"], :scope > [class*="header"]');
      let label = clean(readText(header)).replace(/[:：]\s*$/, '');
      const contentCandidates = [
        ...element.querySelectorAll('.solution-content'),
        ...element.querySelectorAll('fb-ng-solution-detail-content, .fb-ng-solution-detail-content, .detail-content'),
      ];
      const contentEl = contentCandidates.find((candidate) => readText(candidate) || candidate.querySelector('img'));
      let text = readText(contentEl || element);
      let html = sanitize(contentEl || element, { leadingHeader: !contentEl });
      if (!label) {
        const inferred = text.match(/^(?:【\s*(解析|分析|答案|考点|知识点|来源|难度|详解|解答)\s*】|(解析|分析|答案|考点|知识点|来源|难度|详解|解答)\s*[:：])/);
        if (inferred) label = inferred[1] || inferred[2];
      }
      label = label.replace(/[:：]\s*$/, '').trim();
      text = clean(text);
      if (!text && !html) continue;
      if (label && !headingPattern.test(label) && label.length > 16) continue;
      if (skipSection.test(label)) continue;
      sections.push({ label, text, html });
    }
    return sections;
  };

  const units = getQuestionUnits();
  const questions = [];
  const questionMap = new Map();
  let gatedCount = 0;
  let missingAnswerCount = 0;

  units.forEach((unit, index) => {
    const number = getNumber(unit, index + 1);
    const type = getType(unit);
    const material = getMaterial(unit);
    const stem = getStem(unit);
    const options = getOptions(unit);
    const sections = getSections(unit);
    const unitText = readText(unit);

    let answer = '';
    const correctNode = unit.querySelector(
      '.fb-ng-solution-detail-answer .correct-text, .fb-ng-solution-detail-answer .answer-text, .fb-ng-solution-detail-answer'
    );
    if (correctNode) answer = stripAnswerPrefix(readText(correctNode));
    if (!answer) {
      const answerSection = sections.find((section) => /答案/.test(section.label));
      if (answerSection) answer = stripAnswerPrefix(answerSection.text);
    }
    if (!answer) {
      answer = options.filter((option) => option.correct).map((option) => option.label).filter(Boolean).join('、');
    }
    if (!answer) missingAnswerCount++;

    const analyses = sections
      .filter((section) => analysisPattern.test(section.label) && !skipSection.test(section.label))
      .map((section) => ({ label: section.label || '解析', html: section.html, text: section.text }));
    if (!analyses.length) {
      const fallback = [...unit.querySelectorAll('.solution-content, fb-ng-solution-detail-content')]
        .find((element) => readText(element).length > 15 && !element.closest('.fb-ng-solution-detail-answer'));
      if (fallback) {
        const text = readText(fallback);
        analyses.push({ label: '解析', html: sanitize(fallback), text });
      }
    }

    const extras = sections
      .filter((section) => section.label && !analysisPattern.test(section.label) && !/答案/.test(section.label))
      .filter((section) => extraPattern.test(section.label))
      .map((section) => ({ label: section.label, html: section.html, text: section.text }));

    const gated = /会员专享|开通会员|解锁更多解析|购买解析|升级会员|付费查看|会员解析|充值后查看/.test(unitText);
    if (gated) gatedCount++;

    const stemText = stem.text || readText(unit.querySelector('.question-content')) || '';
    if (!stemText && !answer && !analyses.length && !options.length) return;
    const signatureText = stemText.replace(/\s+/g, '').slice(0, 80);
    const key = `${number}|${signatureText}`;
    const entry = {
      number,
      autoNumber: !/^\d{1,4}$/.test(String((unit.querySelector('a[name]')?.getAttribute('name') || '').trim())),
      type,
      stem: stem.html ? stem : { html: '', text: stemText },
      material,
      options,
      answer,
      analyses,
      extras,
      gated,
      sourceIndex: index,
    };
    const existing = questionMap.get(key);
    if (existing) {
      const newWeight = analyses.reduce((sum, section) => sum + section.text.length, 0) + options.length;
      const oldWeight = existing.analyses.reduce((sum, section) => sum + section.text.length, 0) + existing.options.length;
      if (newWeight > oldWeight) {
        existing.type = existing.type || entry.type;
        existing.material = existing.material || entry.material;
        existing.stem = existing.stem.text ? existing.stem : entry.stem;
        existing.options = entry.options.length > existing.options.length ? entry.options : existing.options;
        existing.answer = existing.answer || entry.answer;
        existing.analyses = entry.analyses.length ? entry.analyses : existing.analyses;
        existing.extras = entry.extras.length ? entry.extras : existing.extras;
        existing.gated = existing.gated || entry.gated;
      }
      return;
    }
    questionMap.set(key, entry);
    questions.push(entry);
  });

  questions.sort((a, b) => a.number - b.number || a.sourceIndex - b.sourceIndex);

  const title = clean(
    document.querySelector('h1')?.innerText ||
    document.title ||
    ''
  ).replace(/\s*[-_|—]\s*粉笔.*$/, '').trim();

  const warnings = [];
  const missingAnalysis = questions.filter((question) => !question.analyses.length);
  if (missingAnalysis.length) {
    warnings.push(`${missingAnalysis.length} 道题没有提取到解析，可能尚未展开或需要会员权限。`);
  }
  if (missingAnswerCount) {
    warnings.push(`${missingAnswerCount} 道题没有识别到正确答案。`);
  }

  return {
    engine: 'fenbi',
    title,
    url: location.href,
    questions,
    warnings,
    stats: {
      units: units.length,
      exported: questions.length,
      gated: gatedCount,
      missingAnalysis: missingAnalysis.length,
      missingAnswer: missingAnswerCount,
    },
  };
}

export const fenbiExtractScript = `(${extractFenbiPage.toString()})()`;
