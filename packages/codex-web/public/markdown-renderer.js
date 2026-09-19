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

    function renderMarkdownTable(header, rows, alignments = [], documentMode = false) {
      const alignment = (index) => ` style="text-align: ${escapeHtml(alignments[index] || 'left')};"`;
      const headHtml = header.map((cell, index) => `<th${alignment(index)}>${renderInlineMarkdown(cell)}</th>`).join('');
      const bodyHtml = rows.map((row) => `<tr>${row.map((cell, index) => `<td${alignment(index)}>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('');
      const scrollAttributes = documentMode ? ` tabindex="0" role="region" aria-label="${escapeHtml(header.join(' / '))}"` : '';
      return `<div class="markdown-table"${scrollAttributes}><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
    }

    const rulePattern = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/u;

    function listMarker(line) {
      const match = line.replace(/^\t+/u, tabs => '    '.repeat(tabs.length)).match(/^( *)([-+*]|(\d{1,9})[.)])(\s+)(.*)$/u);
      return match && { indent: match[1].length, contentIndent: match[1].length + match[2].length + match[4].length, tag: match[3] ? 'ol' : 'ul', start: Number(match[3]), content: match[5] };
    }

    function parseMarkdownList(lines, startIndex, options) {
      const first = listMarker(lines[startIndex]);
      const items = [];
      let cursor = startIndex;
      let loose = false;
      while (cursor < lines.length) {
        const marker = listMarker(lines[cursor]);
        if (!marker || marker.indent !== first.indent || marker.tag !== first.tag) break;
        const content = [marker.content];
        cursor += 1;
        while (cursor < lines.length) {
          const line = lines[cursor].replace(/^\t+/u, tabs => '    '.repeat(tabs.length));
          const next = listMarker(line);
          if (next && next.indent <= first.indent) break;
          if (!line.trim()) {
            let afterBlank = cursor + 1;
            while (afterBlank < lines.length && !lines[afterBlank].trim()) afterBlank += 1;
            const following = lines[afterBlank] || '';
            const sibling = listMarker(following);
            if (sibling && sibling.indent === first.indent && sibling.tag === first.tag) {
              loose = true;
              cursor = afterBlank;
              break;
            }
            if (following.search(/\S/u) >= marker.contentIndent) {
              loose = true;
              content.push('');
              cursor = afterBlank;
              continue;
            }
            break;
          }
          if (line.search(/\S/u) >= marker.contentIndent) {
            content.push(line.slice(marker.contentIndent));
          } else {
            // Only plain text can lazily continue the current list item.
            if (next || /^\s*(?:#{1,6}\s|>|`{3,}|~{3,})/u.test(line) || rulePattern.test(line) || parseMarkdownTable(lines, cursor)) break;
            content.push(line.trim());
          }
          cursor += 1;
        }
        items.push(content.join('\n'));
      }
      const start = first.tag === 'ol' && first.start !== 1 ? ` start="${first.start}"` : '';
      const html = items.map(item => {
        const body = renderMarkdown(item, { ...options, depth: options.depth + 1 });
        return `<li>${loose ? body : body.replace(/^<p>([\s\S]*?)<\/p>/u, '$1')}</li>`;
      }).join('');
      return { html: `<${first.tag}${start}>${html}</${first.tag}>`, lastLineIndex: cursor - 1 };
    }

    function renderMarkdown(value, { documentMode = false, depth = 0 } = {}) {
      const lines = String(value || '').replace(/\r\n?/gu, '\n').split('\n');
      const blocks = [];
      let paragraph = [];
      let quoteLines = [];
      let codeLines = [];
      let fence = '';
      let codeLanguage = '';
      const flushParagraph = () => {
        if (paragraph.length) {
          blocks.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
          paragraph = [];
        }
      };
      const flushQuote = () => {
        if (quoteLines.length) {
          blocks.push(`<blockquote>${quoteLines.map((line) => `<p>${renderInlineMarkdown(line)}</p>`).join('')}</blockquote>`);
          quoteLines = [];
        }
      };
      const flushCode = () => {
        const scrollAttributes = documentMode ? ` tabindex="0" role="region" aria-label="${escapeHtml(codeLanguage || 'Code')}"` : '';
        const code = `<pre${scrollAttributes}><code>${escapeHtml(`${codeLines.join('\n')}\n`)}</code></pre>`;
        blocks.push(documentMode ? `<figure class="markdown-code">${codeLanguage ? `<figcaption>${escapeHtml(codeLanguage)}</figcaption>` : ''}${code}</figure>` : code);
        codeLines = [];
      };
      const flushTextBlocks = () => {
        flushParagraph();
        flushQuote();
      };

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const codeFence = line.match(/^\s*(`{3,}|~{3,})(.*)$/u);
        if (fence) {
          if (codeFence && codeFence[1][0] === fence[0] && codeFence[1].length >= fence.length && !codeFence[2].trim()) {
            flushCode();
            fence = '';
          } else {
            codeLines.push(line);
          }
          continue;
        }
        if (codeFence) {
          flushTextBlocks();
          fence = codeFence[1];
          codeLanguage = codeFence[2].trim().split(/\s/u)[0].slice(0, 80);
          continue;
        }
        if (!line.trim()) {
          flushTextBlocks();
          continue;
        }
        const table = parseMarkdownTable(lines, index);
        if (table) {
          flushTextBlocks();
          blocks.push(renderMarkdownTable(table.header, table.rows, table.alignments, documentMode));
          index = table.lastLineIndex;
          continue;
        }
        const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/u);
        if (heading) {
          flushTextBlocks();
          blocks.push(`<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`);
          continue;
        }
        if (rulePattern.test(line)) {
          flushTextBlocks();
          blocks.push('<hr>');
          continue;
        }
        if (depth < 32 && listMarker(line)) {
          flushTextBlocks();
          const list = parseMarkdownList(lines, index, { documentMode, depth });
          blocks.push(list.html);
          index = list.lastLineIndex;
          continue;
        }
        const quote = line.match(/^>\s?(.+)$/u);
        if (quote) {
          flushParagraph();
          quoteLines.push(quote[1]);
          continue;
        }
        flushQuote();
        paragraph.push(line.trim());
      }
      if (fence) {
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
