// Updates never clear workout storage or reload a tab without an explicit action.
(() => {
  if (!('serviceWorker' in navigator)) return;
  let registration;
  let requestedReload = false;
  let reloading = false;

  function offerUpdate() {
    if (!navigator.serviceWorker.controller || !registration?.waiting || document.getElementById('appUpdateNotice')) return;
    const notice = document.createElement('aside');
    notice.id = 'appUpdateNotice';
    notice.className = 'app-update-notice';
    notice.setAttribute('aria-label', 'App update available');
    notice.innerHTML = '<span>Update ready. Your workout will be saved.</span><button type="button" id="applyAppUpdate">Save & update</button><button type="button" id="dismissAppUpdate">Later</button>';
    document.body.appendChild(notice);
    notice.querySelector('#applyAppUpdate').addEventListener('click', () => apply());
    notice.querySelector('#dismissAppUpdate').addEventListener('click', () => notice.remove());
  }

  async function check() {
    if (!registration) registration = await navigator.serviceWorker.register('./sw.js?v=33');
    await registration.update();
    if (registration.installing) {
      const worker = registration.installing;
      await new Promise(resolve => {
        const done = () => {
          if (worker.state === 'installed' || worker.state === 'redundant') {
            worker.removeEventListener('statechange', done);
            resolve();
          }
        };
        worker.addEventListener('statechange', done);
        done();
      });
    }
    offerUpdate();
    return Boolean(registration.waiting);
  }

  async function apply() {
    if (!registration?.waiting) return false;
    try {
      window.app?.saveCurrentSession();
    } catch (error) {
      window.app?.showToast('Could not save your workout. Update postponed.');
      return false;
    }
    requestedReload = true;
    registration.waiting.postMessage({ type: 'APPLY_UPDATE' });
    return true;
  }

  window.workoutUpdates = { check, apply };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (requestedReload && !reloading) {
      reloading = true;
      window.location.reload();
    }
  });
  window.addEventListener('load', async () => {
    try {
      registration = await navigator.serviceWorker.register('./sw.js?v=33');
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') offerUpdate();
        });
      });
      await check();
    } catch (error) {
      console.info('Update check unavailable; saved workouts are unaffected.');
    }
  });
})();
