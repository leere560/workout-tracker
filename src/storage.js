// LocalStorage persistence, transactional writes, backups, CSV export, and recovery drafts.
(globalThis.WorkoutAppMixins ||= []).push({
  writeStorageTransaction(writes) {
    const before = new Map([...writes.keys()].map(key => [key, localStorage.getItem(key)]));
    try {
      writes.forEach((value, key) => value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value));
    } catch (error) {
      before.forEach((value, key) => { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch (_) {} });
      throw error;
    }
  },

  getStorageSnapshot(storage = localStorage) {
    return new Map(Array.from({ length: storage.length }, (_, i) => {
      const key = storage.key(i); return [key, storage.getItem(key)];
    }));
  },

  storageOverlay(writes = new Map(), storage = localStorage) {
    const values = this.getStorageSnapshot(storage);
    writes.forEach((value, key) => value === null ? values.delete(key) : values.set(key, value));
    return { getItem: key => values.get(key) ?? null, key: index => [...values.keys()][index], get length() { return values.size; } };
  },

  loadRoutine() {
    const saved = localStorage.getItem(this.storageKeys.routine);
    const rev = localStorage.getItem(this.storageKeys.routineRev);
    let routine;
    try {
      const parsed = saved ? JSON.parse(saved) : null;
      if (Array.isArray(parsed) && parsed.length && parsed.every(d => Array.isArray(d.exercises))) routine = parsed;
    } catch (e) { console.error(e); }
    routine ||= JSON.parse(JSON.stringify(DEFAULT_ROUTINE));
    routine = this.normalizeRoutineData(routine);
    const fastStartup = saved !== null && rev === this.CURRENT_ROUTINE_REV;
    const repair = this.prepareRoutineUpgrade(routine, localStorage, { fastStartup });
    const serialized = JSON.stringify(repair.routine);
    if (fastStartup && repair.writes.size === 0 && serialized === saved) {
      this.equipmentRepairFailed = false;
      return repair.routine;
    }
    repair.writes.set(this.storageKeys.routineRev, this.CURRENT_ROUTINE_REV);
    repair.writes.set(this.storageKeys.routine, serialized);
    try {
      this.writeStorageTransaction(repair.writes);
      this.equipmentRepairFailed = false;
      return repair.routine;
    } catch (error) {
      this.equipmentRepairFailed = true;
      console.error('Equipment defaults could not be saved:', error);
      return routine;
    }
  },

  saveRoutine() {
    localStorage.setItem(this.storageKeys.routine, JSON.stringify(this.routine));
  },

  loadHistory() {
    const saved = localStorage.getItem(this.storageKeys.history);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { console.error(e); }
    }
    return [];
  },

  saveHistory() {
    localStorage.setItem(this.storageKeys.history, JSON.stringify(this.history));
  },

  loadLastWeights(storage = localStorage) {
    const saved = storage.getItem(this.storageKeys.lastWeights);
    let data = {};
    if (saved) {
      try { data = JSON.parse(saved); } catch (e) { console.error(e); }
    }
    // Bootstrap from history if empty
    if (Object.keys(data).length === 0 && this.history && this.history.length > 0) {
      this.history.forEach(h => {
        if (h.deload || h.isDeload || h.deloadActive) return;
        if (h.exercises) {
          Object.keys(h.exercises).forEach(name => {
            const entry = h.exercises[name];
            if (entry && entry.sets) {
              data[name] = {
                date: h.date,
                sets: entry.sets.map(s => ({ setNum: s.setNum, weight: s.weight, reps: s.reps, completed: s.completed }))
              };
            }
          });
        }
      });
    }
    // Older builds saved recovery loads without identifying them as a deload.
    Object.entries(data).forEach(([name, entry]) => {
      if (!entry || typeof entry !== 'object') return;
      const matching = (this.history || []).filter(h => h.exercises?.[name]).sort((a, b) => new Date(b.date) - new Date(a.date));
      const latest = matching[0];
      if (latest && (latest.deload || latest.isDeload || latest.deloadActive) && new Date(entry.date).getTime() <= new Date(latest.date).getTime()) {
        const baseline = matching.find(h => !h.deload && !h.isDeload && !h.deloadActive);
        if (baseline) data[name] = { date: baseline.date, deload: false, sets: baseline.exercises[name].sets };
        else entry.deload = true;
      }
    });
    return data;
  },

  saveLastWeights() {
    localStorage.setItem(this.storageKeys.lastWeights, JSON.stringify(this.lastWeights));
  },

  rebuildLastWeightsFromHistory() {
    this.lastWeights = this.buildLastWeightsFromHistory();
    this.saveLastWeights();
  },

  buildLastWeightsFromHistory(history = this.history) {
    const weights = {};
    [...(history || [])].sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(workout => {
      if (workout.deload || workout.isDeload || workout.deloadActive) return;
      Object.entries(workout.exercises || {}).forEach(([name, entry]) => {
        const sets = (entry.sets || []).filter(set => set && set.completed !== false);
        if (sets.length) weights[name] = { date: workout.date, deload: false, sets: sets.map(set => ({ ...set })) };
      });
    });
    return weights;
  },

  loadMachineSettings() {
    const saved = localStorage.getItem(this.storageKeys.machineSettings);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { console.error(e); }
    }
    return {};
  },

  saveMachineSettings() {
    localStorage.setItem(this.storageKeys.machineSettings, JSON.stringify(this.machineSettings));
  },

  isEquipmentSettingsMap(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
      Object.entries(value).every(([name, setting]) => name.trim() && typeof setting === 'string'));
  },

  loadEquipmentSettings() {
    try {
      const value = JSON.parse(localStorage.getItem(this.storageKeys.equipmentSettings) || '{}');
      return this.isEquipmentSettingsMap(value) ? value : {};
    } catch (_) { return {}; }
  },

  hasEquipmentSetting(name) {
    return typeof name === 'string' && Object.prototype.hasOwnProperty.call(this.equipmentSettings || {}, name) &&
      typeof this.equipmentSettings[name] === 'string';
  },

  getEquipmentSetting(name) {
    if (this.hasEquipmentSetting(name)) return this.equipmentSettings[name];
    const names = typeof this.getEquivalentExerciseNames === 'function' ? this.getEquivalentExerciseNames(name) : [];
    const match = names.find(alt => this.hasEquipmentSetting(alt));
    return match ? this.equipmentSettings[match] : '';
  },

  getLegacyMachineSetting(exId) {
    const legacy = this.machineSettings || {};
    if (Object.prototype.hasOwnProperty.call(legacy, exId) && typeof legacy[exId] === 'string') return legacy[exId];
    const ex = this.findExerciseById(exId);
    if (ex?.sourceExerciseId && Object.prototype.hasOwnProperty.call(legacy, ex.sourceExerciseId) && typeof legacy[ex.sourceExerciseId] === 'string') {
      return legacy[ex.sourceExerciseId];
    }
    return '';
  },

  updateEquipmentSetting(name, value) {
    if (typeof name !== 'string' || !name.trim() || typeof value !== 'string') return false;
    if (this.hasEquipmentSetting(name) && this.equipmentSettings[name] === value) return true;
    const next = { ...(this.equipmentSettings || {}), [name]: value };
    try {
      this.writeStorageTransaction(new Map([[this.storageKeys.equipmentSettings, JSON.stringify(next)]]));
    } catch (_) {
      this.showToast('Could not save this equipment setup. Your previous setting is unchanged; free some device storage and try again.');
      return false;
    }
    this.equipmentSettings = next;
    return true;
  },

  loadExerciseNotes() {
    const saved = localStorage.getItem(this.storageKeys.exerciseNotes);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { console.error(e); }
    }
    return {};
  },

  saveExerciseNotes() {
    localStorage.setItem(this.storageKeys.exerciseNotes, JSON.stringify(this.exerciseNotes || {}));
  },

  loadExercisePreferences() {
    try {
      const data = JSON.parse(localStorage.getItem(this.storageKeys.exercisePreferences) || '{}');
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (_) { return {}; }
  },

  saveExercisePreferences() {
    localStorage.setItem(this.storageKeys.exercisePreferences, JSON.stringify(this.exercisePreferences || {}));
  },

  initStoragePersistence() {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().then(persistent => {
        if (persistent) {
          console.log('MachineMaster storage marked persistent by browser');
        }
      }).catch(e => console.log('Storage persist check:', e));
    }
  },

  getSessionKey(dayId) {
    return `${this.storageKeys.currentSessionPrefix}${dayId}`;
  },

  getStoredSessions() {
    const sessions = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith(this.storageKeys.currentSessionPrefix)) continue;
      try { const item = JSON.parse(localStorage.getItem(key)); if (item?.dayId && item.logs) sessions.push(item); } catch (_) {}
    }
    if (this.session?.dayId) {
      const index = sessions.findIndex(s => s.dayId === this.session.dayId);
      if (index >= 0) sessions[index] = this.session; else sessions.push(this.session);
    }
    return sessions;
  },

  loadSession(dayIndex = this.activeDayIndex) {
    const day = this.routine[dayIndex] || this.routine[0];
    const saved = localStorage.getItem(this.getSessionKey(day.id)) || localStorage.getItem(this.storageKeys.legacyCurrentSession);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.dayId === day.id && parsed.logs && typeof parsed.logs === 'object') {
          if (parsed.id && this.history.some(workout => (workout.sessionId || workout.sessionSnapshot?.id) === parsed.id)) return this.initNewSession(dayIndex);
          parsed.dayTitle ||= day.title;
          parsed.swaps ||= {};
          // Only a provably untouched session may be recalculated when deload changes.
          const untouched = parsed.initialLogs && !this.hasSessionProgress(parsed);
          if (untouched && Boolean(parsed.deload) !== Boolean(this.deloadActive)) return this.initNewSession(dayIndex);
          if (typeof parsed.deload !== 'boolean') parsed.deload = Boolean(this.deloadActive);
          parsed.id ||= `s_${day.id}_${parsed.startTime || Date.now()}`;
          this.reconcileMondaySession(parsed, day, { preserve: !untouched });
          return this.normalizeSessionFlow(parsed, day);
        }
      } catch (e) { console.error(e); }
    }
    return this.initNewSession(dayIndex);
  },

  saveCurrentSession() {
    if (!this.session || !this.session.dayId) return;
    this.session.id ||= `s_${this.session.dayId}_${Date.now()}`;
    this.session.updatedAt = new Date().toISOString();
    localStorage.setItem(this.getSessionKey(this.session.dayId), JSON.stringify(this.session));
    localStorage.setItem('gym_last_active_day_v1', this.session.dayId);
  },

  getSavedDrafts(dayId, storage = localStorage) {
    const entries = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key.startsWith('gym_saved_draft_') || key.startsWith('gym_saved_draft_for_')) continue;
      try {
        const session = JSON.parse(storage.getItem(key));
        if (session?.dayId && session.logs && (!dayId || session.dayId === dayId))
          entries.push({ recoveryId: key.slice('gym_saved_draft_'.length), session });
      } catch (_) {}
    }
    return entries.sort((a, b) => (Date.parse(b.session.lastInteractionAt || b.session.startTime || b.session.createdAt) || 0) -
      (Date.parse(a.session.lastInteractionAt || a.session.startTime || a.session.createdAt) || 0));
  },

  stableDraftContent(value) {
    return Array.isArray(value) ? value.map(item => this.stableDraftContent(item)) : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, this.stableDraftContent(value[key])])) : value;
  },

  importedSessionId(session) {
    if (session.id) return session.id;
    const { updatedAt, recoveryId, id, ...content } = session;
    const seed = session.startTime || session.createdAt;
    const text = JSON.stringify(this.stableDraftContent(seed ? { dayId: session.dayId, date: seed } : content));
    // Two independent hashes keep anonymous legacy versions stable without conflating separate workouts.
    let first = 2166136261, second = 5381;
    for (let i = 0; i < text.length; i++) {
      first = Math.imul(first ^ text.charCodeAt(i), 16777619);
      second = Math.imul(second, 33) ^ text.charCodeAt(i);
    }
    return `s_import_${session.dayId}_${(first >>> 0).toString(36)}_${(second >>> 0).toString(36)}`;
  },

  draftFingerprint(session) {
    const { updatedAt, recoveryId, ...content } = session;
    content.id = this.importedSessionId(session);
    return JSON.stringify(this.stableDraftContent(content));
  },

  normalizeImportedDraft(input, routine, sourceRoutine, state, preserveDraft = false) {
    const session = JSON.parse(JSON.stringify(input));
    session.id = this.importedSessionId(session);
    const day = routine.find(day => day.id === session.dayId);
    if (!day) return session;
    const sourceDay = sourceRoutine?.find(day => day.id === session.dayId);
    const untouched = !preserveDraft && session.initialLogs && !this.hasSessionProgress(session);
    this.reconcileMondaySession(session, day, { preserve: !untouched });
    const targets = Object.assign(Object.create(this), state, { routine, session, deloadActive: Boolean(session.deload) });
    day.exercises.forEach(ex => {
      const source = sourceDay?.exercises.find(item => item.id === ex.id) || ex;
      if (untouched && source.name !== ex.name && Array.isArray(session.logs[ex.id])) {
        session.logs[ex.id] = session.logs[ex.id].map((set, index) => {
          const target = targets.getSetTarget(ex, index, ex.name);
          return {
            ...set, weight: target.targetWeight, reps: target.targetReps, needsBaseline: Boolean(target.needsBaseline),
            exerciseName: ex.name, muscle: ex.muscle, targetReps: ex.targetReps
          };
        });
        session.initialLogs[ex.id] = JSON.parse(JSON.stringify(session.logs[ex.id]));
      } else {
        targets.reconcileSessionEquipmentIdentity(session, ex, source);
        if (untouched && session.initialLogs?.[ex.id]) session.initialLogs[ex.id] = JSON.parse(JSON.stringify(session.logs[ex.id]));
      }
    });
    return session;
  },

  retainSavedDraft(session, writes) {
    const same = this.getSavedDrafts(undefined, this.storageOverlay(writes))
      .find(item => this.draftFingerprint(item.session) === this.draftFingerprint(session));
    if (same) return { recoveryId: same.recoveryId, added: false };
    let base = session.recoveryId || this.importedSessionId(session);
    if (base.startsWith('for_')) base = `recovery_${base}`;
    let recoveryId = base, suffix = 2;
    while (this.storageOverlay(writes).getItem(`gym_saved_draft_${recoveryId}`) !== null) recoveryId = `${base}_copy${suffix++}`;
    const copy = JSON.parse(JSON.stringify(session)); delete copy.recoveryId;
    copy.id = this.importedSessionId(copy);
    writes.set(`gym_saved_draft_${recoveryId}`, JSON.stringify(copy));
    writes.set(`gym_saved_draft_for_${copy.dayId}`, recoveryId);
    return { recoveryId, added: true };
  },

  backupImportStateSignature() {
    return JSON.stringify([this.session, this.routine, this.history, this.lastWeights, this.machineSettings,
      this.equipmentSettings, this.exerciseNotes, this.exercisePreferences, this.activeDayIndex]);
  },

  getDismissedOneTimeIds(storage = localStorage) {
    const ids = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith('gym_onetime_done_') && storage.getItem(key) === '1') {
        ids.push(key.slice('gym_onetime_done_'.length));
      }
    }
    return ids.sort();
  },

  getBackupStatusText() {
    const ts = Number(localStorage.getItem(this.storageKeys.lastBackupTime));
    if (!ts || !Number.isFinite(ts)) return 'No export requested yet';
    return `Last export requested ${new Date(ts).toLocaleDateString()}`;
  },

  getBackupReminderInfo(now = Date.now()) {
    const totalWorkouts = (this.history || []).length;
    if (totalWorkouts < 3) return { shouldRemind: false, daysSinceBackup: 0, workoutsSinceBackup: 0 };
    const ts = Number(localStorage.getItem(this.storageKeys.lastBackupTime));
    if (!ts || !Number.isFinite(ts)) {
      return { shouldRemind: true, daysSinceBackup: null, workoutsSinceBackup: totalWorkouts };
    }
    const daysSinceBackup = Math.floor((now - ts) / 86400000);
    const workoutsSinceBackup = (this.history || []).filter(h => Date.parse(h?.date) > ts).length;
    return {
      shouldRemind: daysSinceBackup >= 14 || workoutsSinceBackup >= 10,
      daysSinceBackup,
      workoutsSinceBackup
    };
  },

  createBackupData() {
    const savedDrafts = this.getSavedDrafts().map(({ recoveryId, session }) => ({ ...session, recoveryId }));
    return {
      version: '3.5',
      routine: this.routine,
      history: this.history,
      machineSettings: this.machineSettings,
      equipmentSettings: this.equipmentSettings || {},
      exerciseNotes: this.exerciseNotes,
      lastWeights: this.lastWeights,
      exercisePreferences: this.exercisePreferences || {},
      wakeLockEnabled: this.wakeLockEnabled,
      routineRev: localStorage.getItem(this.storageKeys.routineRev) || this.CURRENT_ROUTINE_REV,
      sessions: this.getStoredSessions(),
      deloadActive: this.deloadActive,
      deloadStartDate: this.deloadStartDate,
      savedDrafts,
      dismissedOneTimeIds: this.getDismissedOneTimeIds(),
      lastActiveDay: localStorage.getItem('gym_last_active_day_v1'),
      timer: {
        targetEnd: localStorage.getItem(this.storageKeys.timerTargetEnd),
        totalDuration: localStorage.getItem(this.storageKeys.timerTotalDuration),
        minimumRest: localStorage.getItem('gym_timer_minimum_v1'),
        startedAt: localStorage.getItem('gym_timer_started_at_v1')
      },
      exportedAt: new Date().toISOString()
    };
  },

  triggerFileDownload(blob, filename) {
    let url;
    try {
      url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      return true;
    } finally {
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  },

  exportData() {
    try {
      // The export includes in-memory edits even when device storage is full.
      const jsonText = JSON.stringify(this.createBackupData(), null, 2);
      const filename = `MachineMaster_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      const blob = new Blob([jsonText], { type: 'application/json' });
      const canShareFiles = typeof navigator !== 'undefined' && typeof File !== 'undefined' &&
        typeof navigator.canShare === 'function' && typeof navigator.share === 'function';
      if (canShareFiles) {
        try {
          const file = new File([jsonText], filename, { type: 'application/json' });
          if (navigator.canShare({ files: [file] })) {
            navigator.share({ files: [file], title: 'Machine Master Backup' }).catch(err => {
              if (err?.name !== 'AbortError') this.triggerFileDownload(blob, filename);
            });
            try { localStorage.setItem(this.storageKeys.lastBackupTime, String(Date.now())); } catch (_) {}
            this.showToast('Backup share sheet opened. Keep the backup file somewhere safe.');
            if (this.activeView === 'routine') this.renderRoutineEditor();
            return true;
          }
        } catch (_) {}
      }
      this.triggerFileDownload(blob, filename);
      try { localStorage.setItem(this.storageKeys.lastBackupTime, String(Date.now())); } catch (_) {}
      this.showToast('Download requested. Check your downloads and keep the backup file somewhere safe.');
      if (this.activeView === 'routine') this.renderRoutineEditor();
      return true;
    } catch (_) {
      this.showToast('Could not request the download. Your workouts are unchanged; try again.');
      return false;
    }
  },

  exportHistoryCsv() {
    try {
      const escapeCsv = value => {
        const str = value === null || value === undefined ? '' : String(value);
        return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
      };
      const rows = [['Date', 'Day', 'Deload', 'Exercise', 'Set', 'Weight (lb)', 'Reps', 'RIR']];
      const sorted = [...(this.history || [])].sort((a, b) => new Date(a.date) - new Date(b.date));
      sorted.forEach(workout => {
        const dateStr = workout.date ? new Date(workout.date).toISOString().slice(0, 10) : '';
        const deloadStr = workout.deload ? 'Yes' : 'No';
        Object.entries(workout.exercises || {}).forEach(([name, entry]) => {
          (entry.sets || []).filter(Boolean).forEach((set, idx) => {
            rows.push([
              dateStr,
              workout.dayTitle || '',
              deloadStr,
              name,
              set.setNum || idx + 1,
              set.weight ?? '',
              set.reps ?? '',
              typeof set.rir === 'number' ? set.rir : ''
            ]);
          });
        });
      });
      const csvText = rows.map(row => row.map(escapeCsv).join(',')).join('\n');
      const filename = `MachineMaster_History_${new Date().toISOString().slice(0, 10)}.csv`;
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
      this.triggerFileDownload(blob, filename);
      this.showToast('History CSV download requested.');
      return csvText;
    } catch (_) {
      this.showToast('Could not export CSV history.');
      return null;
    }
  },

  validateBackup(data) {
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const setsValid = sets => Array.isArray(sets) && sets.every(s => object(s) && !s.skipped && (s.weight === null || Number.isFinite(Number(s.weight))) && Number.isFinite(Number(s.reps)) && Number(s.reps) >= 0 && Number(s.weight) >= 0);
    const draftSetsValid = sets => Array.isArray(sets) && sets.every(s => object(s) &&
      (s.skipped === undefined || (typeof s.skipped === 'boolean' && !(s.skipped && s.completed))) &&
      (s.programSets === undefined || (Number.isInteger(s.programSets) && s.programSets > 0)) &&
      [s.weight, s.reps].every(value => value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))));
    const flowValid = session =>
      (session.lastInteractionAt === undefined || session.lastInteractionAt === null || (typeof session.lastInteractionAt === 'string' && Number.isFinite(Date.parse(session.lastInteractionAt)))) &&
      (session.exerciseOrder === undefined || (Array.isArray(session.exerciseOrder) && session.exerciseOrder.every(id => typeof id === 'string') && new Set(session.exerciseOrder).size === session.exerciseOrder.length)) &&
      (session.warmups === undefined || (object(session.warmups) && Object.values(session.warmups).every(sets => draftSetsValid(sets) && sets.every(set =>
        (set.completed === undefined || typeof set.completed === 'boolean') &&
        (set.setNum === undefined || (Number.isInteger(set.setNum) && set.setNum > 0)) &&
        (set.exerciseName === undefined || typeof set.exerciseName === 'string')))));
    const sessionValid = session => object(session) && typeof session.dayId === 'string' && object(session.logs) && Object.values(session.logs).every(draftSetsValid) && flowValid(session);
    if (!object(data) || !['routine', 'history', 'sessions'].some(key => key in data)) throw new Error('This is not a workout backup');
    if (data.routine !== undefined && (!Array.isArray(data.routine) || !data.routine.length || !data.routine.every(d => object(d) && typeof d.id === 'string' && Array.isArray(d.exercises) && d.exercises.every(ex => object(ex) && typeof ex.id === 'string' && typeof ex.name === 'string' && Number.isInteger(ex.sets) && ex.sets > 0 && typeof ex.targetReps === 'string')))) throw new Error('Invalid routine in backup');
    if (data.history !== undefined && (!Array.isArray(data.history) || !data.history.every(h => object(h) && typeof h.id === 'string' && Number.isFinite(new Date(h.date).getTime()) && object(h.exercises) && Object.values(h.exercises).every(ex => object(ex) && setsValid(ex.sets))))) throw new Error('Invalid workout history in backup');
    if (data.sessions !== undefined && (!Array.isArray(data.sessions) || !data.sessions.every(sessionValid))) throw new Error('Invalid sessions in backup');
    if (data.savedDrafts !== undefined && (!Array.isArray(data.savedDrafts) || !data.savedDrafts.every(draft => sessionValid(draft) && typeof draft.id === 'string' && (draft.recoveryId === undefined || typeof draft.recoveryId === 'string')))) throw new Error('Invalid saved drafts in backup');
    if (data.history?.some(record => record.sessionSnapshot && !sessionValid(record.sessionSnapshot))) throw new Error('Invalid recoverable workout in backup');
    if (data.dismissedOneTimeIds !== undefined && (!Array.isArray(data.dismissedOneTimeIds) || !data.dismissedOneTimeIds.every(id => typeof id === 'string' && id.trim()))) throw new Error('Invalid one-time workout markers in backup');
    if (data.lastActiveDay != null && typeof data.lastActiveDay !== 'string') throw new Error('Invalid last active day');
    ['machineSettings', 'equipmentSettings', 'exerciseNotes', 'lastWeights', 'exercisePreferences', 'timer'].forEach(key => { if (data[key] !== undefined && !object(data[key])) throw new Error(`Invalid ${key} in backup`); });
    if (data.equipmentSettings && !this.isEquipmentSettingsMap(data.equipmentSettings)) throw new Error('Invalid equipment settings');
    if (data.exercisePreferences && !Object.values(data.exercisePreferences).every(pref => object(pref) && (pref.increment === undefined || [1, 2.5, 5, 10].includes(pref.increment)))) throw new Error('Invalid exercise preferences');
    if (data.lastWeights && !Object.values(data.lastWeights).every(entry => object(entry) && Array.isArray(entry.sets) && setsValid(entry.sets.filter(Boolean)))) throw new Error('Invalid previous weights');
    if (data.deloadActive !== undefined && typeof data.deloadActive !== 'boolean') throw new Error('Invalid deload setting');
    if (data.deloadStartDate !== undefined && (!Number.isFinite(data.deloadStartDate) || data.deloadStartDate < 0)) throw new Error('Invalid deload start');
    if (data.timer && !Object.values(data.timer).every(value => value === null || (Number.isFinite(Number(value)) && Number(value) >= 0))) throw new Error('Invalid timer');
    return data;
  },

  prepareBackupImport(input, { restoreSettings = false } = {}) {
    const data = this.validateBackup(JSON.parse(JSON.stringify(input)));
    const sourceStorage = this.getStorageSnapshot(), sourceState = this.backupImportStateSignature();
    const localSessions = this.getStoredSessions();
    const legacy = localStorage.getItem(this.storageKeys.legacyCurrentSession);
    try { const parsed = JSON.parse(legacy); if (parsed?.logs && !localSessions.some(item => item.dayId === parsed.dayId)) localSessions.push(parsed); } catch (_) {}
    const progressed = localSessions.filter(session => this.hasSessionProgress(session) &&
      !this.history.some(record => (record.sessionId || record.sessionSnapshot?.id) === session.id));
    const activeIds = new Set(progressed.map(session => session.id).filter(Boolean));
    const summary = { added: 0, duplicates: 0, protected: progressed.length, retained: 0, overlapping: 0, restoreSettings, exportedAt: data.exportedAt };
    const history = JSON.parse(JSON.stringify(this.history)), ids = new Set(history.map(record => record.id));
    (data.history || []).forEach(record => {
      if (ids.has(record.id)) { summary.duplicates++; return; }
      if ([record.sessionId, record.sessionSnapshot?.id].some(id => id && activeIds.has(id))) { summary.overlapping++; return; }
      ids.add(record.id); history.push(record); summary.added++;
    });
    history.sort((a, b) => new Date(a.date) - new Date(b.date));
    const writes = new Map([[this.storageKeys.history, JSON.stringify(history)]]);
    (data.dismissedOneTimeIds || []).forEach(dayId => {
      if (!progressed.some(session => session.dayId === dayId)) {
        writes.set(`gym_onetime_done_${dayId}`, '1');
      }
    });
    const merged = {};
    ['machineSettings', 'equipmentSettings', 'exerciseNotes', 'exercisePreferences'].forEach(key => {
      merged[key] = restoreSettings ? { ...(this[key] || {}), ...(data[key] || {}) } : { ...(data[key] || {}), ...(this[key] || {}) };
      const storageKey = this.storageKeys[key] || (key === 'equipmentSettings' ? 'gym_equipment_settings_v1' : null);
      if (storageKey) writes.set(storageKey, JSON.stringify(merged[key]));
    });
    const weightReader = Object.assign(Object.create(this), { history });
    const normalizeWeights = weights => weightReader.loadLastWeights({ getItem: () => JSON.stringify(weights || {}) });
    merged.lastWeights = JSON.parse(JSON.stringify(this.lastWeights || {}));
    [normalizeWeights(data.lastWeights), this.buildLastWeightsFromHistory(history)].forEach(weights => Object.entries(weights).forEach(([name, entry]) => {
      const existing = merged.lastWeights[name];
      if (!existing || (existing.deload && !entry.deload) ||
        (Boolean(existing.deload) === Boolean(entry.deload) && Date.parse(entry.date) > (Date.parse(existing.date) || 0))) merged.lastWeights[name] = entry;
    }));
    writes.set(this.storageKeys.lastWeights, JSON.stringify(merged.lastWeights));
    const candidate = this.normalizeRoutineData(restoreSettings && data.routine ? data.routine : this.routine);
    // Resolve program revisions before comparing drafts, so repeated legacy imports deduplicate after normalization.
    const emptyStorage = { length: 0, key() { return null; }, getItem() { return null; } };
    const routine = Object.assign(Object.create(this), merged, { history }).prepareRoutineUpgrade(candidate, emptyStorage).routine;
    const normalize = (session, source = this.routine, preserve = false) => this.normalizeImportedDraft(session, routine, source, { ...merged, history }, preserve);
    const currentDrafts = localSessions.map(session => normalize(session));
    this.getSavedDrafts().forEach(({ recoveryId, session }) => writes.set(`gym_saved_draft_${recoveryId}`, JSON.stringify(normalize(session, this.routine, true))));
    const availableDays = new Set(routine.map(day => day.id));
    const archivedIds = new Set(history.map(record => record.sessionId || record.sessionSnapshot?.id).filter(Boolean));
    const incomingSessions = new Map(currentDrafts.map(session => [session.dayId, session]));
    const retain = draft => { if (this.retainSavedDraft(draft, writes).added) summary.retained++; };
    (data.sessions || []).forEach(inputSession => {
      const session = normalize(inputSession, data.routine || this.routine);
      const current = incomingSessions.get(session.dayId);
      if (current && this.draftFingerprint(current) === this.draftFingerprint(session)) return;
      if (archivedIds.has(session.id) || !availableDays.has(session.dayId) || (current && this.hasSessionProgress(current))) { retain(session); return; }
      const copy = JSON.parse(JSON.stringify(session));
      copy.id = this.importedSessionId(copy);
      incomingSessions.set(copy.dayId, copy);
      writes.set(this.getSessionKey(copy.dayId), JSON.stringify(copy));
    });
    (data.savedDrafts || []).forEach(inputDraft => {
      const draft = normalize(inputDraft, data.routine || this.routine, true);
      if (!currentDrafts.some(current => this.draftFingerprint(current) === this.draftFingerprint(draft))) retain(draft);
    });
    // Include current in-memory drafts in the same transaction, even if they have not reached storage yet.
    currentDrafts.forEach(session => {
      if (this.hasSessionProgress(session)) {
        writes.set(this.getSessionKey(session.dayId), JSON.stringify(session));
        if (!availableDays.has(session.dayId)) retain(session);
      }
    });
    const nextState = { ...merged, history, routine, preserveActive: Boolean(this.session && this.hasSessionProgress(this.session) && availableDays.has(this.session.dayId)) };
    if (restoreSettings) ['wakeLockEnabled', 'deloadActive', 'deloadStartDate'].forEach(key => {
      if (data[key] !== undefined) { writes.set(this.storageKeys[key], String(data[key])); nextState[key] = data[key]; }
    });
    if (!progressed.length && data.lastActiveDay && availableDays.has(data.lastActiveDay)) writes.set('gym_last_active_day_v1', data.lastActiveDay);
    if (!progressed.length && data.timer) {
      const keys = {
        targetEnd: this.storageKeys.timerTargetEnd, totalDuration: this.storageKeys.timerTotalDuration,
        minimumRest: 'gym_timer_minimum_v1', startedAt: 'gym_timer_started_at_v1'
      };
      Object.entries(keys).forEach(([field, key]) => { if (field in data.timer) writes.set(key, data.timer[field] === null ? null : String(data.timer[field])); });
      nextState.restoreTimer = true;
    }
    const staged = Object.assign(Object.create(this), nextState);
    const repair = staged.prepareRoutineUpgrade(routine, this.storageOverlay(writes));
    repair.writes.forEach((value, key) => writes.set(key, value));
    writes.set(this.storageKeys.routine, JSON.stringify(repair.routine));
    writes.set(this.storageKeys.routineRev, this.CURRENT_ROUTINE_REV);
    nextState.routine = repair.routine;
    return { summary, writes, nextState, sourceStorage, sourceState };
  },

  applyBackupImport(plan) {
    try {
      const current = this.getStorageSnapshot();
      if (plan.sourceState !== this.backupImportStateSignature() || current.size !== plan.sourceStorage.size ||
        [...current].some(([key, value]) => plan.sourceStorage.get(key) !== value))
        throw new Error('Your workout changed. Preview the backup again before restoring.');
      this.writeStorageTransaction(plan.writes);
      const { preserveActive, restoreTimer, ...state } = plan.nextState;
      Object.assign(this, state);
      if (preserveActive) this.activeDayIndex = this.routine.findIndex(day => day.id === this.session.dayId);
      else this.activeDayIndex = this.getResumeDayIndex();
      this.session = this.loadSession();
      this.selectionLocalDate = this.getLocalDateKey(new Date());
      if (restoreTimer) {
        if (this.timer?.intervalId) clearInterval(this.timer.intervalId);
        if (this.timer) { this.timer.active = false; this.timer.intervalId = null; }
        this.restoreActiveTimer();
      }
      this.closeModal(this.summaryModalEl);
      this.showToast(`Restore complete. Added ${plan.summary.added} workouts; ${plan.summary.retained} recovery drafts retained.`);
      this.render();
      return true;
    } catch (error) {
      this.showToast(`Could not restore backup: ${error.message || 'Storage unavailable'}`);
      return false;
    }
  },

  previewBackupImport(jsonString, restoreSettings = false) {
    const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
    try {
      const data = this.validateBackup(JSON.parse(jsonString));
      const plan = this.prepareBackupImport(data, { restoreSettings });
      const info = plan.summary;
      const title = document.getElementById('summaryModalTitle'); if (title) title.textContent = 'Restore backup';
      this.summaryContentEl.innerHTML = `<p>${info.exportedAt && Number.isFinite(Date.parse(info.exportedAt)) ? `Exported ${this.escapeHtml(new Date(info.exportedAt).toLocaleString())}` : 'Backup date unavailable'}</p>
        <ul class="backup-preview-list"><li>${plural(info.added, 'workout')} to add · ${plural(info.duplicates, 'duplicate')} kept unchanged</li><li>${plural(info.protected, 'current workout')} protected</li><li>${plural(info.retained, 'recovery draft')} to add</li>${info.overlapping ? `<li>${plural(info.overlapping, 'saved workout')} omitted because the same workout is active here</li>` : ''}</ul>
        <p>Current unfinished workouts stay active. Other versions are available under Recovery drafts.</p>
        <label class="restore-settings-choice"><input type="checkbox" id="restoreBackupSettings" ${restoreSettings ? 'checked' : ''}> Replace program and matching settings from this backup</label>
        <p>${restoreSettings ? 'Program and matching settings will be replaced. Workouts from unavailable days remain in recovery.' : 'Current program and matching settings will be kept.'}</p>
        <div class="insight-actions"><button type="button" class="secondary-btn" id="cancelBackupRestore" autofocus>Cancel</button><button type="button" class="primary-btn" id="confirmBackupRestore">Restore backup</button></div>`;
      this.openModal(this.summaryModalEl);
      document.getElementById('cancelBackupRestore')?.addEventListener('click', () => this.closeModal(this.summaryModalEl));
      document.getElementById('restoreBackupSettings')?.addEventListener('change', event => this.previewBackupImport(jsonString, event.target.checked));
      document.getElementById('confirmBackupRestore')?.addEventListener('click', () => this.applyBackupImport(plan));
      return plan;
    } catch (error) { this.showToast(`Could not read backup: ${error.message || 'Invalid format'}`); return null; }
  },

  importData(jsonString, options = {}) {
    try { return this.applyBackupImport(this.prepareBackupImport(JSON.parse(jsonString), options)); }
    catch (error) { console.error('Import error:', error); alert('Could not restore backup file: ' + (error.message || 'Invalid format')); return false; }
  },

  renderRecoveryDrafts() {
    const drafts = this.getSavedDrafts();
    if (!drafts.length) return '<p class="insight-empty">No recovery drafts.</p>';
    return drafts.map(({ recoveryId, session }) => {
      const day = this.routine.find(day => day.id === session.dayId);
      const archived = this.history.find(record => (record.sessionId || record.sessionSnapshot?.id) === session.id);
      const count = Object.values(session.logs).flat().filter(set => set.completed).length;
      const stamp = session.lastInteractionAt || session.startTime || session.createdAt;
      const date = Number.isFinite(Date.parse(stamp)) ? new Date(stamp).toLocaleString() : 'Date unavailable';
      return `<article class="recovery-draft insight-panel"><h4>${this.escapeHtml(session.dayTitle || day?.title || session.dayId)}</h4><p>${this.escapeHtml(date)} · ${count} completed sets</p>
        ${!day ? '<p>Restore this draft’s program before resuming it.</p>' : archived ? '<p>This workout is already saved in Progress. Reopen it there to continue.</p>' : `<button type="button" class="secondary-btn recovery-restore-btn" data-recoveryid="${this.escapeHtml(recoveryId)}">Restore draft</button>`}</article>`;
    }).join('');
  }
});
