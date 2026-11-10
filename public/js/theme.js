(() => {
  const KEY = 'beceko-theme';
  const COLOURS = { light: '#fbfcfe', dark: '#0f1422' };
  const root = document.documentElement;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  const saved = () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  };
  const current = () => root.dataset.theme ?? (systemDark.matches ? 'dark' : 'light');

  function apply(theme) {
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLOURS[current()]);
    document.getElementById('theme-toggle')?.setAttribute('aria-checked', String(current() === 'dark'));
  }

  apply(saved());
  systemDark.addEventListener('change', () => apply());

  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('theme-toggle').addEventListener('click', () => {
      const next = current() === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {}
      apply(next);
    });
  });
})();
