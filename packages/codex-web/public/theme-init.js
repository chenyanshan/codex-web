(() => {
  const themeColors = {
    retro: '#fcf9f2',
    'dark-gold': '#18181a',
    'oled-black': '#000000',
    'fresh-light': '#f4f5f7',
  };
  let theme = 'fresh-light';
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
