(function installCodexWebMarkdown(globalObject) {
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function decodeHtmlEntityText(value) {
    return String(value || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function stripSessionFileLocationSuffix(value) {
    return String(value || '').replace(/:\d+(?::\d+)?$/u, '');
  }

  function normalizeSessionFileDestination(value) {
    const destination = decodeHtmlEntityText(value).trim();
    if (destination.startsWith('<') && destination.endsWith('>')) {
      return destination.slice(1, -1).trim();
    }
    return destination;
  }

  function isSessionFilePath(value) {
    const filePath = stripSessionFileLocationSuffix(normalizeSessionFileDestination(value));
    if (
      !filePath
      || /^(?:[a-z][a-z\d+.-]*:|#)/iu.test(filePath)
      || /[<>\u0000-\u001f\u007f]/u.test(filePath)
    ) {
      return false;
    }
    return /\.[\p{L}\p{N}][\p{L}\p{N}._+-]{0,31}(?:[?#][^\s]*)?$/iu.test(filePath);
  }

  function isLegacyReportPath(value) {
    return /(?:^|[\\/])\.codex-web[\\/]reports[\\/].+\.(?:md|markdown|html?)$/iu.test(decodeHtmlEntityText(value));
  }

  function createRenderer({ canRenderSessionFileLink = () => true } = {}) {
    function renderSessionFileLink(label, href) {
      const filePath = normalizeSessionFileDestination(href);
      return `<a href="#" class="session-file-link" data-session-file-path="${escapeHtml(filePath)}">${label}</a>`;
    }

    function linkPlainSessionFilePaths(html) {
      return String(html || '').replace(
        /(^|[\s:：>（(])((?:(?:~?\/|\.\.?\/)?(?:[^\s\/<>"'`()：:]+\/)*[^\s\/<>"'`(),，。！？!?；;：:]+\.(?:md|markdown|html?|pdf|txt|rtf|docx?|odt|xlsx?|xlsm|ods|csv|tsv|pptx?|odp|epub|png|jpe?g|gif|webp|bmp|avif|tiff?|svg|heic|mp3|wav|m4a|flac|mp4|mov|webm|zip|7z|rar|tar|gz|tgz|bz2|xz|zst|[cm]?[jt]sx?|jsonc?|jsonl|xml|ya?ml|toml|ini|conf|log|sql|sqlite|db|css|scss|less|sh|bash|zsh|fish|py|rb|rs|go|java|kt|swift|c|cc|cpp|h|hpp|bin|dmg|pkg|apk|ipa|exe)))(?=$|[\s<),，。！？!?；;:：])/giu,
        (_match, prefix, filePath) => {
          if (!isSessionFilePath(filePath) || !canRenderSessionFileLink(filePath)) {
            return `${prefix}${filePath}`;
          }
          return `${prefix}${renderSessionFileLink(filePath, filePath)}`;
        },
      );
    }

    function renderInlineMarkdown(value) {
      const tokens = [];
      const reserve = (html) => {
        const token = `\u0001${tokens.length}\u0002`;
        tokens.push(html);
        return token;
      };
      let source = String(value || '');
      source = source.replace(/\[([^\]\r\n]+)\]\(\s*(?:<([^>\r\n]+)>|([^)\s]+))\s*\)/gu, (match, label, wrappedHref, plainHref) => {
        const decodedHref = normalizeSessionFileDestination(wrappedHref ?? plainHref);
        if (/^https?:\/\//iu.test(decodedHref)) {
          return reserve(`<a href="${escapeHtml(decodedHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
        }
        if (isSessionFilePath(decodedHref) && canRenderSessionFileLink(decodedHref)) {
          return reserve(renderSessionFileLink(escapeHtml(label), decodedHref));
        }
        return match;
      });
      source = source.replace(/`([^`]+)`/gu, (_match, code) => {
        return reserve(`<code>${linkPlainSessionFilePaths(escapeHtml(code))}</code>`);
      });
      let html = escapeHtml(source)
        .replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/gu, '<em>$1</em>');
      html = linkPlainSessionFilePaths(html);
      return html.replace(/\u0001(\d+)\u0002/gu, (_match, index) => tokens[Number(index)] || '');
    }

    function parseMarkdownTableRow(line) {
      const trimmed = String(line || '').trim();
      if (!trimmed || !trimmed.includes('|')) {
        return null;
      }
      const cells = [];
      let current = '';
      let index = trimmed.startsWith('|') ? 1 : 0;
      let codeDelimiterLength = 0;
      let endedWithDelimiter = false;

      while (index < trimmed.length) {
        const character = trimmed[index];
        const nextCharacter = trimmed[index + 1];
        if (codeDelimiterLength === 0 && character === '\\' && nextCharacter === '|') {
          current += '|';
          index += 2;
          endedWithDelimiter = false;
          continue;
        }
        if (character === '`') {
          const runLength = countRepeatedCharacter(trimmed, index, '`');
          if (codeDelimiterLength === 0) {
            codeDelimiterLength = runLength;
          } else if (runLength === codeDelimiterLength) {
            codeDelimiterLength = 0;
          }
          current += '`'.repeat(runLength);
          index += runLength;
          endedWithDelimiter = false;
          continue;
        }
        if (codeDelimiterLength === 0 && character === '|') {
          cells.push(current.trim());
          current = '';
          index += 1;
          endedWithDelimiter = true;
          continue;
        }
        current += character;
        index += 1;
        endedWithDelimiter = false;
      }
      if (!endedWithDelimiter || current.length > 0) {
        cells.push(current.trim());
      }
      return cells.length < 2 ? null : cells;
    }

    function countRepeatedCharacter(value, startIndex, character) {
      let index = startIndex;
      while (index < value.length && value[index] === character) {
        index += 1;
      }
      return index - startIndex;
    }

    function parseMarkdownTableDivider(line, expectedColumns) {
      const cells = parseMarkdownTableRow(line);
      if (!cells || cells.length !== expectedColumns) {
        return null;
      }
      const alignments = [];
      for (const cell of cells) {
        if (!/^:?-{3,}:?$/u.test(cell)) {
          return null;
        }
        const leftAligned = cell.startsWith(':');
        const rightAligned = cell.endsWith(':');
        alignments.push(leftAligned && rightAligned ? 'center' : rightAligned ? 'right' : 'left');
      }
      return alignments;
    }

    function parseMarkdownTable(lines, startIndex) {
      const header = parseMarkdownTableRow(lines[startIndex]);
      if (!header || startIndex + 1 >= lines.length) {
        return null;
      }
      const alignments = parseMarkdownTableDivider(lines[startIndex + 1], header.length);
      if (!alignments) {
        return null;
      }
      const rows = [];
      let cursor = startIndex + 2;
      while (cursor < lines.length) {
        const row = parseMarkdownTableRow(lines[cursor]);
        if (!row || row.length !== header.length) {
          break;
        }
        rows.push(row);
        cursor += 1;
      }
      return { header, alignments, rows, lastLineIndex: cursor - 1 };
    }

    function renderMarkdownTable(header, rows, alignments = []) {
      const alignment = (index) => ` style="text-align: ${escapeHtml(alignments[index] || 'left')};"`;
      const headHtml = header.map((cell, index) => `<th${alignment(index)}>${renderInlineMarkdown(cell)}</th>`).join('');
      const bodyHtml = rows.map((row) => `<tr>${row.map((cell, index) => `<td${alignment(index)}>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('');
      return `<div class="markdown-table"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
    }

    function renderMarkdown(value) {
      const lines = String(value || '').replace(/\r\n?/gu, '\n').split('\n');
      const blocks = [];
      let paragraph = [];
      let listItems = [];
      let quoteLines = [];
      let codeLines = [];
      let inCode = false;
      const flushParagraph = () => {
        if (paragraph.length) {
          blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
          paragraph = [];
        }
      };
      const flushList = () => {
        if (listItems.length) {
          blocks.push(`<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
          listItems = [];
        }
      };
      const flushQuote = () => {
        if (quoteLines.length) {
          blocks.push(`<blockquote>${quoteLines.map((line) => `<p>${renderInlineMarkdown(line)}</p>`).join('')}</blockquote>`);
          quoteLines = [];
        }
      };
      const flushCode = () => {
        blocks.push(`<pre><code>${escapeHtml(`${codeLines.join('\n')}\n`)}</code></pre>`);
        codeLines = [];
      };
      const flushTextBlocks = () => {
        flushParagraph();
        flushList();
        flushQuote();
      };

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (/^```/u.test(line.trim())) {
          if (inCode) {
            flushCode();
            inCode = false;
          } else {
            flushTextBlocks();
            inCode = true;
            codeLines = [];
          }
          continue;
        }
        if (inCode) {
          codeLines.push(line);
          continue;
        }
        if (!line.trim()) {
          flushTextBlocks();
          continue;
        }
        const table = parseMarkdownTable(lines, index);
        if (table) {
          flushTextBlocks();
          blocks.push(renderMarkdownTable(table.header, table.rows, table.alignments));
          index = table.lastLineIndex;
          continue;
        }
        const heading = line.match(/^(#{1,3})\s+(.+)$/u);
        if (heading) {
          flushTextBlocks();
          blocks.push(`<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`);
          continue;
        }
        const listItem = line.match(/^\s*[-*]\s+(.+)$/u);
        if (listItem) {
          flushParagraph();
          flushQuote();
          listItems.push(listItem[1]);
          continue;
        }
        const quote = line.match(/^>\s?(.+)$/u);
        if (quote) {
          flushParagraph();
          flushList();
          quoteLines.push(quote[1]);
          continue;
        }
        flushList();
        flushQuote();
        paragraph.push(line.trim());
      }
      if (inCode) {
        flushCode();
      } else {
        flushTextBlocks();
      }
      return blocks.join('');
    }

    return Object.freeze({ renderMarkdown });
  }

  globalObject.CodexWebMarkdown = Object.freeze({
    createRenderer,
    decodeHtmlEntityText,
    isLegacyReportPath,
    isSessionFilePath,
    normalizeSessionFileDestination,
    stripSessionFileLocationSuffix,
  });
})(globalThis);
