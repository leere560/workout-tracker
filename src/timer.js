// Rest countdown timer, audio/haptic alerts, wake lock, and elapsed session clock.
(globalThis.WorkoutAppMixins ||= []).push({
  primeAudioContext() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioContextClass();
      }
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      // Play a 1-sample silent sound to unlock audio playback in mobile Safari.
      const buffer = this.audioCtx.createBuffer(1, 1, 22050);
      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioCtx.destination);
      source.start(0);
    } catch (e) {
      console.warn('Audio priming:', e);
    }
  },

  async requestWakeLock() {
    if (!this.wakeLockEnabled || this.activeView !== 'workout') return;
    try {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        if (!this.wakeLock) {
          this.wakeLock = await navigator.wakeLock.request('screen');
          this.wakeLock.addEventListener('release', () => {
            this.wakeLock = null;
          });
        }
      }
    } catch (e) {
      console.warn('Wake Lock request error:', e);
      this.wakeLock = null;
    }
  },

  releaseWakeLock() {
    if (this.wakeLock) {
      try {
        this.wakeLock.release();
      } catch (_) {}
      this.wakeLock = null;
    }
  },

  triggerHaptic(pattern = [200, 100, 200, 100, 400]) {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (_) {}
    }
  },

  requestNotificationPermission() {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      try {
        Notification.requestPermission();
      } catch (_) {}
    }
  },

  triggerTimerNotification() {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted' && typeof document !== 'undefined' && document.hidden) {
      try {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.ready.then(reg => {
            reg.showNotification('Rest Completed', {
              body: 'Time for your next set.',
              icon: './icon-192.png',
              badge: './icon-192.png',
              vibrate: [250, 100, 250, 100, 400],
              tag: 'rest-timer'
            });
          });
        } else {
          new Notification('Rest Completed', {
            body: 'Time for your next set.',
            icon: './icon-192.png'
          });
        }
      } catch (_) {}
    }
  },

  startTimer(seconds, minimumDuration = 120) {
    const source = this._pendingTimerSource || null;
    this._pendingTimerSource = null;
    this.stopTimer(false);
    this.primeAudioContext();
    this.requestWakeLock();
    this.requestNotificationPermission();

    seconds = Math.max(minimumDuration, this.parseRestSeconds(seconds));
    const startedAt = Date.now();
    const targetEndTime = startedAt + (seconds * 1000);
    this.timer.startedAt = startedAt;
    this.timer.minimumDuration = minimumDuration;
    this.timer.totalDuration = seconds;
    this.timer.targetEndTime = targetEndTime;
    this.timer.remaining = seconds;
    this.timer.active = true;
    this.timer.source = source;

    localStorage.setItem(this.storageKeys.timerTargetEnd, String(targetEndTime));
    localStorage.setItem(this.storageKeys.timerTotalDuration, String(seconds));
    localStorage.setItem('gym_timer_started_at_v1', String(startedAt));
    localStorage.setItem('gym_timer_minimum_v1', String(minimumDuration));

    this.updateTimerUI();
    this.timerDockEl?.classList.add('active');
    document.body?.classList.add('timer-active');

    this.timer.intervalId = setInterval(() => {
      this.tickTimer();
    }, 1000);
  },

  tickTimer() {
    if (!this.timer?.active) return;
    const remaining = Math.max(0, Math.ceil((this.timer.targetEndTime - Date.now()) / 1000));
    this.timer.remaining = remaining;
    this.updateTimerUI();

    if (remaining <= 0) {
      this.onTimerFinished();
    }
  },

  onTimerFinished() {
    // Another tab or a newer set may already have started a different timer.
    const savedEnd = Number(localStorage.getItem(this.storageKeys.timerTargetEnd));
    if (savedEnd && savedEnd !== this.timer.targetEndTime) {
      this.syncTimerFromBackground();
      return;
    }
    this.stopTimer(true);
    this.playTimerAlarm();
    this.showRestCompleteBanner();
  },

  syncTimerFromBackground() {
    const savedEnd = localStorage.getItem(this.storageKeys.timerTargetEnd);
    const savedTotal = localStorage.getItem(this.storageKeys.timerTotalDuration);
    if (!savedEnd) return;

    const targetEndTime = parseInt(savedEnd, 10);
    const totalDuration = parseInt(savedTotal, 10) || 120;
    const now = Date.now();
    const remaining = Math.ceil((targetEndTime - now) / 1000);
    if (!Number.isFinite(targetEndTime)) return;
    this.timer.targetEndTime = targetEndTime;
    this.timer.startedAt = Number(localStorage.getItem('gym_timer_started_at_v1')) || targetEndTime - totalDuration * 1000;
    const savedMinimum = localStorage.getItem('gym_timer_minimum_v1');
    this.timer.minimumDuration = savedMinimum === null ? Math.min(120, totalDuration) : Number(savedMinimum);

    if (remaining > 0) {
      this.timer.totalDuration = totalDuration;
      this.timer.targetEndTime = targetEndTime;
      this.timer.remaining = remaining;
      this.timer.active = true;
      this.updateTimerUI();
      this.timerDockEl?.classList.add('active');
      document.body?.classList.add('timer-active');
      this.requestWakeLock();
      if (!this.timer.intervalId) {
        this.timer.intervalId = setInterval(() => this.tickTimer(), 1000);
      }
    } else if (remaining <= 0) {
      this.onTimerFinished();
    }
  },

  restoreActiveTimer() {
    const savedEnd = localStorage.getItem(this.storageKeys.timerTargetEnd);
    if (savedEnd) {
      const targetEndTime = parseInt(savedEnd, 10);
      if (targetEndTime > Date.now()) {
        this.syncTimerFromBackground();
      } else {
        this.timer.targetEndTime = targetEndTime;
        this.stopTimer(true);
      }
    }
  },

  stopTimer(clearStorage = true) {
    if (!this.timer) return;
    if (this.timer.intervalId) {
      clearInterval(this.timer.intervalId);
      this.timer.intervalId = null;
    }
    this.timer.active = false;
    this.timer.source = null;
    if (this.activeView !== 'workout' || !this.wakeLockEnabled) {
      this.releaseWakeLock();
    }
    if (clearStorage && Number(localStorage.getItem(this.storageKeys.timerTargetEnd)) === this.timer.targetEndTime) {
      localStorage.removeItem(this.storageKeys.timerTargetEnd);
      localStorage.removeItem(this.storageKeys.timerTotalDuration);
      localStorage.removeItem('gym_timer_started_at_v1');
      localStorage.removeItem('gym_timer_minimum_v1');
    }
    this.timerDockEl?.classList.remove('active');
    document.body?.classList.remove('timer-active');
  },

  adjustTimer(delta) {
    if (!this.timer?.active) return;
    this.timer.targetEndTime = Math.max(
      this.timer.targetEndTime + delta * 1000,
      this.timer.startedAt + this.timer.minimumDuration * 1000,
      Date.now() + 1000
    );
    const newRemaining = Math.max(1, Math.ceil((this.timer.targetEndTime - Date.now()) / 1000));
    this.timer.remaining = newRemaining;
    this.timer.totalDuration = Math.ceil((this.timer.targetEndTime - this.timer.startedAt) / 1000);
    localStorage.setItem(this.storageKeys.timerTargetEnd, String(this.timer.targetEndTime));
    localStorage.setItem(this.storageKeys.timerTotalDuration, String(this.timer.totalDuration));
    this.updateTimerUI();
  },

  skipTimer() {
    if (this.timer?.active && Date.now() < this.timer.startedAt + this.timer.minimumDuration * 1000) {
      this.showToast(`Your ${this.formatRest(this.timer.minimumDuration)} minimum rest is still running.`);
      return false;
    }
    this.stopTimer();
    return true;
  },

  getMinimumRestLabel() {
    const minimum = Number(this.timer.minimumDuration) || 0;
    const remaining = Math.max(0, Math.ceil(((Number(this.timer.startedAt) || 0) + minimum * 1000 - Date.now()) / 1000));
    if (minimum > 0 && remaining > 0) {
      return `Minimum rest: ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} left`;
    }
    return minimum > 0 ? 'Minimum rest complete' : 'Superset rest';
  },

  updateTimerUI() {
    const mins = Math.floor(this.timer.remaining / 60);
    const secs = this.timer.remaining % 60;
    if (this.timerDisplayEl) this.timerDisplayEl.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    const pct = ((this.timer.totalDuration - this.timer.remaining) / this.timer.totalDuration) * 100;
    if (this.timerProgressBarEl?.style) {
      this.timerProgressBarEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    }
    const status = document.getElementById('timerMinimumStatus');
    if (status) status.textContent = this.getMinimumRestLabel();
    const minEnd = (Number(this.timer.startedAt) || 0) + (Number(this.timer.minimumDuration) || 0) * 1000;
    const skip = document.getElementById('timerSkipBtn');
    if (skip) {
      skip.disabled = this.timer.active && Date.now() < minEnd;
      skip.title = skip.disabled ? `Available after ${this.formatRest(this.timer.minimumDuration)} of rest` : 'Finish rest';
    }
    const minus = document.getElementById('timerMinus30Btn');
    if (minus && minus !== skip) {
      minus.disabled = this.timer.active && this.timer.targetEndTime <= minEnd;
    }
  },

  playTimerAlarm() {
    this.triggerHaptic([250, 100, 250, 100, 400]);

    // Audible Web Audio Chime (Ascending 3-tone chime: D5 -> G5 -> B5)
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        if (!this.audioCtx) this.audioCtx = new AudioContextClass();
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        const ctx = this.audioCtx;

        const playTone = (freq, start, duration) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
          gain.gain.setValueAtTime(0.45, ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + start + duration);
        };

        playTone(587.33, 0, 0.2);     // D5
        playTone(783.99, 0.22, 0.2);  // G5
        playTone(987.77, 0.44, 0.45); // B5
      }
    } catch (e) {
      console.warn('Audio alarm chime error:', e);
    }

    this.triggerTimerNotification();
  },

  showRestCompleteBanner() {
    this.announceStatus?.('Rest finished. Time for your next set.', 'assertive');
    if (typeof document === 'undefined' || typeof document.createElement !== 'function' || !document.body) return;
    const existing = document.querySelector('.timer-complete-toast');
    if (existing) existing.remove();

    const flash = document.createElement('div');
    flash.className = 'timer-complete-flash';
    flash.setAttribute('aria-hidden', 'true');
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 1200);

    const banner = document.createElement('div');
    banner.className = 'timer-complete-toast';
    banner.setAttribute('role', 'status');
    const supportsPopover = typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover');
    if (supportsPopover) banner.setAttribute('popover', 'manual');
    const text = document.createElement('span');
    text.textContent = 'Rest finished — time to lift!';
    banner.appendChild(text);
    document.body.appendChild(banner);
    if (supportsPopover) {
      try { banner.showPopover?.(); } catch (_) {}
    }
    setTimeout(() => banner.classList.add('show'), 20);
    setTimeout(() => {
      banner.classList.remove('show');
      setTimeout(() => {
        try { banner.hidePopover?.(); } catch (_) {}
        banner.remove();
      }, 400);
    }, 4500);
  },

  formatElapsedDuration(startTime, now = Date.now()) {
    const startMs = Date.parse(startTime);
    if (!Number.isFinite(startMs)) return '';
    const totalMins = Math.max(0, Math.floor((now - startMs) / 60000));
    if (totalMins < 1) return '<1m elapsed';
    if (totalMins < 60) return `${totalMins}m elapsed`;
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return `${hours}h ${String(mins).padStart(2, '0')}m elapsed`;
  },

  updateElapsedDisplay() {
    if (typeof document === 'undefined' || !document.getElementById) return;
    const el = document.getElementById('sessionElapsed');
    if (!el) return;
    const label = this.session?.startTime ? this.formatElapsedDuration(this.session.startTime) : '';
    el.textContent = label;
    el.hidden = !label;
  },

  startElapsedClock() {
    this.stopElapsedClock();
    this.updateElapsedDisplay();
    if (this.activeView !== 'workout' || !this.session?.startTime) return;
    this.elapsedIntervalId = setInterval(() => this.updateElapsedDisplay(), 30000);
  },

  stopElapsedClock() {
    if (this.elapsedIntervalId) {
      clearInterval(this.elapsedIntervalId);
      this.elapsedIntervalId = null;
    }
  }
});
