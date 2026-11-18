// Keep native modal light-dismiss, dynamic content focus, and keyboard insets predictable.
document.addEventListener('DOMContentLoaded', () => {
  const dialogs = [...document.querySelectorAll('dialog.app-dialog')];
  const focusable = root => [...root.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.getClientRects().length);

  dialogs.forEach(dialog => {
    dialog.addEventListener('close', () => {
      dialog.returnValue = '';
      window.app?.refreshWorkoutSelectionForDate?.();
    });
  });

  // Fallback for browsers without native closedby="any" support (e.g., older Safari).
  if (typeof HTMLDialogElement !== 'undefined' && !('closedBy' in HTMLDialogElement.prototype)) {
    const isOutsideDialog = (dialog, event) => {
      const rect = dialog.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };
    dialogs.forEach(dialog => {
      if (dialog.getAttribute('closedby') !== 'any') return;
      let startedOutside = false;
      dialog.addEventListener('pointerdown', event => {
        startedOutside = dialog.open && event.target === dialog && isOutsideDialog(dialog, event);
      });
      dialog.addEventListener('pointerup', event => {
        const shouldClose = startedOutside && dialog.open && event.target === dialog && isOutsideDialog(dialog, event);
        startedOutside = false;
        if (shouldClose) dialog.close('dismiss');
      });
    });
  }

  // Handle autofocus or lost focus when replacing content inside an already-open dialog.
  const containers = ['summaryContent', 'swapContent', 'quickHistoryContent']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  const contentObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      const container = mutation.target;
      const dialog = container.closest('dialog.app-dialog');
      if (!dialog?.open) continue;
      const explicitTarget = container.querySelector('[autofocus]');
      if (explicitTarget && document.activeElement !== explicitTarget) {
        explicitTarget.focus({ preventScroll: true });
        break;
      }
      if (!dialog.contains(document.activeElement)) {
        const target = focusable(dialog)[0] || dialog;
        if (target === dialog && !dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
        target.focus({ preventScroll: true });
        break;
      }
    }
  });
  containers.forEach(container => contentObserver.observe(container, { childList: true }));

  // Announce completion through centralized live regions, not each timer tick.
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
