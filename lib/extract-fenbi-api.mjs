async function fenbiApiExtractPage() {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const staticPattern = /\/combine\/static\/solution(?:\?|$)/;
  const exercisePattern = /\/(?:getSolution|getPaperSolution)(?:\?|$)/;
  const matching = (pattern) => performance.getEntriesByType('resource')
    .filter((entry) => pattern.test(entry.name));

  let staticEntries = matching(staticPattern);
  let exerciseEntries = matching(exercisePattern);
  for (let attempt = 0; attempt < 40 && !staticEntries.length && !exerciseEntries.length; attempt++) {
    await sleep(250);
    staticEntries = matching(staticPattern);
    exerciseEntries = matching(exercisePattern);
  }

  const latest = (entries) => {
    if (!entries.length) return null;
    const successful = entries.filter((entry) => entry.responseStatus === 200);
    return [...(successful.length ? successful : entries)]
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))[0];
  };

  const unwrap = (json) => {
    let value = json;
    if (value && typeof value === 'object' && 'data' in value) value = value.data;
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch {}
    }
    return value;
  };

  const load = async (url) => {
    if (!url) return { error: '接口地址为空' };
    let response;
    try {
      response = await fetch(url, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      return { error: `接口请求失败：${error?.message || error}` };
    }
    if (!response.ok) return { error: `接口返回 HTTP ${response.status}` };
    try {
      return { json: await response.json() };
    } catch {
      return { error: '接口返回内容不是 JSON' };
    }
  };

  try {
    let root = null;
    let list = [];
    let apiUrl = '';
    let sourceKind = '';

    const staticEntry = latest(staticEntries);
    if (staticEntry) {
      const result = await load(staticEntry.name);
      const candidate = result.json ? unwrap(result.json) : null;
      if (candidate && Array.isArray(candidate.solutions) && candidate.solutions.length) {
        root = candidate;
        list = candidate.solutions;
        apiUrl = staticEntry.name;
        sourceKind = 'static';
      }
    }

    if (!list.length) {
      let exerciseUrl = latest(exerciseEntries)?.name || '';
      if (!exerciseUrl) {
        const params = new URLSearchParams(location.search);
        const match = location.pathname.match(/\/(?:solution|paper-solution)\/([^/?#]+)/);
        const key = match ? decodeURIComponent(match[1]) : (params.get('key') || '');
        const routecs = params.get('routecs') || '';
        if (key) {
          exerciseUrl = 'https://tiku.fenbi.com/combine/exercise/getSolution?format=html&key=' +
            encodeURIComponent(key) + (routecs ? '&routecs=' + encodeURIComponent(routecs) : '');
        }
      }

      if (exerciseUrl) {
        const result = await load(exerciseUrl);
        const exerciseRoot = result.json ? unwrap(result.json) : null;
        if (exerciseRoot) {
          const staticUrl = exerciseRoot.staticUrl?.urls?.[0] || '';
          if (staticUrl) {
            const staticResult = await load(staticUrl);
            const candidate = staticResult.json ? unwrap(staticResult.json) : null;
            if (candidate && Array.isArray(candidate.solutions) && candidate.solutions.length) {
              root = candidate;
              list = candidate.solutions;
              apiUrl = staticUrl;
              sourceKind = 'static';
            }
          }
          if (!list.length) {
            const questions = Array.isArray(exerciseRoot.questions) ? exerciseRoot.questions : [];
            const solutions = Array.isArray(exerciseRoot.solutions) ? exerciseRoot.solutions : [];
            if (questions.length || solutions.length) {
              root = exerciseRoot;
              list = questions.length ? questions : solutions;
              apiUrl = exerciseUrl;
              sourceKind = 'exercise';
            }
          }
        }
      }
    }

    if (!list.length) {
      return { ok: false, reason: '未找到可用的解析接口（static/solution 或 getSolution）' };
    }

    const DROP = new Set([
      'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED',
      'FORM', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'VIDEO',
      'AUDIO', 'SOURCE', 'TRACK', 'CANVAS', 'SVG', 'MATH', 'LINK', 'META',
      'HEAD', 'NAV',
    ]);

    const absoluteImage = (raw) => {
      const value = String(raw || '').trim();
      if (!value) return '';
      if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(value)) return value;
      try {
        const url = new URL(value, document.baseURI);
        if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
      } catch {}
      return '';
    };

    const parseHtml = (raw) => new DOMParser().parseFromString(String(raw), 'text/html').body;

    const clean = (raw) => {
      if (raw == null || raw === '') return '';
      const wrapper = parseHtml(raw);
      wrapper.querySelectorAll([...DROP].join(',').toLowerCase()).forEach((element) => element.remove());
      wrapper.querySelectorAll('[hidden], [aria-hidden="true"]').forEach((element) => element.remove());
      wrapper.querySelectorAll('[style]').forEach((element) => {
        const style = (element.getAttribute('style') || '').replace(/\s+/g, '');
        if (/display:none|visibility:hidden/i.test(style)) element.remove();
      });
      for (const element of [...wrapper.querySelectorAll('*')]) {
        if (!wrapper.contains(element)) continue;
        const tag = element.tagName;
        const attributes = {};
        for (const name of element.getAttributeNames()) {
          attributes[name] = element.getAttribute(name) || '';
          element.removeAttribute(name);
        }
        if (tag === 'IMG') {
          let src = '';
          for (const name of ['data-src', 'data-original', 'data-lazy-src', 'data-actualsrc', 'src']) {
            src = absoluteImage(attributes[name]);
            if (src) break;
          }
          if (!src) {
            element.remove();
            continue;
          }
          element.setAttribute('src', src);
          const formula = attributes.flag === 'tex' ||
            /\/formulas(?:\?|$)|[?&]latex=/i.test(src);
          element.setAttribute('class', formula ? 'formula-image' : 'content-image');
        } else if (tag === 'A') {
          const href = (attributes.href || '').trim();
          if (/^https?:\/\//i.test(href)) {
            element.setAttribute('href', href);
            element.setAttribute('rel', 'noopener noreferrer');
          }
        } else if (tag === 'TD' || tag === 'TH') {
          for (const name of ['colspan', 'rowspan']) {
            if (/^\d{1,2}$/.test(attributes[name] || '')) element.setAttribute(name, attributes[name]);
          }
        } else if (tag === 'OL') {
          if (/^\d{1,4}$/.test(attributes.start || '')) element.setAttribute('start', attributes.start);
        }
      }
      const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT);
      let textNode;
      while ((textNode = walker.nextNode())) {
        textNode.nodeValue = textNode.nodeValue.replace(/[\u00b7\u2022\u30fb\uff65\u22c5]{2,}/g, '……');
      }
      for (const image of [...wrapper.querySelectorAll('img.formula-image')]) {
        const unit = document.createElement('span');
        unit.className = 'formula-unit';
        image.replaceWith(unit);
        unit.appendChild(image);
        const next = unit.nextSibling;
        if (next?.nodeType === Node.TEXT_NODE) {
          const match = next.nodeValue.match(/^(\s*)([，。、；：！？)）】」』])/);
          if (match) {
            next.nodeValue = next.nodeValue.slice(match[0].length);
            unit.appendChild(document.createTextNode(match[2]));
            if (!next.nodeValue) next.remove();
          }
        }
      }
      return wrapper.innerHTML.trim();
    };

    const htmlToText = (value) => {
      if (value == null) return '';
      return (parseHtml(value).textContent || '')
        .replace(/[\u00b7\u2022\u30fb\uff65\u22c5]{2,}/g, '……')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const answerOf = (question) => {
      const correct = question?.correctAnswer;
      let result = '';
      if (correct && typeof correct === 'object') {
        const answerText = correct.answer != null ? htmlToText(correct.answer) : '';
        if (answerText && /^(?:正确|错误|对|错|√|×|true|false|t|f)$/i.test(answerText)) {
          result = answerText;
        }
        const choice = correct.choice != null ? String(correct.choice).trim() : '';
        if (!result && choice) {
          const numbers = choice.split(/[,，\s]+/)
            .map(Number)
            .filter((value) => Number.isInteger(value) && value >= 0 && value <= 25);
          if (numbers.length) {
            result = numbers.map((value) => String.fromCharCode(65 + value)).join('、');
          } else if (/^[A-Za-z](?:\s*[,，]\s*[A-Za-z])*$/.test(choice)) {
            result = choice.replace(/[,，\s]+/g, '、').toUpperCase();
          }
        }
        if (!result && answerText) result = answerText;
        if (!result && Array.isArray(correct.blanks)) {
          result = correct.blanks
            .map((item) => htmlToText(item?.answer ?? item?.content ?? item))
            .filter(Boolean)
            .join('；');
        }
      } else if (correct != null) {
        result = htmlToText(correct);
      }
      if (!result && question?.answer != null) result = htmlToText(question.answer);
      return result.replace(/\s+/g, ' ').trim();
    };

    const solutionOf = (question) =>
      question?.solution ?? question?.solutionText ?? question?.analysis ?? question?.explanation ?? '';

    const questions = list.map((question, index) => {
      const subQuestions = Array.isArray(question?.subQuestions_)
        ? question.subQuestions_
        : (Array.isArray(question?.subQuestions) ? question.subQuestions : []);
      const ownAnswer = answerOf(question);
      const subAnswers = subQuestions
        .map((sub, subIndex) => {
          const value = answerOf(sub);
          return value ? `（${subIndex + 1}）${value}` : '';
        })
        .filter(Boolean)
        .join(' ');
      const answer = [ownAnswer, subAnswers].filter(Boolean).join('；');

      const analyses = [];
      const solution = clean(solutionOf(question));
      if (solution) analyses.push({ label: '解析', html: solution });
      subQuestions.forEach((sub, subIndex) => {
        const subSolution = clean(solutionOf(sub));
        if (subSolution) analyses.push({ label: `子题 ${subIndex + 1} 解析`, html: subSolution });
      });

      return { number: index + 1, answer, analyses };
    });

    const warnings = [];
    const missingAnswer = questions.filter((question) => !question.answer).length;
    const missingSolution = questions.filter((question) => !question.analyses?.length).length;
    if (missingAnswer) warnings.push(`接口中有 ${missingAnswer} 道题未识别到答案。`);
    if (missingSolution) warnings.push(`接口中有 ${missingSolution} 道题没有解析内容。`);

    const countCard = (node) => {
      if (!node) return 0;
      if (node.nodeType === 2) return 1;
      return (node.children || []).reduce((sum, child) => sum + countCard(child), 0);
    };
    const expected = root?.card ? countCard(root.card) : 0;
    if (expected && expected !== list.length) {
      warnings.push(`接口返回 ${list.length} 题，试卷目录显示 ${expected} 题。`);
    }

    return {
      ok: true,
      engine: 'fenbi-api',
      sourceKind,
      title: root?.name || root?.title || document.title || '',
      apiUrl,
      questions,
      warnings,
    };
  } catch (error) {
    return { ok: false, reason: `接口解析失败：${error?.message || error}` };
  }
}

export const fenbiApiExtractScript = `(${fenbiApiExtractPage.toString()})()`;
