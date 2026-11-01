function extractGenericPage() {
  const clean = (value) => String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const hidden = (element) => {
    if (!element) return true;
    const style = getComputedStyle(element);
    return style.display === 'none' || style.visibility === 'hidden';
  };

  const uiLine = /^(?:(?:收藏|分享|纠错|举报|笔记|我的笔记|添加笔记|提问|我要提问|查看解析|收起解析|展开解析|展开全部|全部展开|上一题|下一题|返回顶部|相关推荐|视频解析|答案解析|答疑|评论|暂无解析|精华|置顶)(?:[\s\u3000·|/,，;；、]+|$))+$/;
  const typePattern = /(?:单项选择|多项选择|不定项选择|单选|多选|选择|判断|填空|简答|分析|论述|写作|计算|综合|案例)题/;
  const gatedPattern = /会员专享|开通会员|解锁更多解析|购买解析|升级会员|付费查看|会员解析|充值后查看/;
  const answerPattern = /【\s*(?:正确答案|参考答案|答案)\s*】|(?:正确答案|参考答案)\s*(?:是|为)?\s*[:：]?|^答案\s*[:：]/;
  const analysisPattern = /【\s*(?:文字解析|解析|分析|详解|解答)\s*】|(?:文字解析|解析|分析|详解|解答)\s*[:：]/;

  const findAnswerMarker = (line) => {
    if (!line || /^我的答案/.test(line) && !/正确答案|参考答案/.test(line)) return null;
    const match = line.match(answerPattern);
    if (!match) return null;
    return {
      index: match.index,
      length: match[0].length,
      value: line.slice(match.index + match[0].length).trim(),
    };
  };

  const findAnalysisMarker = (line) => {
    if (!line || /视频解析/.test(line)) return null;
    const trimmed = line.trim();
    if (/^(?:文字解析|解析|分析|详解|解答)$/.test(trimmed)) {
      return { index: line.indexOf(trimmed), length: trimmed.length, value: '' };
    }
    const match = line.match(analysisPattern);
    if (!match) return null;
    return {
      index: match.index,
      length: match[0].length,
      value: line.slice(match.index + match[0].length).trim(),
    };
  };

  const isVisibleMarker = (node) => {
    const parent = node.parentElement;
    if (!parent) return false;
    let element = parent;
    for (let depth = 0; element && depth < 8; depth++) {
      if (hidden(element)) return false;
      element = element.parentElement;
    }
    return true;
  };

  const collectAnswerNodes = () => {
    const nodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const value = (node.nodeValue || '').trim();
      if (!value || value.length > 120 || !findAnswerMarker(value)) continue;
      if (node.parentElement?.closest('script, style, noscript, template')) continue;
      if (!isVisibleMarker(node)) continue;
      nodes.push(node);
    }
    return nodes;
  };

  const chooseBlock = (node) => {
    let element = node.parentElement;
    let best = null;
    let bestScore = -1;
    for (let depth = 0; element && element !== document.body && depth < 12; depth++) {
      const text = clean(element.innerText || element.textContent || '');
      if (!text) break;
      const answerCount = (text.match(/(?:正确答案|参考答案|【\s*答案\s*】|(?:^|\n)\s*答案\s*[:：])/g) || []).length;
      if (answerCount > 1) break;
      const hasAnalysis = analysisPattern.test(text);
      const hasOptions = /(?:^|\n)\s*A\s*[.、．:：)）]/.test(text);
      const hasNumber = /^(?:第\s*)?\d{1,4}\s*(?:题|[.、．])/.test(text);
      const score = (hasAnalysis ? 3 : 0) + (hasOptions ? 2 : 0) + (hasNumber ? 2 : 0) + Math.min(text.length / 800, 1);
      if (text.length >= 25 && score >= bestScore) {
        best = element;
        bestScore = score;
      }
      if (hasAnalysis && hasOptions) break;
      element = element.parentElement;
    }
    return best || node.parentElement;
  };

  const cleanupLines = (lines) => lines
    .map((line) => clean(line))
    .filter((line) => line && !uiLine.test(line))
    .filter((line) => !/^\d{1,3}\s*\/\s*\d{1,3}$/.test(line));

  const parseOptionLine = (line) => {
    let match = line.match(/^([A-H])\s*[.、．:：)）]\s*(.*)$/);
    if (!match) match = line.match(/^([A-H])$/);
    if (!match) return null;
    return { label: match[1], text: (match[2] || '').trim() };
  };

  const parseBlock = (block, markerIndex) => {
    const lines = cleanupLines((block.innerText || block.textContent || '').split('\n'));
    if (!lines.length) return null;

    let answerLineIndex = -1;
    let answerMarker = null;
    for (let index = 0; index < lines.length; index++) {
      const marker = findAnswerMarker(lines[index]);
      if (marker) {
        answerLineIndex = index;
        answerMarker = marker;
        break;
      }
    }
    if (answerLineIndex < 0) return null;

    let answer = answerMarker.value;
    let inlineAnalysis = '';
    if (answer) {
      const analysisOnAnswerLine = findAnalysisMarker(answer);
      if (analysisOnAnswerLine) {
        inlineAnalysis = answer.slice(analysisOnAnswerLine.index + analysisOnAnswerLine.length).trim();
        answer = answer.slice(0, analysisOnAnswerLine.index).trim();
      }
    }
    if (!answer && answerLineIndex + 1 < lines.length) {
      const next = lines[answerLineIndex + 1];
      if (/^[A-H](?:[\s,，、;；]*[A-H])*$/.test(next)) answer = next;
    }
    answer = clean(answer.replace(/^(?:是|为)\s*/, ''));

    let analysisLineIndex = -1;
    let analysisMarker = null;
    for (let index = answerLineIndex; index < lines.length; index++) {
      const marker = findAnalysisMarker(lines[index]);
      if (marker) {
        analysisLineIndex = index;
        analysisMarker = marker;
        break;
      }
    }

    const analysisLines = [];
    if (inlineAnalysis) analysisLines.push(inlineAnalysis);
    if (analysisLineIndex >= 0) {
      if (analysisMarker.value) analysisLines.push(analysisMarker.value);
      analysisLines.push(...lines.slice(analysisLineIndex + 1));
    } else {
      analysisLines.push(...lines.slice(answerLineIndex + 1));
    }
    let analysisText = clean(analysisLines.join('\n'))
      .replace(/^(?:文字解析|解析|分析|详解|解答)\s*[:：]\s*/, '')
      .trim();
    if (analysisText.length < 12) analysisText = '';

    const questionEnd = answerLineIndex;
    const questionLines = lines.slice(0, questionEnd).filter((line, index) => {
      if (index === 0) return true;
      return !/^我的答案|^你的答案|^作答/.test(line);
    });

    let number = null;
    let autoNumber = true;
    let type = '';
    let cursor = 0;

    const numberLine = (questionLines[cursor] || '').match(/^(?:第\s*)?(\d{1,4})\s*(?:题\s*)?([.、．])?\s*(.*)$/);
    if (numberLine && (numberLine[2] || /^第\s*\d+/.test(questionLines[cursor]) || questionLines[cursor] === numberLine[1])) {
      const isYear = !numberLine[2] && numberLine[1].length === 4;
      if (!isYear) {
        number = Number(numberLine[1]);
        autoNumber = false;
        const rest = clean(numberLine[3]);
        if (!rest) {
          cursor++;
        } else if (typePattern.test(rest) && rest.length <= 16) {
          type = rest.match(typePattern)?.[0] || '';
          cursor++;
        } else {
          questionLines[cursor] = rest;
        }
      }
    }

    if (!type && cursor < questionLines.length) {
      const candidate = questionLines[cursor].replace(/^[一二三四五六七八九十]+[、.．]\s*/, '').trim();
      if (candidate.length <= 20 && typePattern.test(candidate)) {
        type = candidate.match(typePattern)?.[0] || candidate;
        cursor++;
      }
    }

    const stemRegionEnd = questionLines.length;
    let optionStart = -1;
    for (let index = cursor; index < stemRegionEnd; index++) {
      const parsed = parseOptionLine(questionLines[index]);
      if (parsed?.label !== 'A') continue;
      for (let next = index + 1; next < stemRegionEnd; next++) {
        if (parseOptionLine(questionLines[next])?.label === 'B') {
          optionStart = index;
          break;
        }
      }
      if (optionStart >= 0) break;
    }

    let stemText = '';
    const options = [];
    if (optionStart >= 0) {
      stemText = questionLines.slice(cursor, optionStart).join('\n').trim();
      let current = null;
      for (let index = optionStart; index < stemRegionEnd; index++) {
        const parsed = parseOptionLine(questionLines[index]);
        if (parsed) {
          current = { label: parsed.label, lines: parsed.text ? [parsed.text] : [] };
          options.push(current);
        } else if (current) {
          current.lines.push(questionLines[index]);
        }
      }
    } else {
      stemText = questionLines.slice(cursor).join('\n').trim();
    }

    const answerLetters = /^[A-H](?:[\s,，、;；]*[A-H])*$/.test(answer)
      ? new Set(answer.match(/[A-H]/g) || [])
      : new Set();
    const normalizedOptions = options
      .filter((option) => option.lines.join('').trim())
      .map((option) => ({
        label: option.label,
        text: clean(option.lines.join('\n')),
        html: '',
        correct: answerLetters.has(option.label),
      }));

    if (number === null) number = markerIndex + 1;
    const analyses = analysisText ? [{ label: '解析', html: '', text: analysisText }] : [];
    if (!stemText && !analyses.length && !normalizedOptions.length) return null;

    const blockText = clean(block.innerText || '');
    return {
      number,
      autoNumber,
      type,
      stem: { html: '', text: stemText },
      material: null,
      options: normalizedOptions,
      answer,
      analyses,
      extras: [],
      gated: gatedPattern.test(blockText),
      sourceIndex: markerIndex,
    };
  };

  const answerNodes = collectAnswerNodes();
  const blocks = [];
  const seenBlocks = new Set();
  for (const node of answerNodes) {
    const block = chooseBlock(node);
    if (!block || seenBlocks.has(block)) continue;
    seenBlocks.add(block);
    blocks.push(block);
  }

  const questions = [];
  const map = new Map();
  blocks.forEach((block, index) => {
    const parsed = parseBlock(block, index);
    if (!parsed) return;
    const key = `${parsed.number}|${parsed.stem.text.replace(/\s+/g, '').slice(0, 70)}|${parsed.answer}`;
    const existing = map.get(key);
    if (existing) {
      const oldLength = existing.analyses.reduce((sum, item) => sum + item.text.length, 0);
      const newLength = parsed.analyses.reduce((sum, item) => sum + item.text.length, 0);
      if (newLength > oldLength) {
        existing.analyses = parsed.analyses;
        existing.stem = parsed.stem.text ? parsed.stem : existing.stem;
        existing.options = parsed.options.length ? parsed.options : existing.options;
      }
      return;
    }
    map.set(key, parsed);
    questions.push(parsed);
  });

  questions.sort((a, b) => a.number - b.number || a.sourceIndex - b.sourceIndex);
  const title = clean(document.querySelector('h1')?.innerText || document.title || '')
    .replace(/\s*[-_|—]\s*粉笔.*$/, '')
    .trim();
  const missingAnalysis = questions.filter((question) => !question.analyses.length).length;
  const gated = questions.filter((question) => question.gated).length;
  const warnings = [];
  if (!questions.length) warnings.push('未能从页面识别题目。可加 --debug 保留页面快照以便排查。');
  if (missingAnalysis) warnings.push(`${missingAnalysis} 道题没有提取到解析。`);

  return {
    engine: 'generic',
    title,
    url: location.href,
    questions,
    warnings,
    stats: {
      markerNodes: answerNodes.length,
      blocks: blocks.length,
      exported: questions.length,
      missingAnalysis,
      gated,
    },
  };
}

export const genericExtractScript = `(${extractGenericPage.toString()})()`;
