(function installCodexWebAttachments(globalObject) {
  function fileNameFromPath(filePath) {
    const parts = String(filePath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function formatAttachmentSize(sizeBytes) {
    const size = Number(sizeBytes);
    if (!Number.isFinite(size) || size <= 0) {
      return '';
    }
    if (size < 1024) {
      return `${size} B`;
    }
    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  function parseAttachmentPromptText(text) {
    const rawText = typeof text === 'string' ? text.trim() : '';
    const footer = 'Use the local file paths above when you inspect these attachments.';
    const footerIndex = rawText.lastIndexOf(`\n${footer}`);
    if (footerIndex < 0) {
      return { text: rawText, attachments: [] };
    }
    const beforeFooter = rawText.slice(0, footerIndex).trimEnd();
    const marker = '\n\nAttachments:\n';
    let markerIndex = beforeFooter.lastIndexOf(marker);
    let blockStart = markerIndex >= 0 ? markerIndex + marker.length : -1;
    if (markerIndex < 0 && beforeFooter.startsWith('Attachments:\n')) {
      markerIndex = 0;
      blockStart = 'Attachments:\n'.length;
    }
    if (markerIndex < 0 || blockStart < 0) {
      return { text: rawText, attachments: [] };
    }
    const parsedAttachments = parseAttachmentPromptBlock(beforeFooter.slice(blockStart));
    if (!parsedAttachments.length) {
      return { text: rawText, attachments: [] };
    }
    const displayText = beforeFooter.slice(0, markerIndex).trim();
    return {
      text: displayText === 'User sent attachments without additional text.' ? '' : displayText,
      attachments: parsedAttachments,
    };
  }

  function parseAttachmentPromptBlock(blockText) {
    const attachments = [];
    let current = null;
    const pushCurrent = () => {
      if (!current?.localPath) {
        return;
      }
      attachments.push({
        kind: current.kind === 'image' ? 'image' : 'file',
        localPath: current.localPath,
        fileName: current.fileName || fileNameFromPath(current.localPath),
        mimeType: current.mimeType || null,
      });
    };
    for (const line of String(blockText || '').split('\n')) {
      const itemMatch = line.match(/^\d+\.\s+(.+?)\s*$/u);
      if (itemMatch) {
        pushCurrent();
        const label = String(itemMatch[1] || '').toLowerCase();
        current = {
          kind: label.includes('image') ? 'image' : 'file',
          localPath: '',
          fileName: '',
          mimeType: '',
        };
        continue;
      }
      const fieldMatch = line.match(/^\s+(path|filename|mime):\s*(.*?)\s*$/u);
      if (!fieldMatch || !current) {
        continue;
      }
      const value = String(fieldMatch[2] || '').trim();
      if (fieldMatch[1] === 'path') {
        current.localPath = value;
      } else if (fieldMatch[1] === 'filename') {
        current.fileName = value;
      } else if (fieldMatch[1] === 'mime') {
        current.mimeType = value;
      }
    }
    pushCurrent();
    return attachments;
  }

  function normalizeTimelineAttachments(attachments) {
    return (Array.isArray(attachments) ? attachments : [])
      .map((attachment) => normalizeTimelineAttachment(attachment))
      .filter(Boolean);
  }

  function normalizeTimelineAttachment(attachment) {
    if (!attachment || typeof attachment !== 'object') {
      return null;
    }
    const localPath = typeof attachment.localPath === 'string' ? attachment.localPath.trim() : '';
    const fileName = typeof attachment.fileName === 'string' ? attachment.fileName.trim() : '';
    const mimeType = typeof attachment.mimeType === 'string' ? attachment.mimeType.trim() : '';
    if (!localPath && !fileName) {
      return null;
    }
    return {
      kind: attachment.kind === 'image' ? 'image' : 'file',
      localPath,
      fileName: fileName || fileNameFromPath(localPath) || 'upload',
      mimeType: mimeType || null,
      sizeBytes: Number.isFinite(attachment.sizeBytes) ? Number(attachment.sizeBytes) : null,
    };
  }

  function mergeTimelineAttachments(...attachmentGroups) {
    const merged = [];
    const seen = new Set();
    for (const attachment of attachmentGroups.flatMap((group) => normalizeTimelineAttachments(group))) {
      const key = attachment.localPath || `${attachment.kind}:${attachment.fileName}:${attachment.mimeType || ''}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(attachment);
    }
    return merged;
  }

  globalObject.CodexWebAttachments = Object.freeze({
    fileNameFromPath,
    formatAttachmentSize,
    mergeTimelineAttachments,
    normalizeTimelineAttachment,
    normalizeTimelineAttachments,
    parseAttachmentPromptBlock,
    parseAttachmentPromptText,
  });
})(globalThis);
