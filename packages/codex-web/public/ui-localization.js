// Focused presentation boundary; all application capabilities are explicit.
(function install(globalScope) {
  function createRenderer(context) {
    const { state, UI_TRANSLATIONS, normalizeLanguage, DEFAULT_LANGUAGE, escapeAttribute, escapeHtml } = context;
function translateUi(key, language = state.language, params = {}) {
  const source = String(key || '');
  const dictionary = UI_TRANSLATIONS[normalizeLanguage(language)] || {};
  const template = dictionary[source] || source;
  return Object.entries(params || {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value ?? '')),
    template,
  );
}

function t(key, params = {}) {
  return translateUi(key, state.language, params);
}

function translateText(text) {
  const value = String(text || '');
  if (!value) {
    return '';
  }
  const exact = t(value);
  if (exact !== value) {
    return exact;
  }
  return value
    .replace(/\bObserver Mode\b/gu, t('Observer Mode'))
    .replace(/\bRead only\b/gu, t('Read only'));
}

function localizeUiHtml(html) {
  if (state.language === DEFAULT_LANGUAGE) {
    return String(html || '');
  }
  return localizeUiHtmlOutsideProtectedHtml(String(html || ''));
}

function localizeUiHtmlOutsideProtectedHtml(html) {
  const protectedBlocks = [];
  const protect = (block) => {
    const token = `__CODEX_WEB_I18N_BLOCK_${protectedBlocks.length}__`;
    protectedBlocks.push(block);
    return token;
  };
  const tokenized = protectUiContentBlocks(String(html || ''), protect)
    .replace(/<(pre|code|script|style|iframe)\b[\s\S]*?<\/\1>/giu, protect)
    .replace(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/giu, (_match, attrs, content) => (
      `<textarea${attrs}>${protect(content)}</textarea>`
    ));
  const localized = tokenized
    .replace(/\s(aria-label|title|placeholder)="([^"]*)"/gu, (_match, name, value) => (
      ` ${name}="${escapeAttribute(translateText(unescapeBasicHtml(value)))}"`
    ))
    .replace(/>([^<>]+)</gu, (_match, text) => {
      if (/__CODEX_WEB_I18N_BLOCK_\d+__/u.test(text)) {
        return `>${text}<`;
      }
      if (!text.trim()) {
        return `>${text}<`;
      }
      const leading = text.match(/^\s*/u)?.[0] || '';
      const trailing = text.match(/\s*$/u)?.[0] || '';
      const body = text.slice(leading.length, text.length - trailing.length);
      return `>${leading}${escapeHtml(translateText(unescapeBasicHtml(body)))}${trailing}<`;
    });
  return restoreProtectedUiContentBlocks(localized, protectedBlocks);
}

function restoreProtectedUiContentBlocks(html, protectedBlocks) {
  let result = String(html || '');
  for (let pass = 0; pass <= protectedBlocks.length; pass += 1) {
    const next = result.replace(/__CODEX_WEB_I18N_BLOCK_(\d+)__/gu, (token, index) => (
      protectedBlocks[Number(index)] ?? token
    ));
    if (next === result) {
      return result;
    }
    result = next;
  }
  return result;
}

function protectUiContentBlocks(html, protect) {
  const ranges = findProtectedUiContentRanges(html);
  let nextHtml = String(html || '');
  for (const range of ranges.sort((left, right) => right.start - left.start)) {
    nextHtml = `${nextHtml.slice(0, range.start)}${protect(nextHtml.slice(range.start, range.end))}${nextHtml.slice(range.end)}`;
  }
  return nextHtml;
}

function findProtectedUiContentRanges(html) {
  const ranges = [];
  const stack = [];
  const tagPattern = /<\/?([a-z][\w:-]*)\b[^>]*>/giu;
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
  let match;
  while ((match = tagPattern.exec(html))) {
    const tag = match[0];
    const tagName = String(match[1] || '').toLowerCase();
    const closing = /^<\//u.test(tag);
    const selfClosing = /\/\s*>$/u.test(tag) || voidTags.has(tagName);
    if (!closing && !selfClosing) {
      stack.push({
        tagName,
        start: match.index,
        protect: hasHtmlAttribute(tag, 'data-i18n-skip') || isProtectedUiContentTag(tagName, tag),
      });
      continue;
    }
    if (!closing) {
      continue;
    }
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index].tagName !== tagName) {
        continue;
      }
      const opening = stack.splice(index, 1)[0];
      if (opening.protect) {
        ranges.push({ start: opening.start, end: tagPattern.lastIndex });
      }
      break;
    }
  }
  return ranges
    .sort((left, right) => (left.start - right.start) || (right.end - left.end))
    .filter((range, index, sortedRanges) => (
      !sortedRanges.some((other, otherIndex) => (
        otherIndex < index && other.start <= range.start && range.end <= other.end
      ))
    ));
}

function isProtectedUiContentTag(tagName, tag) {
  if (tagName === 'p') {
    return hasHtmlClass(tag, 'message-text');
  }
  return tagName === 'div'
    && hasHtmlClass(tag, 'markdown-body')
    && hasHtmlClass(tag, 'message-text');
}

function hasHtmlClass(tag, className) {
  const match = String(tag || '').match(/\sclass=(["'])(.*?)\1/iu);
  if (!match) {
    return false;
  }
  return match[2].split(/\s+/u).includes(className);
}

function hasHtmlAttribute(tag, attributeName) {
  const escapedName = String(attributeName || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`\\s${escapedName}(?:\\s|=|>|/)`, 'iu').test(String(tag || ''));
}

function localizeElement(element) {
  if (state.language === DEFAULT_LANGUAGE || !element?.childNodes) return element;
  const visit = (node) => {
    if (node.nodeType === 3) {
      const value = node.nodeValue || '';
      const body = value.trim();
      if (body) node.nodeValue = value.replace(body, translateText(body));
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.matches?.('[data-i18n-skip], pre, code, script, style, iframe, textarea, .markdown, .message-content, .message-text')) return;
    for (const name of ['aria-label', 'title', 'placeholder']) {
      if (node.hasAttribute(name)) node.setAttribute(name, translateText(node.getAttribute(name)));
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(element);
  return element;
}

function localizeFragment(html) {
  return localizeUiHtml(html);
}

function unescapeBasicHtml(value) {
  return String(value || '')
    .replace(/&quot;/gu, '"')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&(times|middot);/gu, (_match, name) => ({
      times: '×',
      middot: '·',
    })[name])
    .replace(/&#x([0-9a-f]+);/giu, (match, codePoint) => decodeHtmlCodePoint(match, codePoint, 16))
    .replace(/&#([0-9]+);/gu, (match, codePoint) => decodeHtmlCodePoint(match, codePoint, 10))
    .replace(/&amp;/gu, '&');
}

function decodeHtmlCodePoint(match, value, radix) {
  const codePoint = Number.parseInt(value, radix);
  return Number.isInteger(codePoint)
    && codePoint >= 0
    && codePoint <= 0x10ffff
    && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
    ? String.fromCodePoint(codePoint)
    : match;
}


    return { translateUi, t, translateText, localizeUiHtml, localizeUiHtmlOutsideProtectedHtml, restoreProtectedUiContentBlocks, protectUiContentBlocks, findProtectedUiContentRanges, isProtectedUiContentTag, hasHtmlClass, hasHtmlAttribute, localizeElement, localizeFragment, unescapeBasicHtml, decodeHtmlCodePoint };
  }
  globalScope.CodexWebLocalization = { createRenderer };
}(globalThis));
