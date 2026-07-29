(() => {
  const themeColors = {
    sunny: '#f8f3e3',
    light: '#f6f8fa',
    dark: '#181a1f',
    nord: '#252a35',
    forest: '#101613',
    rose: '#f9f4f5',
    amber: '#18181b',
    'one-dark': '#21252b',
    gruvbox: '#1d2021',
    catppuccin: '#1e1e2e',
    dracula: '#282a36',
  };
  let theme = 'sunny';
  try {
    const savedTheme = localStorage.getItem('codexWebTheme');
    if (savedTheme && Object.prototype.hasOwnProperty.call(themeColors, savedTheme)) {
      theme = savedTheme;
    }
  } catch (_error) {
    // Storage can be unavailable in strict or private browser contexts.
  }
  document.documentElement.dataset.theme = theme;
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  themeColorMeta?.setAttribute('content', themeColors[theme]);
})();
