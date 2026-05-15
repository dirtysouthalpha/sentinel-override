// popup-modules/onboarding.js (3.12.0)
// First-run onboarding flow. Triggers when chrome.storage.local doesn't
// have sentinelOnboardingDone === true. Steps through the welcome modal,
// then sets the flag so future popup loads skip past.
//
// Skip is also persisted (so it's only really first-run, never recurring).

(function() {
  const TOTAL_STEPS = 4;
  let currentStep = 1;

  function _qs(id) { return document.getElementById(id); }

  function showStep(n) {
    document.querySelectorAll('.onboarding-step').forEach(el => {
      el.style.display = (parseInt(el.dataset.step, 10) === n) ? '' : 'none';
    });
    const ind = _qs('onboardingStepIndicator');
    if (ind) ind.textContent = `Step ${n} of ${TOTAL_STEPS}`;
    const prev = _qs('onboardingPrevBtn');
    const next = _qs('onboardingNextBtn');
    if (prev) prev.style.display = n > 1 ? '' : 'none';
    if (next) next.textContent = n < TOTAL_STEPS ? 'Next →' : 'Get started';
    currentStep = n;
  }

  async function markDone() {
    try { await chrome.storage.local.set({ sentinelOnboardingDone: true }); } catch (e) { /* storage may fail */ }
    const modal = _qs('onboarding-modal');
    if (modal) modal.classList.remove('show');
  }

  function nextStep() {
    if (currentStep < TOTAL_STEPS) {
      showStep(currentStep + 1);
    } else {
      markDone();
    }
  }

  function prevStep() {
    if (currentStep > 1) showStep(currentStep - 1);
  }

  // Wire buttons (defensive -- modal may not exist on some popup states)
  const next = _qs('onboardingNextBtn');
  const prev = _qs('onboardingPrevBtn');
  const skip = _qs('onboardingSkipBtn');
  if (next) next.addEventListener('click', nextStep);
  if (prev) prev.addEventListener('click', prevStep);
  if (skip) skip.addEventListener('click', markDone);

  // Auto-show on first run
  (async function maybeShow() {
    try {
      const stored = await chrome.storage.local.get({ sentinelOnboardingDone: false });
      if (stored.sentinelOnboardingDone === true) return;
      const modal = _qs('onboarding-modal');
      if (!modal) return;
      // Small delay so the popup paints first
      setTimeout(() => {
        showStep(1);
        modal.classList.add('show');
      }, 250);
    } catch (e) { /* non-fatal */ }
  })();
})();
