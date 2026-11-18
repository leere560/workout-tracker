// Routine normalization, one-time workout provisioning, and schema migrations.
(globalThis.WorkoutAppMixins ||= []).push({
  CURRENT_ROUTINE_REV: '22',

  normalizeRoutineData(input) {
    const routine = JSON.parse(JSON.stringify(input));
    // Add only missing metadata fields; user exercises, order, sets, reps, and notes stay authoritative.
    const defaultExercises = (typeof DEFAULT_ROUTINE !== 'undefined' ? DEFAULT_ROUTINE : []).flatMap(d => d.exercises || []);
    routine.forEach(day => day.exercises.forEach(ex => {
      const defaults = defaultExercises.find(e => e.id === ex.id || e.name === ex.name);
      const restText = String(ex.rest || '');
      const legacyRest = /min/i.test(restText) ? parseFloat(restText) * 60 : parseFloat(restText);
      if (!Number.isFinite(ex.restSeconds)) ex.restSeconds = Math.max(120, legacyRest || defaults?.restSeconds || 120);
      ex.restSeconds = Math.max(120, ex.restSeconds);
      ex.rest = ex.restSeconds % 60 === 0 ? `${ex.restSeconds / 60} min` : `${ex.restSeconds} sec`;
      if (ex.superset) {
        if (!Number.isFinite(ex.superset.restSeconds)) ex.superset.restSeconds = defaults?.superset?.restSeconds || (/seated leg curl/i.test(ex.name) ? 75 : 60);
        ex.superset.rest = `${ex.superset.restSeconds} sec`;
      }
      if (!Number.isFinite(ex.increment)) ex.increment = defaults?.increment || this.getExerciseIncrement(ex, ex.name);
    }));
    return routine;
  },

  prepareRoutineUpgrade(routine, storage = localStorage, options = {}) {
    const saturday = this.prepareSaturdayEquipmentRepair(routine, storage);
    const monday = this.prepareMondayRoutineUpgrade(saturday.routine, this.storageOverlay(saturday.writes, storage));
    const priorWrites = new Map([...saturday.writes, ...monday.writes]);
    const back = this.prepareBackExtensionUpgrade(monday.routine, this.storageOverlay(priorWrites, storage));
    const stagedWrites = new Map([...priorWrites, ...back.writes]);
    const restored = this.prepareMondayRestoration(back.routine, this.storageOverlay(stagedWrites, storage), options);
    const restoredWrites = new Map([...stagedWrites, ...restored.writes]);
    const adduction = this.prepareMondayAdductionAndSuperset(restored.routine, this.storageOverlay(restoredWrites, storage), options);
    const adductionWrites = new Map([...restoredWrites, ...adduction.writes]);
    const combo = this.prepareOneTimeSundayCombo(adduction.routine, this.storageOverlay(adductionWrites, storage));
    return { routine: combo.routine, writes: new Map([...adductionWrites, ...combo.writes]) };
  },

  isOneTimeWorkoutCompleted(dayId, storage = localStorage) {
    if (!dayId) return false;
    if (storage?.getItem?.(`gym_onetime_done_${dayId}`) === '1') return true;
    const hasMatch = list => Array.isArray(list) && list.some(record => record?.dayId === dayId || record?.sessionSnapshot?.dayId === dayId);
    if (hasMatch(this.history)) return true;
    try {
      const raw = storage?.getItem?.(this.storageKeys?.history || 'gym_history_v1');
      if (raw && hasMatch(JSON.parse(raw))) return true;
    } catch (_) {}
    return false;
  },

  buildOneTimeSundayComboDay(routine) {
    const combo = JSON.parse(JSON.stringify(ONE_TIME_SUNDAY_UPPER_B_ARMS_COMBO));
    const allExercises = (routine || []).flatMap(day => day.exercises || []);
    combo.exercises.forEach(ex => {
      if (!ex.sourceExerciseId) return;
      const source = allExercises.find(item => item.id === ex.sourceExerciseId);
      if (!source) return;
      ['name', 'muscle', 'increment', 'startingWeight', 'needsBaseline', 'notes', 'videoUrl', 'originalExercise', 'equipmentAlternatives']
        .forEach(key => { if (source[key] !== undefined) ex[key] = JSON.parse(JSON.stringify(source[key])); });
    });
    return combo;
  },

  prepareOneTimeSundayCombo(routine, storage = localStorage) {
    const updated = JSON.parse(JSON.stringify(routine)), writes = new Map();
    if (typeof ONE_TIME_SUNDAY_UPPER_B_ARMS_COMBO === 'undefined') return { routine: updated, writes };
    const baseIds = ['wed___upper_a', 'fri___lower_a', 'sat___upper_b', 'sun___db_arms', 'mon__lower_b'];
    if (!baseIds.every(id => updated.some(d => d.id === id))) return { routine: updated, writes };
    const comboId = ONE_TIME_SUNDAY_UPPER_B_ARMS_COMBO.id;
    if (this.isOneTimeWorkoutCompleted(comboId, storage)) {
      return { routine: updated.filter(d => d.id !== comboId), writes };
    }
    if (!updated.some(d => d.id === comboId)) {
      updated.push(this.buildOneTimeSundayComboDay(updated));
    }
    return { routine: updated, writes };
  },

  prepareMondayRoutineUpgrade(routine, storage = localStorage) {
    const updated = JSON.parse(JSON.stringify(routine)), writes = new Map();
    const day = updated.find(day => day.id === 'mon__lower_b');
    const defaults = (typeof DEFAULT_ROUTINE !== 'undefined' ? DEFAULT_ROUTINE : []).find(day => day.id === 'mon__lower_b');
    const retiredAbduction = typeof RETIRED_MONDAY_ABDUCTION !== 'undefined' ? RETIRED_MONDAY_ABDUCTION : null;
    if (!day) return { routine: updated, writes };
    day.exercises.forEach(ex => {
      const canonical = defaults?.exercises?.find(item => item.id === ex.id && item.previousExercise) ||
        (retiredAbduction && ex.id === retiredAbduction.id ? retiredAbduction : null);
      if (!canonical || ex.mondayRevision === 1) return;
      ex.mondayRevision = 1;
      const target = canonical.rdlVersion || canonical;
      const legacy = target.previousExercise;
      if (ex.name !== legacy.name) return; // Custom equipment and deliberate later defaults remain authoritative.
      const old = { ...this.getExerciseSnapshot(ex), programSets: ex.sets };
      ex.previousExercise = old;
      ex.equipmentAlternatives = [...(ex.equipmentAlternatives || []).filter(item => item?.name !== old.name), old];
      if (ex.sets === legacy.programSets) ex.sets = target.sets;
      if (ex.targetReps === legacy.targetReps) ex.targetReps = target.targetReps;
      if (ex.increment === legacy.increment) ex.increment = target.increment;
      ['name', 'muscle', 'startingWeight', 'needsBaseline', 'notes', 'videoUrl'].forEach(key => { ex[key] = target[key]; });
    });
    const staged = Object.assign(Object.create(this), { routine: updated });
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i), retained = key.startsWith('gym_saved_draft_') && !key.startsWith('gym_saved_draft_for_');
      if (!(retained || key === this.storageKeys.legacyCurrentSession || key.startsWith(this.storageKeys.currentSessionPrefix))) continue;
      let draft; try { draft = JSON.parse(storage.getItem(key)); } catch (_) { continue; }
      if (draft?.dayId !== day.id || !draft.logs) continue;
      const before = JSON.stringify(draft);
      staged.reconcileMondaySession(draft, day, { preserve: retained || !draft.initialLogs || staged.hasSessionProgress(draft) });
      if (JSON.stringify(draft) !== before) writes.set(key, JSON.stringify(draft));
    }
    return { routine: updated, writes };
  },

  prepareBackExtensionUpgrade(routine, storage = localStorage) {
    const updated = JSON.parse(JSON.stringify(routine)), writes = new Map();
    const day = updated.find(item => item.id === 'mon__lower_b');
    const ex = day?.exercises.find(item => item.id === 'mon__lower_b_ex_hip_thrust');
    const canonical = DEFAULT_ROUTINE.find(item => item.id === 'mon__lower_b')?.exercises.find(item => item.id === ex?.id);
    if (!ex || !canonical || ex.backExtensionRevision === 1) return { routine: updated, writes };
    ex.backExtensionRevision = 1;
    if (ex.name !== 'Barbell Romanian Deadlift') return { routine: updated, writes };
    const old = { ...this.getExerciseSnapshot(ex), programSets: ex.sets };
    ex.equipmentAlternatives = [...(ex.equipmentAlternatives || []).filter(item => item?.name !== old.name), old];
    if (ex.targetReps === canonical.rdlVersion.targetReps) ex.targetReps = canonical.targetReps;
    ['name', 'muscle', 'startingWeight', 'needsBaseline', 'notes', 'videoUrl'].forEach(key => { ex[key] = canonical[key]; });
    const staged = Object.assign(Object.create(this), { routine: updated });
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i), retained = key.startsWith('gym_saved_draft_') && !key.startsWith('gym_saved_draft_for_');
      if (!(retained || key === this.storageKeys.legacyCurrentSession || key.startsWith(this.storageKeys.currentSessionPrefix))) continue;
      let draft; try { draft = JSON.parse(storage.getItem(key)); } catch (_) { continue; }
      if (draft?.dayId !== day.id || !Array.isArray(draft.logs?.[ex.id])) continue;
      const before = JSON.stringify(draft), rows = draft.logs[ex.id];
      const untouched = !retained && draft.initialLogs && !staged.hasSessionProgress(draft) && !draft.swaps?.[ex.id];
      if (untouched) {
        const targets = Object.assign(Object.create(staged), { session: draft, deloadActive: Boolean(draft.deload) });
        draft.logs[ex.id] = rows.map((set, index) => {
          const target = targets.getSetTarget(ex, index, ex.name);
          return {
            setNum: index + 1, weight: target.targetWeight, reps: target.targetReps, completed: false, rir: null,
            exerciseName: ex.name, muscle: ex.muscle, targetReps: ex.targetReps, needsBaseline: Boolean(target.needsBaseline)
          };
        });
        draft.initialLogs[ex.id] = JSON.parse(JSON.stringify(draft.logs[ex.id]));
      } else staged.reconcileSessionEquipmentIdentity(draft, ex, old);
      if (JSON.stringify(draft) !== before) writes.set(key, JSON.stringify(draft));
    }
    return { routine: updated, writes };
  },

  prepareMondaySimplification(routine, storage = localStorage) {
    const updated = JSON.parse(JSON.stringify(routine)), writes = new Map();
    const day = updated.find(item => item.id === 'mon__lower_b');
    const retiredAbduction = typeof RETIRED_MONDAY_ABDUCTION !== 'undefined' ? RETIRED_MONDAY_ABDUCTION : null;
    if (!day || !retiredAbduction) return { routine: updated, writes };
    const retired = day.exercises.find(ex => ex.id === retiredAbduction.id);
    day.exercises = day.exercises.filter(ex => ex.id !== retiredAbduction.id);
    day.exercises.forEach(ex => {
      if (['mon__lower_b_ex2', 'mon__lower_b_ex5'].includes(ex.id) && ex.superset?.id === 'lower_b_leg_press_calf') ex.superset = null;
    });
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i), retained = key.startsWith('gym_saved_draft_') && !key.startsWith('gym_saved_draft_for_');
      if (!(retained || key === this.storageKeys.legacyCurrentSession || key.startsWith(this.storageKeys.currentSessionPrefix))) continue;
      let draft; try { draft = JSON.parse(storage.getItem(key)); } catch (_) { continue; }
      if (draft?.dayId !== day.id || !draft.logs) continue;
      const before = JSON.stringify(draft), rows = draft.logs[retiredAbduction.id];
      // Keep removed rows in the snapshot and preserve identities for later history recording.
      if (Array.isArray(rows)) {
        const fallback = draft.mondayRevision === 1 ? (retired || retiredAbduction) : retiredAbduction.previousExercise;
        for (const row of rows) {
          row.exerciseName ||= fallback.name; row.muscle ||= fallback.muscle; row.targetReps ||= fallback.targetReps;
        }
      }
      if (Array.isArray(draft.exerciseOrder)) draft.exerciseOrder = draft.exerciseOrder.filter(id => id !== retiredAbduction.id);
      if (JSON.stringify(draft) !== before) writes.set(key, JSON.stringify(draft));
    }
    return { routine: updated, writes };
  },

  prepareMondayRestoration(routine, storage = localStorage, options = {}) {
    const updated = JSON.parse(JSON.stringify(routine)), writes = new Map();
    const day = updated.find(item => item.id === 'mon__lower_b');
    if (!day) return { routine: updated, writes };
    if (options.fastStartup && day.abductionRestoreVersion === 1) return { routine: updated, writes };
    if (day.adductionSupersetVersion !== 1) {
      day.exercises.forEach(ex => {
        if (['mon__lower_b_ex2', 'mon__lower_b_ex5'].includes(ex.id) && ex.superset?.id === 'lower_b_leg_press_calf') ex.superset = null;
      });
    }
    if (typeof RETIRED_MONDAY_ABDUCTION !== 'undefined' && day.abductionRestoreVersion !== 1 && !day.exercises.some(ex => ex.id === RETIRED_MONDAY_ABDUCTION.id)) {
      const crunchIndex = day.exercises.findIndex(ex => ex.id === 'mon__lower_b_ex6');
      day.exercises.splice(crunchIndex < 0 ? day.exercises.length : crunchIndex, 0, JSON.parse(JSON.stringify(RETIRED_MONDAY_ABDUCTION)));
    }
    day.abductionRestoreVersion = 1;
    const staged = Object.assign(Object.create(this), { routine: updated });
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i), retained = key.startsWith('gym_saved_draft_') && !key.startsWith('gym_saved_draft_for_');
      if (!(retained || key === this.storageKeys.legacyCurrentSession || key.startsWith(this.storageKeys.currentSessionPrefix))) continue;
      let draft; try { draft = JSON.parse(storage.getItem(key)); } catch (_) { continue; }
      if (draft?.dayId !== day.id || !draft.logs) continue;
      const before = JSON.stringify(draft);
      staged.ensureMondayAbductionRows(draft, day);
      if (JSON.stringify(draft) !== before) writes.set(key, JSON.stringify(draft));
    }
    return { routine: updated, writes };
  },

  prepareMondayAdductionAndSuperset(routine, storage = localStorage, options = {}) {
    const updated = JSON.parse(JSON.stringify(routine)), writes = new Map();
    const day = updated.find(item => item.id === 'mon__lower_b');
    if (!day) return { routine: updated, writes };
    if (options.fastStartup && day.adductionSupersetVersion === 1) return { routine: updated, writes };
    const defaults = (typeof DEFAULT_ROUTINE !== 'undefined' ? DEFAULT_ROUTINE : []).find(item => item.id === 'mon__lower_b');
    if (day.adductionSupersetVersion !== 1) {
      day.exercises.forEach(ex => {
        if (['mon__lower_b_ex2', 'mon__lower_b_ex5'].includes(ex.id)) {
          const canonical = defaults?.exercises.find(item => item.id === ex.id);
          if (canonical?.superset) ex.superset = JSON.parse(JSON.stringify(canonical.superset));
        }
      });
      if (typeof MONDAY_HIP_ADDUCTION !== 'undefined' && !day.exercises.some(ex => ex.id === MONDAY_HIP_ADDUCTION.id)) {
        const crunchIndex = day.exercises.findIndex(ex => ex.id === 'mon__lower_b_ex6');
        day.exercises.splice(crunchIndex < 0 ? day.exercises.length : crunchIndex, 0, JSON.parse(JSON.stringify(MONDAY_HIP_ADDUCTION)));
      }
      day.adductionSupersetVersion = 1;
    }
    const staged = Object.assign(Object.create(this), { routine: updated });
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i), retained = key.startsWith('gym_saved_draft_') && !key.startsWith('gym_saved_draft_for_');
      if (!(retained || key === this.storageKeys.legacyCurrentSession || key.startsWith(this.storageKeys.currentSessionPrefix))) continue;
      let draft; try { draft = JSON.parse(storage.getItem(key)); } catch (_) { continue; }
      if (draft?.dayId !== day.id || !draft.logs) continue;
      const before = JSON.stringify(draft);
      staged.ensureMondayAbductionRows(draft, day);
      if (JSON.stringify(draft) !== before) writes.set(key, JSON.stringify(draft));
    }
    return { routine: updated, writes };
  },

  ensureMondayAbductionRows(session, day) {
    if (day?.id !== 'mon__lower_b' || !session?.logs) return session;
    const slotIds = [
      ...(typeof RETIRED_MONDAY_ABDUCTION !== 'undefined' ? [RETIRED_MONDAY_ABDUCTION.id] : []),
      ...(typeof MONDAY_HIP_ADDUCTION !== 'undefined' ? [MONDAY_HIP_ADDUCTION.id] : [])
    ];
    for (const slotId of slotIds) {
      const ex = day.exercises.find(item => item.id === slotId);
      if (!ex) continue;
      if (!Array.isArray(session.logs[ex.id])) {
        const targets = Object.assign(Object.create(this), { session, deloadActive: Boolean(session.deload) });
        const count = session.deload ? Math.max(2, Math.floor(ex.sets * .67)) : ex.sets;
        session.logs[ex.id] = Array.from({ length: count }, (_, index) => {
          const target = targets.getSetTarget(ex, index, ex.name);
          return {
            setNum: index + 1, weight: target.targetWeight, reps: target.targetReps, completed: false, rir: null,
            exerciseName: ex.name, muscle: ex.muscle, targetReps: ex.targetReps, needsBaseline: Boolean(target.needsBaseline)
          };
        });
        if (session.initialLogs) session.initialLogs[ex.id] = JSON.parse(JSON.stringify(session.logs[ex.id]));
      }
      if (Array.isArray(session.exerciseOrder) && !session.exerciseOrder.includes(ex.id)) {
        const index = session.exerciseOrder.indexOf('mon__lower_b_ex6');
        session.exerciseOrder.splice(index < 0 ? session.exerciseOrder.length : index, 0, ex.id);
      }
    }
    return session;
  },

  reconcileMondaySession(session, day, { preserve = true, recordedExercises = {} } = {}) {
    if (day?.id !== 'mon__lower_b' || !session?.logs) return session;
    const defaults = (typeof DEFAULT_ROUTINE !== 'undefined' ? DEFAULT_ROUTINE : []).find(candidate => candidate.id === day.id)?.exercises || [];
    const legacySession = session.mondayRevision !== 1;
    day.exercises.forEach(ex => {
      const canonical = defaults.find(item => item.id === ex.id);
      const previous = ex.previousExercise || (ex.name === canonical?.name ? canonical.previousExercise : null);
      const rows = session.logs[ex.id];
      if (!previous || !Array.isArray(rows)) return;
      const sourceName = session.swaps?.[ex.id]?.name || rows.find(set => set.exerciseName)?.exerciseName ||
        (session.mondayRevision === 1 ? ex.name : previous.name);
      if (preserve && legacySession) {
        rows.forEach(set => { set.programSets ||= previous.programSets; });
        if (session.swaps?.[ex.id]) session.swaps[ex.id].programSets ||= previous.programSets;
      }
      rows.forEach(set => { if (set.exerciseName === previous.name && previous.name !== ex.name) set.programSets ||= previous.programSets; });
      if (sourceName === ex.name) return;
      if (!preserve && !session.swaps?.[ex.id]) {
        const targets = Object.assign(Object.create(this), { session: { ...session, swaps: {} }, deloadActive: Boolean(session.deload) });
        const count = session.deload ? Math.max(2, Math.floor(ex.sets * .67)) : ex.sets;
        session.logs[ex.id] = Array.from({ length: count }, (_, index) => {
          const target = targets.getSetTarget(ex, index, ex.name);
          return {
            setNum: index + 1, weight: target.targetWeight, reps: target.targetReps, completed: false, rir: null,
            exerciseName: ex.name, muscle: ex.muscle, targetReps: ex.targetReps, needsBaseline: Boolean(target.needsBaseline)
          };
        });
        session.initialLogs[ex.id] = JSON.parse(JSON.stringify(session.logs[ex.id]));
      } else {
        this.reconcileSessionEquipmentIdentity(session, ex, previous, recordedExercises);
        const swap = session.swaps?.[ex.id];
        if (swap?.name === previous.name) swap.programSets ||= previous.programSets;
      }
    });
    session.mondayRevision = 1;
    return session;
  },

  prepareSaturdayEquipmentRepair(routine, storage = localStorage) {
    const repaired = JSON.parse(JSON.stringify(routine));
    const writes = new Map(), changes = [];
    const day = repaired.find(day => day.id === 'sat___upper_b');
    const originals = (typeof DEFAULT_ROUTINE !== 'undefined' ? DEFAULT_ROUTINE : []).find(day => day.id === 'sat___upper_b')?.exercises || [];
    const recognized = {
      sat___upper_b_ex1: ['Incline Dumbbell Bench Press', 'Flat Dumbbell Bench Press'],
      sat___upper_b_ex3: ['Seated Dumbbell Shoulder Press', 'Standing Overhead DB Press', 'Standing Dumbbell Overhead Press']
    };
    (day?.exercises || []).forEach(ex => {
      if (!recognized[ex.id] || ex.equipmentRepairVersion === 1) return;
      ex.equipmentRepairVersion = 1;
      if (!recognized[ex.id].includes(ex.name)) return;
      const canonical = originals.find(original => original.id === ex.id);
      if (!canonical) return;
      const old = this.getExerciseSnapshot(ex);
      const original = this.getExerciseSnapshot(canonical);
      // The equipment repair does not rewrite the user's prescribed rep ranges.
      original.targetReps = ex.targetReps;
      ex.equipmentAlternatives = [...(Array.isArray(ex.equipmentAlternatives) ? ex.equipmentAlternatives : []).filter(item => item?.name !== old.name), old];
      ex.originalExercise = original;
      ['name', 'muscle', 'notes', 'videoUrl', 'increment', 'startingWeight'].forEach(key => { ex[key] = canonical[key]; });
      ex.needsBaseline = true;
      changes.push({ ex, old });
    });
    if (!changes.length) return { routine: repaired, writes };
    const keys = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key === this.storageKeys.legacyCurrentSession || key.startsWith(this.storageKeys.currentSessionPrefix) ||
          (key.startsWith('gym_saved_draft_') && !key.startsWith('gym_saved_draft_for_'))) keys.push(key);
    }
    keys.forEach(key => {
      let draft;
      try { draft = JSON.parse(storage.getItem(key)); } catch (_) { return; }
      if (draft?.dayId !== day.id || !draft.logs || typeof draft.logs !== 'object') return;
      const before = JSON.stringify(draft);
      changes.forEach(({ ex, old }) => {
        const rows = draft.logs[ex.id], warmups = draft.warmups?.[ex.id] || [];
        if (!Array.isArray(rows)) return;
        const swap = draft.swaps?.[ex.id];
        const untouched = !swap && !warmups.length && Array.isArray(draft.initialLogs?.[ex.id]) &&
          !rows.some(set => set.completed) && JSON.stringify(rows) === JSON.stringify(draft.initialLogs[ex.id]);
        if (untouched) {
          const targets = Object.create(this);
          targets.session = draft;
          targets.deloadActive = Boolean(draft.deload);
          draft.logs[ex.id] = rows.map((set, index) => {
            const target = targets.getSetTarget(ex, index, ex.name);
            const restored = {
              ...set, weight: target.targetWeight, reps: target.targetReps, needsBaseline: Boolean(target.needsBaseline),
              exerciseName: ex.name, muscle: ex.muscle, targetReps: ex.targetReps, completed: false, rir: null
            };
            delete restored.completedAt;
            delete restored.rirAnswered;
            return restored;
          });
          draft.initialLogs[ex.id] = JSON.parse(JSON.stringify(draft.logs[ex.id]));
        } else {
          this.reconcileSessionEquipmentIdentity(draft, ex, old);
        }
      });
      if (JSON.stringify(draft) !== before) writes.set(key, JSON.stringify(draft));
    });
    return { routine: repaired, writes };
  },

  reconcileSessionEquipmentIdentity(session, exercise, fallback = exercise, recordedExercises = {}) {
    const rows = session.logs?.[exercise.id];
    if (!Array.isArray(rows)) return;
    const warmups = Array.isArray(session.warmups?.[exercise.id]) ? session.warmups[exercise.id] : [];
    const named = set => typeof set?.exerciseName === 'string' && set.exerciseName.trim();
    const swap = session.swaps?.[exercise.id];
    const alternatives = this.getSubstitutionsForExercise(exercise.name, exercise);
    const descriptors = [swap, exercise, fallback, this.getOriginalExercise(exercise),
      ...(Array.isArray(exercise.equipmentAlternatives) ? exercise.equipmentAlternatives : []), ...alternatives];
    const familyNames = new Set(descriptors.filter(item => typeof item?.name === 'string').map(item => item.name));
    const recordedNames = Object.keys(recordedExercises || {}).filter(name => familyNames.has(name));
    const recordedName = recordedNames.length === 1 ? recordedNames[0] : null;
    const completed = [...rows, ...warmups].filter(set => set.completed && named(set));
    const completedNames = [...new Set(completed.map(set => set.exerciseName))];
    const completedName = completedNames.length === 1 ? completedNames[0] : null;
    const pending = rows.find(set => !set.completed && named(set)) || warmups.find(set => !set.completed && named(set));
    const activeName = (typeof swap?.name === 'string' && swap.name.trim() && swap.name) ||
      pending?.exerciseName || completedName || recordedName || fallback.name;
    const descriptor = name => {
      const known = descriptors.find(item => item?.name === name);
      const evidence = [...rows, ...warmups].find(set => set.exerciseName === name);
      return known ? this.getExerciseSnapshot(known) : {
        name, muscle: evidence?.muscle || fallback.muscle || exercise.muscle,
        targetReps: evidence?.targetReps || fallback.targetReps || exercise.targetReps
      };
    };
    const equipment = descriptor(activeName);
    if (!swap && activeName !== exercise.name) {
      session.swaps ||= {};
      session.swaps[exercise.id] = equipment;
    }
    // Completed rows retain their own equipment, including when pending sets use a newer swap.
    const completedEquipment = descriptor(completedName || recordedName || fallback.name);
    rows.forEach(set => {
      if (named(set)) {
        const programSets = descriptor(set.exerciseName).programSets;
        if (programSets) set.programSets ||= programSets;
        return;
      }
      const identity = set.completed ? completedEquipment : equipment;
      set.exerciseName ||= identity.name;
      set.muscle ||= identity.muscle || fallback.muscle;
      set.targetReps ||= identity.targetReps || fallback.targetReps;
      if (identity.programSets) set.programSets ||= identity.programSets;
    });
    warmups.forEach(set => {
      set.exerciseName ||= (set.completed ? completedEquipment : equipment).name;
    });
  }
});
