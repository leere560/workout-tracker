// Keep modal and keyboard interaction predictable on phones and keyboards.
document.addEventListener('DOMContentLoaded', () => {
  const modals = [...document.querySelectorAll('.modal-backdrop')];
  let activeModal = null;
  let returnFocus = null;
  const background = [...document.querySelectorAll('.app-header, main, #liftingDock, #nowLiftingDock, #timerDock')];
  const focusable = modal => [...modal.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')]
    .filter(el => !el.disabled && el.getClientRects().length);
  const syncModal = () => {
    const opened = modals.find(modal => modal.classList.contains('open')) || null;
    modals.forEach(modal => {
      modal.inert = modal !== opened;
      modal.setAttribute('aria-hidden', String(modal !== opened));
    });
    if (opened === activeModal) return;
    if (opened) {
      if (!activeModal) returnFocus = document.activeElement;
      activeModal = opened;
      background.forEach(el => { el.inert = true; });
      const target = focusable(opened)[0] || opened;
      if (target === opened) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    } else {
      activeModal = null;
      background.forEach(el => { el.inert = false; });
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      else document.querySelector('.nav-btn.active')?.focus({ preventScroll: true });
      returnFocus = null;
    }
  };
  const observer = new MutationObserver(syncModal);
  modals.forEach(modal => observer.observe(modal, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true }));
  document.addEventListener('keydown', event => {
    if (!activeModal || event.key !== 'Tab') return;
    const items = focusable(activeModal);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || !activeModal.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !activeModal.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  syncModal();
  // Announce completion through the existing completion banner, not each tick.
  const timer = document.getElementById('timerDisplay');
  timer?.setAttribute('aria-live', 'off');
  timer?.setAttribute('role', 'timer');
  const updateKeyboardInset = () => {
    const viewport = window.visualViewport;
    const inset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
    document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
  };
  window.visualViewport?.addEventListener('resize', updateKeyboardInset);
  window.visualViewport?.addEventListener('scroll', updateKeyboardInset);
  updateKeyboardInset();
});
