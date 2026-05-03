// Tab Navigation
document.querySelectorAll('.tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(function(b) {
      b.classList.remove('active');
    });
    document.querySelectorAll('.tab-content').forEach(function(t) {
      t.classList.remove('active');
    });
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// Theme Preset Selection
document.querySelectorAll('.theme-preset').forEach(function(preset) {
  preset.addEventListener('click', function() {
    document.querySelectorAll('.theme-preset').forEach(function(p) {
      p.classList.remove('active');
    });
    document.querySelectorAll('.theme-preset[data-theme="' + preset.dataset.theme + '"]').forEach(function(p) {
      p.classList.add('active');
    });
    document.body.setAttribute('data-theme', preset.dataset.theme);
  });
});
