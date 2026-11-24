(() => {
  try {
    const theme = localStorage.getItem('openblog-theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch { /* System preferences still apply when storage is unavailable. */ }
})();
