// Kept independent of app.js so failed shell dependencies still have a way out.
(() => {
  let ready = false;
  let failure = '';
  let language = 'en';
  try { language = localStorage.getItem('codexWebLanguage') || language; } catch (_error) {}
  const zh = language === 'zh-CN';
  function showFailure(reason) {
    if (ready) return;
    failure = reason;
    const shell = document.querySelector('.boot-shell');
    if (!shell) return;
    const title = shell.querySelector('.boot-wordmark');
    const hint = shell.querySelector('.boot-help-message');
    title.textContent = reason === 'slow'
      ? (zh ? '加载时间较长' : 'Taking longer to load')
      : (zh ? '页面未能加载' : 'Page could not load');
    hint.textContent = zh ? '请检查网络连接后重新加载。' : 'Check your connection and reload the page.';
    shell.querySelector('.boot-progress')?.setAttribute('hidden', '');
    shell.querySelector('.boot-help').open = true;
    shell.setAttribute('role', 'alert');
    shell.setAttribute('aria-label', title.textContent);
  }
  function handleError(event) {
    if (event.target?.tagName === 'SCRIPT' || event.target?.tagName === 'LINK' || event.error) showFailure('failed');
  }
  const timer = setTimeout(() => showFailure('slow'), 15000);
  window.addEventListener('error', handleError, true);
  document.addEventListener('DOMContentLoaded', () => {
    const help = document.querySelector('.boot-help');
    if (help && zh) {
      help.querySelector('summary').textContent = '加载遇到问题？';
      help.querySelector('a').textContent = '重新加载';
      help.querySelector('p').textContent = '请检查网络连接后重新加载。';
    }
    if (failure) showFailure(failure);
  }, { once: true });
  globalThis.CodexWebBoot = {
    ready() {
      ready = true;
      clearTimeout(timer);
      window.removeEventListener('error', handleError, true);
    },
  };
})();
