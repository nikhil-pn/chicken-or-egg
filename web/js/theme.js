// Light or dark. Runs before the page paints, so a saved choice never flashes.
// Without a saved choice the page follows the device setting.
(function () {
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem('coe-theme'); } catch (problem) { /* private window: follow the device */ }
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);

  function isDark() {
    var chosen = root.getAttribute('data-theme');
    return chosen ? chosen === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var button = document.getElementById('theme-toggle');
    if (!button) return;
    function label() {
      button.textContent = isDark() ? '☀️' : '🌙';
      button.setAttribute('aria-label', isDark() ? 'Switch to light colours' : 'Switch to dark colours');
      button.setAttribute('title', isDark() ? 'Light colours' : 'Dark colours');
    }
    button.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('coe-theme', next); } catch (problem) { /* the choice lasts for this visit only */ }
      label();
    });
    label();
  });
})();
