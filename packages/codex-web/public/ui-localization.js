// Focused presentation boundary; all application capabilities are explicit.
(function install(globalScope) {
  function createRenderer(context) {
    const { state, UI_TRANSLATIONS, normalizeLanguage, DEFAULT_LANGUAGE, escapeAttribute, escapeHtml } = context;
    // Only the two supported locales and two fixed styles can enter this cache.
    const dateFormatters = new Map();
    function formatDate(timestamp, includeTime) {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return '';
      const language = normalizeLanguage(state.language) === 'zh-CN' ? 'zh-CN' : 'en';
      const key = `${language}:${includeTime}`;
      if (!dateFormatters.has(key)) {
        dateFormatters.set(key, new Intl.DateTimeFormat(language, {
          month: 'short', day: 'numeric',
          ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
        }));
      }
      return dateFormatters.get(key).format(date);
    }
    function formatShortDate(timestamp) { return formatDate(timestamp, false); }
    function formatShortDateTime(timestamp) { return formatDate(timestamp, true); }
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
  html = String(html || '');
  // Scan once for occupied namespaces. Long literal marker suffixes must not
  // turn every temporary token into another copy of that suffix.
  const occupiedNamespaces = new Set();
  for (const match of html.matchAll(/__CODEX_WEB_I18N_BLOCK_(\d+)_/gu)) occupiedNamespaces.add(match[1]);
  let namespace = 0;
  while (occupiedNamespaces.has(String(namespace))) namespace++;
  const tokenPrefix = `__CODEX_WEB_I18N_BLOCK_${namespace}_`;
  const protectedBlocks = [];
  const protect = (block) => {
    const token = `${tokenPrefix}${protectedBlocks.length}__`;
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
      if (text.includes(tokenPrefix)) {
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
  return restoreProtectedUiContentBlocks(localized, protectedBlocks, tokenPrefix);
}

function restoreProtectedUiContentBlocks(html, protectedBlocks, tokenPrefix = '__CODEX_WEB_I18N_BLOCK_') {
  let result = String(html || '');
  const pattern = new RegExp(`${tokenPrefix}(\\d+)__`, 'gu');
  for (let pass = 0; pass <= protectedBlocks.length; pass += 1) {
    const next = result.replace(pattern, (token, index) => (
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
  const source = String(html || '');
  const parts = [];
  let end = source.length;
  // Keep reverse protection order without copying the remaining document for
  // every block. Each source character is sliced and joined at most once.
  for (let index = ranges.length - 1; index >= 0; index--) {
    const range = ranges[index];
    parts.push(source.slice(range.end, end), protect(source.slice(range.start, range.end)));
    end = range.start;
  }
  parts.push(source.slice(0, end));
  return parts.reverse().join('');
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
  let protectedEnd = -1;
  return ranges
    .sort((left, right) => (left.start - right.start) || (right.end - left.end))
    .filter((range) => {
      if (range.end <= protectedEnd) return false;
      protectedEnd = range.end;
      return true;
    });
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


    return { formatShortDate, formatShortDateTime, translateUi, t, translateText, localizeUiHtml, localizeUiHtmlOutsideProtectedHtml, restoreProtectedUiContentBlocks, protectUiContentBlocks, findProtectedUiContentRanges, isProtectedUiContentTag, hasHtmlClass, hasHtmlAttribute, localizeElement, localizeFragment, unescapeBasicHtml, decodeHtmlCodePoint };
  }
  globalScope.CodexWebLocalization = { createRenderer };
}(globalThis));
