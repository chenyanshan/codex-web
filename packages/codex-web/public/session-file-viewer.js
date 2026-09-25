// Focused presentation boundary; all application capabilities are explicit.
(function install(globalScope) {
  function createRenderer(context) {
    const { localizeFragment, localizeElement, state, fileNameFromPath, t, sessionActivityState, renderBackButtonIcon, escapeAttribute, escapeHtml, renderDownloadButtonIcon, formatAttachmentSize, renderMarkdown, SESSION_FILE_HTML_CSP } = context;
function renderDesktopSessionFileOverlay() {
  return localizeFragment(`
    <section class="desktop-overlay desktop-session-file-overlay" role="dialog" aria-modal="true" aria-label="File preview" data-focus-scope="session-file">
      <div class="desktop-overlay-card desktop-session-file-card">
        ${renderSessionFileViewerContent()}
      </div>
    </section>
  `);
}

function renderSessionFileViewer() {
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = localizeFragment(`
    <div class="screen page-screen session-file-screen">
      ${renderSessionFileViewerContent()}
    </div>
  `);
  return localizeElement(shell);
}

function renderSessionFileViewerContent(file = state.currentSessionFile) {
  const title = file?.name || fileNameFromPath(state.currentSessionFilePath) || t('File');
  const canDownload = Boolean(state.currentSessionFileObjectUrl && file && !file.previewTruncated);
  const activityState = sessionActivityState(state.currentSession);
  const activityLabel = activityState === 'waiting_approval'
    ? 'Needs approval'
    : activityState === 'running'
      ? 'Working'
      : '';
  return `
    <header class="topbar page-topbar session-file-topbar">
      <div class="page-nav">
        <button class="ghost page-back-button" type="button" id="close-session-file-button" aria-label="Back" data-initial-focus>${renderBackButtonIcon()}</button>
        <div class="session-file-title-stack">
          <div class="page-title" data-i18n-skip title="${escapeAttribute(title)}">${escapeHtml(title)}</div>
          ${activityLabel ? `<span class="session-file-activity" data-state="${escapeAttribute(activityState)}">${escapeHtml(t(activityLabel))}</span>` : ''}
        </div>
        ${canDownload
          ? `<a class="ghost page-nav-action session-file-download" id="session-file-download" href="${escapeAttribute(state.currentSessionFileObjectUrl)}" download="${escapeAttribute(title)}" aria-label="Download" title="Download">${renderDownloadButtonIcon()}</a>`
          : `<button class="ghost page-nav-action session-file-download" type="button" aria-label="Download" title="Download" disabled>${renderDownloadButtonIcon()}</button>`}
      </div>
    </header>
    <main class="session-file-viewer">${file?.previewTruncated ? `<div class="history-load-error" role="status">${escapeHtml(t('Preview truncated. Download the complete file.'))} (${escapeHtml(formatAttachmentSize(file.totalBytes))})<button class="ghost" id="download-full-session-file" type="button">${escapeHtml(t('Download'))}</button></div>` : ''}${renderSessionFileViewerBody(file)}</main>
  `;
}

function renderSessionFileViewerBody(file = state.currentSessionFile) {
  if (file?.previewUnavailable) return `<div class="empty-state">${escapeHtml(t('This file is too large to preview.'))}</div>`;
  if (state.currentSessionFileLoading) {
    return localizeFragment('<div class="empty-state session-file-loading">Loading file...</div>');
  }
  if (state.currentSessionFileError) {
    return `
      <div class="session-file-error" role="alert">
        <strong>${escapeHtml(t(sessionFileErrorMessage(state.currentSessionFileError)))}</strong>
        <button class="ghost compact-button" type="button" id="retry-session-file-button">${escapeHtml(t('Retry'))}</button>
      </div>
    `;
  }
  if (!file) {
    return `<div class="empty-state">${escapeHtml(t('File not loaded.'))}</div>`;
  }
  return renderSessionFileDocument(file);
}

function renderSessionFileDocument(file) {
  if (file.kind === 'html') {
    return `<iframe class="session-file-frame session-file-html" title="${escapeAttribute(file.name || t('File'))}" sandbox="" referrerpolicy="no-referrer" srcdoc="${escapeAttribute(sandboxedSessionFileHtml(state.currentSessionFileContent || ''))}"></iframe>`;
  }
  if (file.kind === 'pdf' && state.currentSessionFileObjectUrl) {
    return `<iframe class="session-file-frame session-file-pdf" title="${escapeAttribute(file.name || t('File'))}" src="${escapeAttribute(state.currentSessionFileObjectUrl)}"></iframe>`;
  }
  if (file.kind === 'image' && state.currentSessionFileObjectUrl) {
    return `<div class="session-file-image-stage"><img class="session-file-image" src="${escapeAttribute(state.currentSessionFileObjectUrl)}" alt="${escapeAttribute(file.name || t('File'))}"></div>`;
  }
  if (file.kind === 'file') {
    return `
      <div class="session-file-generic">
        <strong data-i18n-skip>${escapeHtml(file.name || t('File'))}</strong>
        <span class="meta" data-i18n-skip>${escapeHtml(sessionFileMetadata(file))}</span>
        ${state.currentSessionFileObjectUrl ? `<a class="primary compact-button" href="${escapeAttribute(state.currentSessionFileObjectUrl)}" download="${escapeAttribute(file.name || 'download')}">${escapeHtml(t('Download'))}</a>` : ''}
      </div>
    `;
  }
  return `<div class="session-file-document markdown-body" data-i18n-skip>${renderMarkdown(state.currentSessionFileContent || '', true)}</div>`;
}

function sandboxedSessionFileHtml(content) {
  return `<meta http-equiv="Content-Security-Policy" content="${SESSION_FILE_HTML_CSP}">${String(content || '')}`;
}

// Only raster images are embedded; HTML scripts and external resources remain blocked.
async function embedSessionFileImages(content, documentPath, readImage, signal) {
  const template = document.createElement('template');
  template.innerHTML = content;
  const images = [...template.content.querySelectorAll('img[src]')].slice(0, 64);
  const cache = new Map();
  let remainingBytes = 16 * 1024 * 1024;
  for (const image of images) {
    signal?.throwIfAborted();
    const src = String(image.getAttribute('src') || '').trim();
    if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu.test(src)) continue;
    let imagePath;
    try {
      const local = decodeURIComponent(src.split(/[?#]/u)[0]);
      imagePath = local.startsWith('/') ? local : documentPath.slice(0, documentPath.lastIndexOf('/') + 1) + local;
    } catch { continue; }
    try {
      if (!cache.has(imagePath)) {
        const blob = await readImage(imagePath, Math.min(2 * 1024 * 1024, remainingBytes));
        signal?.throwIfAborted();
        if (!blob || !/^image\/(?:png|jpeg|gif|webp|bmp|avif)$/u.test(blob.type) || blob.size > Math.min(2 * 1024 * 1024, remainingBytes)) {
          cache.set(imagePath, '');
        } else {
          remainingBytes -= blob.size;
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          cache.set(imagePath, dataUrl);
        }
      }
      if (cache.get(imagePath)) {
        image.setAttribute('src', cache.get(imagePath));
        image.removeAttribute('srcset');
        // A picture source must not override the authenticated embedded image.
        if (image.parentElement?.tagName === 'PICTURE') image.parentElement.querySelectorAll('source').forEach(source => source.remove());
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error?.status === 401) throw error;
      cache.set(imagePath, '');
    }
  }
  signal?.throwIfAborted();
  return template.innerHTML;
}

function normalizeSessionFile(file, fallbackPath = '') {
  if (!file || typeof file !== 'object') {
    return null;
  }
  const name = typeof file.name === 'string' && file.name.trim()
    ? file.name.trim()
    : fileNameFromPath(fallbackPath || file.id) || 'file';
  const kind = normalizeSessionFileKind(file.kind, name || fallbackPath);
  return {
    id: typeof file.id === 'string' ? file.id : '',
    name,
    kind,
    mimeType: typeof file.mimeType === 'string' ? file.mimeType : '',
    sizeBytes: Number.isFinite(file.sizeBytes) ? Number(file.sizeBytes) : 0,
    updatedAt: typeof file.updatedAt === 'string' ? file.updatedAt : '',
    source: typeof file.source === 'string' ? file.source : '',
    contentUrl: typeof file.contentUrl === 'string' ? file.contentUrl : '',
    downloadUrl: typeof file.downloadUrl === 'string' ? file.downloadUrl : '',
  };
}

function sessionFilePlaceholder(filePath) {
  return normalizeSessionFile({
    name: fileNameFromPath(filePath),
    kind: sessionFileKindFromPath(filePath),
  }, filePath);
}

function normalizeSessionFileKind(kind, filePath = '') {
  const normalized = String(kind || '').toLowerCase();
  if (['markdown', 'html', 'pdf', 'image', 'file'].includes(normalized)) {
    return normalized;
  }
  return sessionFileKindFromPath(filePath);
}

function sessionFileKindFromPath(filePath) {
  const normalized = String(filePath || '').split(/[?#]/u)[0].toLowerCase();
  if (/\.(?:md|markdown)$/u.test(normalized)) {
    return 'markdown';
  }
  if (/\.html?$/u.test(normalized)) {
    return 'html';
  }
  if (/\.pdf$/u.test(normalized)) {
    return 'pdf';
  }
  if (/\.(?:png|jpe?g|gif|webp|bmp|avif|tiff?)$/u.test(normalized)) {
    return 'image';
  }
  return 'file';
}

function sessionFileMetadata(file) {
  return [
    file?.mimeType || '',
    Number(file?.sizeBytes) > 0 ? formatAttachmentSize(file.sizeBytes) : '',
  ].filter(Boolean).join(' · ');
}

function isSafeSessionFileContentUrl(value) {
  const contentUrl = String(value || '').trim();
  const origin = String(window.location?.origin || '').trim();
  if (!contentUrl || !origin) {
    return false;
  }
  try {
    const resolved = new URL(contentUrl, `${origin}/`);
    return resolved.origin === origin
      && !resolved.username
      && !resolved.password
      && /^\/api\/(?:admin\/)?sessions\/[^/]+\/files\/[^/]+\/content$/u.test(resolved.pathname);
  } catch (_error) {
    return false;
  }
}

function sessionFileProtocolError() {
  const error = new Error('Could not open this file.');
  error.payload = { error: 'invalid_file_response' };
  return error;
}

function sessionFileErrorCode(error) {
  return String(error?.payload?.error || error?.message || 'file_error');
}

function sessionFileErrorMessage(code) {
  if (code === 'file_not_found') {
    return 'File not found.';
  }
  if (code === 'file_access_denied') {
    return 'File access denied.';
  }
  if (code === 'unsupported_file') {
    return 'This file cannot be previewed.';
  }
  if (code === 'file_too_large') {
    return 'This file is too large to open.';
  }
  if (code === 'file_busy') {
    return 'File preview is busy. Try again.';
  }
  return 'Could not open this file.';
}

function decodeSessionFilePath(value) {
  try {
    return decodeURIComponent(String(value || '')).trim();
  } catch (_error) {
    return String(value || '').trim();
  }
}

function createTextFileBlob(content, mimeType = '') {
  if (typeof Blob === 'undefined') {
    return null;
  }
  return new Blob([String(content || '')], { type: mimeType || 'text/plain;charset=utf-8' });
}

function createSessionFileObjectUrl(blob) {
  if (!blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return '';
  }
  return URL.createObjectURL(blob);
}

function revokeSessionFileObjectUrl() {
  const objectUrl = state.currentSessionFileObjectUrl;
  state.currentSessionFileObjectUrl = '';
  if (!objectUrl || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
    return;
  }
  URL.revokeObjectURL(objectUrl);
}


    return { embedSessionFileImages, renderDesktopSessionFileOverlay, renderSessionFileViewer, renderSessionFileViewerContent, renderSessionFileViewerBody, renderSessionFileDocument, sandboxedSessionFileHtml, normalizeSessionFile, sessionFilePlaceholder, normalizeSessionFileKind, sessionFileKindFromPath, sessionFileMetadata, isSafeSessionFileContentUrl, sessionFileProtocolError, sessionFileErrorCode, sessionFileErrorMessage, decodeSessionFilePath, createTextFileBlob, createSessionFileObjectUrl, revokeSessionFileObjectUrl };
  }
  globalScope.CodexWebFileViewer = { createRenderer };
}(globalThis));
