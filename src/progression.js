// Progression targets, aliases, exercise scheduling, ordering, warm-ups, and volume math.
(globalThis.WorkoutAppMixins ||= []).push({
  getCanonicalExerciseName(name) {
    if (!name || typeof name !== 'string') return '';
    if (typeof EXERCISE_ALIASES !== 'undefined' && EXERCISE_ALIASES[name]) return EXERCISE_ALIASES[name];
    return name;
  },

  getEquivalentExerciseNames(name) {
    if (!name || typeof name !== 'string') return [];
    const canonical = this.getCanonicalExerciseName(name);
    const list = [name];
    if (canonical && canonical !== name) list.push(canonical);
    if (typeof EXERCISE_ALIASES !== 'undefined') {
      Object.entries(EXERCISE_ALIASES).forEach(([alias, target]) => {
        if (target === canonical && !list.includes(alias)) list.push(alias);
      });
    }
    return list;
  },

  getEffectiveExerciseName(exId, ex) {
    if (this.session && this.session.swaps && this.session.swaps[exId]) {
      return this.session.swaps[exId].name;
    }
    if (ex && ex.name) return ex.name;
    const found = this.findExerciseById(exId);
    return found ? found.name : '';
  },

  getExerciseIncrement(ex, effectiveName) {
    const preference = this.exercisePreferences?.[effectiveName || ex?.name];
    if ([1, 2.5, 5, 10].includes(Number(preference?.increment))) return Number(preference.increment);
    if ((!effectiveName || effectiveName === ex?.name) && [1, 2.5, 5, 10].includes(Number(ex?.increment))) return Number(ex.increment);
    const rawName = (effectiveName || (ex ? ex.name : '') || '').toLowerCase();

    // 1. Isolation, dumbbell, bodyweight, or unilateral movement (+5 lbs)
    const isolationKeywords = [
      'dumbbell', 'db ', 'single-arm', 'single-leg', 'one-arm', 'lateral raise',
      'rear delt', 'face pull', 'pec deck', 'fly', 'crossover', 'leg extension',
      'leg curl', 'sissy squat', 'goblet squat', 'split squat', 'curl', 'tricep',
      'pushdown', 'skull crusher', 'extension', 'crunch', 'knee raise', 'sit-up',
      'pull-through', 'pullover', 'adduction', 'abduction'
    ];
    if (isolationKeywords.some(kw => rawName.includes(kw))) {
      return 5;
    }

    // 2. Bigger bilateral machine / barbell / cable compounds (+10 lbs)
    const compoundKeywords = [
      'hack squat', 'leg press', 'smith machine squat', 'hip thrust', 'glute drive',
      'barbell romanian', 'smith machine romanian', 'calf raise', 'calf press',
      'machine chest press', 'machine incline press', 'smith machine incline press',
      'smith machine chest press', 'machine overhead', 'machine shoulder press',
      'smith machine overhead', 'smith machine shoulder', 'lat pulldown',
      'machine row', 'seated cable row', 't-bar row'
    ];
    if (compoundKeywords.some(kw => rawName.includes(kw))) {
      return 10;
    }

    if (ex && typeof ex.increment === 'number') return ex.increment;
    return 5;
  },

  getMinTargetReps(targetRepsStr) {
    if (!targetRepsStr) return 8;
    const matches = String(targetRepsStr).match(/\d+/g);
    if (!matches || matches.length === 0) return 8;
    return Math.min(...matches.map(n => parseInt(n, 10)));
  },

  getMaxTargetReps(targetRepsStr) {
    if (!targetRepsStr) return 12;
    const matches = String(targetRepsStr).match(/\d+/g);
    if (!matches || matches.length === 0) return 12;
    return Math.max(...matches.map(n => parseInt(n, 10)));
  },

  getPrescribedSetCount(ex, name = this.getEffectiveExerciseName(ex.id, ex)) {
    const swap = this.session?.swaps?.[ex.id];
    if (swap?.name === name && Number.isInteger(swap.programSets) && swap.programSets > 0) return swap.programSets;
    const row = this.session?.logs?.[ex.id]?.find(set => set.exerciseName === name && Number.isInteger(set.programSets) && set.programSets > 0);
    return row?.programSets || ex.sets;
  },

  getDeloadRoundedWeight(weight, increment = 5) {
    const step = Math.min(Number(increment) || 5, 5);
    return Number(Math.max(0, Math.round((weight * 0.9) / step) * step).toFixed(2));
  },

  getSetTarget(ex, setIdx, effectiveName) {
    const activeSubName = effectiveName || this.getEffectiveExerciseName(ex.id, ex);
    const activeSwap = this.session?.swaps?.[ex.id];
    const effectiveTargetReps = (activeSwap?.name === activeSubName && activeSwap.targetReps) || ex.targetReps;
    const minTarget = this.getMinTargetReps(effectiveTargetReps);
    const maxTarget = this.getMaxTargetReps(effectiveTargetReps);
    const increment = this.getExerciseIncrement(ex, activeSubName);
    const prev = this.getPreviousExercisePerformance(activeSubName);

    // Loads from a different machine are not a baseline for this exercise.
    if (!prev && (activeSubName !== ex.name || ex.needsBaseline)) {
      return {
        targetWeight: null, targetReps: minTarget, targetRepsDisplay: effectiveTargetReps,
        targetWeightDisplay: 'Enter load', isProgressionIncrease: false, needsBaseline: true, note: 'Set an equipment baseline'
      };
    }

    if (!prev || !prev.sets || prev.sets.length === 0) {
      const parsedStart = this.parseInitialWeight(ex.startingWeight);
      const targetWeight = this.deloadActive ? this.getDeloadRoundedWeight(parsedStart, increment) : parsedStart;
      return {
        targetWeight,
        targetReps: minTarget,
        targetRepsDisplay: effectiveTargetReps,
        targetWeightDisplay: targetWeight > 0 ? `${targetWeight}` : '—',
        isProgressionIncrease: false,
        note: 'Baseline set'
      };
    }

    const validPrevSets = prev.sets.filter(s => s && s.completed !== false && (s.reps > 0 || s.weight > 0));
    if (validPrevSets.length === 0) {
      const parsedStart = this.parseInitialWeight(ex.startingWeight);
      const targetWeight = this.deloadActive ? this.getDeloadRoundedWeight(parsedStart, increment) : parsedStart;
      return {
        targetWeight,
        targetReps: minTarget,
        targetRepsDisplay: effectiveTargetReps,
        targetWeightDisplay: targetWeight > 0 ? `${targetWeight}` : '—',
        isProgressionIncrease: false,
        note: 'Baseline set'
      };
    }

    const targetSetsCount = this.getPrescribedSetCount(ex, activeSubName) || 3;
    const prevProgramSets = validPrevSets.find(s => Number.isInteger(s.programSets) && s.programSets > 0)?.programSets;
    const requiredPrevSets = prevProgramSets ? (this.deloadActive ? Math.max(2, Math.floor(prevProgramSets * 0.67)) : prevProgramSets) : targetSetsCount;
    const exactPrevSet = this.getPreviousSetAt(validPrevSets, setIdx);
    const fallbackWeightSet = validPrevSets[validPrevSets.length - 1] || validPrevSets[0] || {};
    const baseWeight = exactPrevSet ? (exactPrevSet.weight || 0) : (fallbackWeightSet.weight || 0);
    const topPrevWeight = Math.max(...validPrevSets.map(s => s.weight || 0));

    // Only unlock weight increase if ALL required sets were completed AND every set hit maxTarget at the working weight
    const allSetsHitMax = !this.deloadActive &&
      topPrevWeight > 0 &&
      validPrevSets.length >= requiredPrevSets &&
      validPrevSets.every(s => (s.reps || 0) >= maxTarget && (s.weight || 0) >= topPrevWeight);

    let targetWeight = baseWeight;
    let targetReps = minTarget;
    let isProgressionIncrease = false;

    if (allSetsHitMax) {
      targetWeight = topPrevWeight + increment;
      targetReps = minTarget;
      isProgressionIncrease = true;
    } else if (exactPrevSet) {
      const prevReps = exactPrevSet.reps || minTarget;
      targetReps = Math.min(maxTarget, prevReps >= maxTarget ? maxTarget : prevReps + 1);
    } else {
      targetReps = minTarget;
    }

    if (this.deloadActive) {
      targetWeight = this.getDeloadRoundedWeight(targetWeight, increment);
      isProgressionIncrease = false;
    }

    return {
      targetWeight,
      targetReps,
      targetRepsDisplay: effectiveTargetReps,
      targetWeightDisplay: targetWeight > 0 ? `${targetWeight}` : '—',
      isProgressionIncrease,
      note: isProgressionIncrease ? `+${increment} lbs unlocked!` : `Target: ${targetReps} reps`
    };
  },

  getPreviousSetAt(sets, setIdx) {
    if (!Array.isArray(sets)) return undefined;
    // Modern records keep the original position even when another set was skipped.
    // Unnumbered legacy records retain their original positional interpretation.
    return sets.some(set => Number.isInteger(set?.setNum) && set.setNum > 0)
      ? sets.find(set => set?.setNum === setIdx + 1)
      : sets[setIdx];
  },

  isSetPending(set) {
    return Boolean(set && !set.completed && !set.skipped);
  },

  getSetValidationError(set) {
    if (set.weight === null || set.weight === '' || !Number.isFinite(Number(set.weight)) || Number(set.weight) < 0 || set.needsBaseline)
      return 'Enter a valid load of 0 lb or more for this equipment.';
    if (set.reps === null || String(set.reps).trim() === '' || !Number.isInteger(Number(set.reps)) || Number(set.reps) <= 0)
      return 'Enter a positive whole number of reps before completing this set.';
    return '';
  },

  getWorkingSetCounts(session = this.session) {
    const fallbackDay = session?.oneTimeDay ||
      (typeof ONE_TIME_SUNDAY_UPPER_B_ARMS_COMBO !== 'undefined' && session?.dayId === ONE_TIME_SUNDAY_UPPER_B_ARMS_COMBO.id
        ? ONE_TIME_SUNDAY_UPPER_B_ARMS_COMBO : null);
    const day = this.routine?.find(item => item.id === session?.dayId) || fallbackDay;
    const retiredId = typeof RETIRED_MONDAY_ABDUCTION !== 'undefined' ? RETIRED_MONDAY_ABDUCTION.id : null;
    const removed = Boolean(retiredId && session?.dayId === 'mon__lower_b' && !day?.exercises.some(ex => ex.id === retiredId));
    const optionalIds = new Set((day?.exercises || []).filter(ex => ex.isOptional).map(ex => ex.id));
    const sets = Object.entries(session?.logs || {}).flatMap(([id, rows]) =>
      (removed && id === retiredId) || optionalIds.has(id) ? rows.filter(set => set.completed) : rows);
    const completed = sets.filter(set => set.completed).length;
    const skipped = sets.filter(set => !set.completed && set.skipped).length;
    return { total: sets.length, completed, skipped, remaining: sets.length - completed - skipped };
  },

  hasSessionProgress(session) {
    if (!session?.logs) return false;
    const day = this.routine?.find(day => day.id === session.dayId);
    const defaultOrder = day?.exercises.map(ex => ex.id);
    const orderChanged = Array.isArray(session.exerciseOrder) && defaultOrder &&
      JSON.stringify(session.exerciseOrder) !== JSON.stringify(defaultOrder);
    return Boolean(session.startTime || Object.values(session.logs).some(sets => sets.some(s => s.completed)) ||
      (!session.initialLogs && Object.values(session.logs).some(sets => sets.length)) ||
      (session.initialLogs && JSON.stringify(session.logs) !== JSON.stringify(session.initialLogs)) ||
      Object.values(session.warmups || {}).some(sets => Array.isArray(sets) && sets.length) || orderChanged ||
      Object.values(session.disabledSupersets || {}).some(Boolean) ||
      Object.keys(session.swaps || {}).length);
  },

  normalizeSessionFlow(session, day = this.routine.find(day => day.id === session.dayId)) {
    this.ensureMondayAbductionRows(session, day);
    const ids = day?.exercises.map(ex => ex.id) || [];
    const order = Array.isArray(session.exerciseOrder) ? session.exerciseOrder : [];
    session.exerciseOrder = [...new Set([...order.filter(id => ids.includes(id)), ...ids])];
    if (!session.warmups || typeof session.warmups !== 'object' || Array.isArray(session.warmups)) session.warmups = {};
    return session;
  },

  getScheduleDate(value) {
    if (value === null || value === undefined || value === '') return null;
    // A legacy date without a time denotes a local calendar date, not UTC midnight.
    const dateOnly = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const date = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 12) : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    if (dateOnly && (date.getFullYear() !== Number(dateOnly[1]) || date.getMonth() !== Number(dateOnly[2]) - 1 || date.getDate() !== Number(dateOnly[3]))) return null;
    return date;
  },

  getLocalDateKey(value = new Date()) {
    const date = this.getScheduleDate(value);
    if (!date) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },

  getLocalWeekKey(value = new Date()) {
    const date = this.getScheduleDate(value);
    if (!date) return null;
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return this.getLocalDateKey(date);
  },

  getScheduledWeekday(day) {
    const defaults = typeof DEFAULT_ROUTINE === 'undefined' ? [] : DEFAULT_ROUTINE;
    const title = defaults.find(original => original.id === day.id)?.title || day.title || '';
    const weekday = /^\s*(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)\b/i.exec(title)?.[1].slice(0, 3).toLowerCase();
    return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(weekday);
  },

  getHistoryDayId(record) {
    if (record?.dayId) return record.dayId;
    if (record?.sessionSnapshot?.dayId) return record.sessionSnapshot.dayId;
    const title = record?.dayTitle;
    if (typeof title !== 'string') return null;
    const day = this.routine.find(day => day.title === title);
    if (day) return day.id;
    const defaults = typeof DEFAULT_ROUTINE === 'undefined' ? [] : DEFAULT_ROUTINE;
    const original = defaults.find(day => day.title === title);
    return original && this.routine.some(day => day.id === original.id) ? original.id : null;
  },

  getSessionInteractionTime(session, now = new Date()) {
    if (!session) return 0;
    const today = this.getLocalDateKey(now);
    if (!today) return 0;
    const timestamps = Object.prototype.hasOwnProperty.call(session, 'lastInteractionAt') ? [session.lastInteractionAt] : [
      session.startTime,
      ...[session.logs, session.warmups].flatMap(collection => Object.values(collection || {}).flatMap(sets =>
        Array.isArray(sets) ? sets.filter(set => set?.completed).map(set => set.completedAt) : []))
    ];
    return Math.max(0, ...timestamps.map(value => {
      const date = this.getScheduleDate(value);
      return date && this.getLocalDateKey(date) === today ? date.getTime() : 0;
    }));
  },

  getResumeDayIndex(now = new Date()) {
    const lastDay = localStorage.getItem('gym_last_active_day_v1');
    const candidates = this.routine.map((day, index) => {
      try {
        const session = JSON.parse(localStorage.getItem(this.getSessionKey(day.id)) || localStorage.getItem(this.storageKeys.legacyCurrentSession) || 'null');
        if (session?.dayId !== day.id || !this.hasSessionProgress(session) ||
          (session.id && (this.history || []).some(record => (record.sessionId || record.sessionSnapshot?.id) === session.id))) return null;
        const activity = this.getSessionInteractionTime(session, now);
        return activity ? { index, dayId: day.id, activity } : null;
      } catch (_) { return null; }
    }).filter(Boolean);
    candidates.sort((a, b) => b.activity - a.activity || Number(b.dayId === lastDay) - Number(a.dayId === lastDay) || a.index - b.index);
    return candidates[0]?.index ?? this.getSuggestedDayIndex(now);
  },

  getSuggestedDayIndex(now = new Date()) {
    const schedule = this.routine.map((day, index) => ({ day, index, weekday: this.getScheduledWeekday(day) })).filter(item => item.weekday >= 0);
    const date = this.getScheduleDate(now);
    if (!schedule.length || !date) return 0;
    const history = this.history || [];
    const completed = new Map();
    history.forEach(record => {
      const id = this.getHistoryDayId(record), week = this.getLocalWeekKey(record?.date);
      if (!id || !week) return;
      if (!completed.has(week)) completed.set(week, new Set());
      completed.get(week).add(id);
      if (Array.isArray(record?.replacesDayIds)) {
        record.replacesDayIds.forEach(replacedId => { if (replacedId) completed.get(week).add(replacedId); });
      }
    });
    date.setHours(12, 0, 0, 0);
    // Each saved record can skip at most one scheduled occurrence. Calendar-day
    // arithmetic preserves local weekdays across daylight-saving changes.
    for (let offset = 0; offset < (history.length + 1) * 7; offset++) {
      const done = completed.get(this.getLocalWeekKey(date));
      const matches = schedule.filter(item => item.weekday === date.getDay() && !done?.has(item.day.id));
      const next = matches.find(item => item.day.oneTime) || matches[0];
      if (next) return next.index;
      date.setDate(date.getDate() + 1);
    }
    return 0;
  },

  getSessionResumeInfo() {
    const date = this.session?.startTime || this.session?.createdAt || this.session?.updatedAt;
    const parsed = date ? new Date(date) : null;
    return {
      date, inProgress: this.hasSessionProgress(this.session),
      savedDraftId: this.getSavedDrafts(this.session?.dayId)[0]?.recoveryId,
      stale: Boolean(parsed && !Number.isNaN(parsed.getTime()) && parsed.toDateString() !== new Date().toDateString())
    };
  },

  getPreviousProgressionFlag(exerciseName, targetRepsStr, requiredSetsCount = 3, ex = null) {
    if (this.deloadActive) return { unlocked: false };
    const prev = this.getPreviousExercisePerformance(exerciseName);
    if (!prev || !prev.sets || prev.sets.length === 0) return { unlocked: false };
    const maxTarget = this.getMaxTargetReps(targetRepsStr);
    const validSets = prev.sets.filter(s => s && s.completed !== false && (s.reps > 0 || s.weight > 0));
    const prevProgramSets = validSets.find(s => Number.isInteger(s.programSets) && s.programSets > 0)?.programSets;
    const targetSets = prevProgramSets || requiredSetsCount || 3;
    if (validSets.length < targetSets) return { unlocked: false };

    const topWeight = Math.max(...validSets.map(s => s.weight || 0));
    // Weight increase flag is ONLY unlocked if top-end target reps were hit for all sets at a positive working weight.
    const allSetsHit = topWeight > 0 && validSets.every(s => (s.reps || 0) >= maxTarget && (s.weight || 0) >= topWeight);

    if (allSetsHit) {
      const increment = this.getExerciseIncrement(ex, exerciseName);
      return {
        unlocked: true,
        allSetsHit: true,
        maxReps: maxTarget,
        setsCount: validSets.length,
        topWeight,
        increment
      };
    }
    return { unlocked: false };
  },

  getPreviousExercisePerformance(exerciseName) {
    const names = this.getEquivalentExerciseNames(exerciseName);
    let historyEntry = null;
    if (this.history && Array.isArray(this.history)) {
      for (let i = this.history.length - 1; i >= 0; i--) {
        const workout = this.history[i];
        if (workout.deload || workout.isDeload || workout.deloadActive) continue;
        for (const candidateName of names) {
          const entry = workout.exercises?.[candidateName];
          if (entry && Array.isArray(entry.sets)) {
            const validSets = entry.sets.filter(s => s && s.completed !== false && (s.reps > 0 || s.weight > 0));
            if (validSets.length > 0) {
              historyEntry = { date: workout.date, sets: validSets };
              break;
            }
          }
        }
        if (historyEntry) break;
      }
    }

    if (!historyEntry && this.lastWeights) {
      for (const candidateName of names) {
        const entry = this.lastWeights[candidateName];
        if (entry && !entry.deload && Array.isArray(entry.sets)) {
          const validSets = entry.sets.filter(s => s && s.completed !== false && (s.reps > 0 || s.weight > 0));
          if (validSets.length > 0) {
            return { date: entry.date, sets: validSets };
          }
        }
      }
    }

    return historyEntry;
  },

  getPersonalRecord(exerciseName) {
    let maxWeight = 0;
    let max1RM = 0;
    let bestReps = 0;
    const names = this.getEquivalentExerciseNames(exerciseName);

    const processSet = s => {
      if (!s || s.completed === false) return;
      const weight = parseFloat(s.weight) || 0;
      const reps = parseInt(s.reps, 10) || 0;
      if (weight > 0) {
        const est1RM = reps <= 1 ? Math.round(weight) : Math.round(weight * (1 + reps / 30));
        if (est1RM > max1RM) max1RM = est1RM;
        if (weight > maxWeight) {
          maxWeight = weight;
          bestReps = reps;
        } else if (weight === maxWeight && reps > bestReps) {
          bestReps = reps;
        }
      } else if (weight === 0 && reps > 0) {
        if (maxWeight === 0) {
          bestReps = Math.max(bestReps, reps);
        }
      }
    };

    if (this.history && Array.isArray(this.history)) {
      this.history.forEach(h => {
        names.forEach(candidateName => {
          if (h.exercises && h.exercises[candidateName] && Array.isArray(h.exercises[candidateName].sets)) {
            h.exercises[candidateName].sets.forEach(processSet);
          }
        });
      });
    }

    if (this.lastWeights) {
      names.forEach(candidateName => {
        if (this.lastWeights[candidateName] && Array.isArray(this.lastWeights[candidateName].sets)) {
          this.lastWeights[candidateName].sets.filter(Boolean).forEach(processSet);
        }
      });
    }

    return { maxWeight, max1RM, bestReps };
  },

  getAllUniqueExercises() {
    const list = [];
    const seen = new Set();
    if (this.routine) {
      this.routine.forEach(day => {
        day.exercises.forEach(ex => {
          if (!seen.has(ex.name)) {
            seen.add(ex.name);
            list.push({ name: ex.name, muscle: ex.muscle, dayTitle: day.title });
          }
        });
      });
    }
    return list;
  },

  getExerciseHistoryOverTime(exerciseName) {
    const results = [];
    const names = this.getEquivalentExerciseNames(exerciseName);
    this.history.forEach(h => {
      let combinedSets = [];
      for (const candidateName of names) {
        const entry = h.exercises?.[candidateName];
        if (entry) {
          const valid = (entry.sets || []).filter(s => s && s.completed !== false);
          if (valid.length > 0) combinedSets = combinedSets.concat(valid);
        }
      }
      if (combinedSets.length > 0) {
        const maxW = Math.max(...combinedSets.map(s => s.weight || 0));
        const totalVol = combinedSets.reduce((sum, s) => sum + ((s.weight || 0) * (s.reps || 0)), 0);
        results.push({
          date: h.date,
          dayTitle: h.dayTitle,
          deload: Boolean(h.deload || h.isDeload || h.deloadActive),
          sets: combinedSets,
          maxWeight: maxW,
          totalVolume: totalVol
        });
      }
    });

    if (this.lastWeights) {
      for (const candidateName of names) {
        const lw = this.lastWeights[candidateName];
        if (lw && lw.sets) {
          const validSets = lw.sets.filter(s => s && s.completed !== false);
          if (validSets.length > 0) {
            const lastDate = lw.date || new Date().toISOString();
            const alreadyInHistory = results.some(r => new Date(r.date).toDateString() === new Date(lastDate).toDateString());
            if (!alreadyInHistory) {
              const maxW = Math.max(...validSets.map(s => s.weight || 0));
              const totalVol = validSets.reduce((sum, s) => sum + ((s.weight || 0) * (s.reps || 0)), 0);
              results.push({
                date: lastDate,
                dayTitle: 'Recent Log',
                deload: Boolean(lw.deload),
                sets: validSets,
                maxWeight: maxW,
                totalVolume: totalVol
              });
            }
          }
        }
      }
    }

    return results.sort((a, b) => new Date(a.date) - new Date(b.date));
  },

  findExerciseById(exId) {
    if (!this.routine) return null;
    for (const day of this.routine) {
      const found = day.exercises.find(e => e.id === exId);
      if (found) return found;
    }
    return null;
  },

  parseInitialWeight(str) {
    if (!str) return 0;
    if (typeof str === 'string' && str.toLowerCase().includes('bodyweight')) return 0;
    const m = String(str).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  },

  parseRestSeconds(restStr) {
    if (typeof restStr === 'number') return Number.isFinite(restStr) && restStr > 0 ? restStr : 120;
    const lower = String(restStr || '').toLowerCase();
    const values = lower.match(/\d+(?:\.\d+)?/g)?.map(Number);
    if (!values?.length) return 120;
    return Math.round(Math.max(...values) * (/min|\d\s*m\b/.test(lower) ? 60 : 1));
  },

  formatRest(seconds) {
    return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} sec`;
  },

  isSupersetEnabled(ex) {
    return Boolean(ex?.superset && !this.session?.disabledSupersets?.[ex.superset.id]);
  },

  getRestSeconds(ex) {
    if (this.isSupersetEnabled(ex)) {
      return this.parseRestSeconds(ex.superset.restSeconds || ex.superset.rest);
    }
    return Math.max(120, this.parseRestSeconds(ex?.restSeconds || ex?.rest));
  },

  getOrderedExercises() {
    const exercises = this.routine?.[this.activeDayIndex]?.exercises || [];
    const byId = new Map(exercises.map(ex => [ex.id, ex]));
    const order = Array.isArray(this.session?.exerciseOrder) ? this.session.exerciseOrder : [];
    const seen = new Set();
    const ordered = [];
    [...order, ...exercises.map(ex => ex.id)].forEach(id => {
      if (!byId.has(id) || seen.has(id)) return;
      seen.add(id);
      ordered.push(byId.get(id));
    });
    // A saved order may predate a superset being enabled. Keep its members together.
    const grouped = new Set();
    return ordered.flatMap(ex => {
      if (grouped.has(ex.id)) return [];
      const members = this.isSupersetEnabled(ex)
        ? ordered.filter(candidate => this.isSupersetEnabled(candidate) && candidate.superset.id === ex.superset.id)
        : [ex];
      members.forEach(candidate => grouped.add(candidate.id));
      return members;
    });
  },

  getExerciseGroups() {
    const exercises = this.getOrderedExercises();
    const visited = new Set();
    return exercises.flatMap(ex => {
      if (visited.has(ex.id)) return [];
      const group = this.isSupersetEnabled(ex)
        ? exercises.filter(candidate => this.isSupersetEnabled(candidate) && candidate.superset.id === ex.superset.id)
        : [ex];
      group.forEach(candidate => visited.add(candidate.id));
      return [group];
    });
  },

  isExerciseGroupUnfinished(group) {
    return group.some(ex => (this.session?.logs?.[ex.id] || []).some(set => this.isSetPending(set)) ||
      (this.session?.warmups?.[ex.id] || []).some(set => this.isSetPending(set)));
  },

  getDeferTargetGroup(exId) {
    const groups = this.getExerciseGroups();
    const currentIndex = groups.findIndex(group => group.some(ex => ex.id === exId));
    if (currentIndex < 0 || !this.isExerciseGroupUnfinished(groups[currentIndex])) return null;
    for (let offset = 1; offset < groups.length; offset++) {
      const group = groups[(currentIndex + offset) % groups.length];
      if (this.isExerciseGroupUnfinished(group)) return group;
    }
    return null;
  },

  canDeferExercise(exId) {
    return Boolean(this.getDeferTargetGroup(exId));
  },

  getNextSet() {
    for (const group of this.getExerciseGroups()) {
      for (const candidate of group) {
        const warmup = this.getNextWarmup(candidate.id);
        if (warmup) return warmup;
      }
      const maxSets = Math.max(0, ...group.map(candidate => this.session?.logs?.[candidate.id]?.length || 0));
      for (let setIdx = 0; setIdx < maxSets; setIdx++) {
        for (const candidate of group) {
          const set = this.session?.logs?.[candidate.id]?.[setIdx];
          if (this.isSetPending(set)) return { ex: candidate, setIdx, type: 'working' };
        }
      }
    }
    return null;
  },

  getWorkoutTimeEstimate(coreExercises = []) {
    const coreIds = new Set(coreExercises.map(ex => ex.id));
    let plannedSeconds = 0;
    let remainingSeconds = 0;
    for (const group of this.getExerciseGroups()) {
      const coreGroup = group.filter(ex => coreIds.has(ex.id));
      if (!coreGroup.length) continue;
      if (coreGroup.length > 1 && this.isSupersetEnabled(coreGroup[0])) {
        const totalSets = coreGroup.reduce((sum, ex) => sum + (this.session?.logs?.[ex.id] || []).length, 0);
        const pendingSets = coreGroup.reduce((sum, ex) => sum + (this.session?.logs?.[ex.id] || []).filter(s => this.isSetPending(s)).length, 0);
        const avgRest = coreGroup.reduce((sum, ex) => sum + this.getRestSeconds(ex), 0) / coreGroup.length;
        plannedSeconds += totalSets * 35 + Math.max(0, totalSets - 1) * avgRest + 90;
        if (pendingSets > 0) remainingSeconds += pendingSets * 35 + Math.max(0, pendingSets - 1) * avgRest + 60;
      } else {
        for (const ex of coreGroup) {
          const rows = this.session?.logs?.[ex.id] || [];
          const count = rows.length;
          const pending = rows.filter(s => this.isSetPending(s)).length;
          const rest = this.getRestSeconds(ex);
          plannedSeconds += count * 45 + Math.max(0, count - 1) * rest + 90;
          if (pending > 0) remainingSeconds += pending * 45 + Math.max(0, pending - 1) * rest + 60;
        }
      }
    }
    return {
      plannedMinutes: Math.ceil(plannedSeconds / 60),
      remainingMinutes: remainingSeconds > 0 ? Math.ceil(remainingSeconds / 60) : 0
    };
  },

  getExerciseSnapshot(exercise) {
    const snapshot = {};
    for (const key of ['name', 'muscle', 'targetReps', 'notes', 'videoUrl', 'increment', 'startingWeight', 'needsBaseline', 'programSets']) {
      const value = exercise?.[key];
      if (key === 'needsBaseline' ? typeof value === 'boolean' : key === 'programSets' ? Number.isInteger(value) && value > 0 : key === 'increment' ? typeof value === 'number' && Number.isFinite(value) && value > 0 :
          typeof value === 'string' || (key === 'startingWeight' && typeof value === 'number' && Number.isFinite(value))) snapshot[key] = value;
    }
    return snapshot;
  },

  getOriginalExercise(exercise) {
    if (typeof exercise?.originalExercise?.name === 'string' && exercise.originalExercise.name.trim()) return this.getExerciseSnapshot(exercise.originalExercise);
    const canonical = typeof DEFAULT_ROUTINE !== 'undefined'
      ? DEFAULT_ROUTINE.flatMap(day => day.exercises).find(candidate => candidate.id === exercise?.id || (exercise?.sourceExerciseId && candidate.id === exercise.sourceExerciseId)) : null;
    return this.getExerciseSnapshot(canonical || exercise);
  },

  getSwapEquipmentType(name) {
    if (/dumbbell|\bdb\b/i.test(name)) return 'Dumbbell';
    if (/cable/i.test(name)) return 'Cable';
    if (/barbell/i.test(name)) return 'Barbell';
    if (/machine|smith|hack|leg press/i.test(name)) return 'Machine';
    return 'Equipment';
  },

  getSubstitutionsForExercise(exerciseName, exercise) {
    const original = this.getOriginalExercise(exercise);
    const canonical = typeof DEFAULT_ROUTINE !== 'undefined'
      ? DEFAULT_ROUTINE.flatMap(day => day.exercises).find(candidate => candidate.id === exercise?.id || (exercise?.sourceExerciseId && candidate.id === exercise.sourceExerciseId)) : null;
    const cleanName = (original.name || exerciseName).replace(/\s*\(alt for.*?\)/i, '').trim();
    let alternatives;
    if (typeof EXERCISE_SUBSTITUTIONS !== 'undefined') {
      const familyName = cleanName === 'Smith Machine Overhead Press' ? 'Machine Overhead Shoulder Press' : cleanName;
      alternatives = EXERCISE_SUBSTITUTIONS[familyName] ||
        EXERCISE_SUBSTITUTIONS[this.getCanonicalExerciseName(familyName)] ||
        EXERCISE_SUBSTITUTIONS[canonical?.name];
      if (!alternatives) {
        const key = Object.keys(EXERCISE_SUBSTITUTIONS).find(candidate =>
          cleanName.toLowerCase().includes(candidate.toLowerCase()) || candidate.toLowerCase().includes(cleanName.toLowerCase()));
        if (key) alternatives = EXERCISE_SUBSTITUTIONS[key];
      }
    }
    alternatives ||= [
      { name: `Dumbbell Alternative (${exercise ? exercise.muscle : 'Lift'})`, type: 'Dumbbell', muscle: exercise ? exercise.muscle : '', targetReps: '8–12', notes: 'Perform with controlled tempo and full range of motion.', videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(exerciseName + ' dumbbell alternative')}` },
      { name: `Cable Alternative (${exercise ? exercise.muscle : 'Lift'})`, type: 'Cable', muscle: exercise ? exercise.muscle : '', targetReps: '10–12', notes: 'Maintain steady cable tension throughout the movement.', videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(exerciseName + ' cable alternative')}` }
    ];
    const currentName = exercise ? this.getEffectiveExerciseName(exercise.id, exercise) : exerciseName;
    const seen = new Set([String(currentName).trim().toLowerCase()]);
    return [original, exercise && this.getExerciseSnapshot(exercise), ...(Array.isArray(exercise?.equipmentAlternatives) ? exercise.equipmentAlternatives : []), ...alternatives].filter(Boolean).filter(sub => {
      const key = String(sub.name || '').trim().toLowerCase();
      if (typeof sub.name !== 'string' || !key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(sub => {
      const alternative = { ...this.getExerciseSnapshot(sub), type: typeof sub.type === 'string' ? sub.type : this.getSwapEquipmentType(sub.name) };
      // Preserved draft prescriptions must not change the set count of a newly selected alternative.
      delete alternative.programSets;
      return alternative;
    });
  },

  getWarmupSets(exId) {
    const rows = this.session?.warmups?.[exId];
    return Array.isArray(rows) ? rows : [];
  },

  getWarmupNumber(set, index) {
    return Number.isInteger(set.setNum) && set.setNum > 0 ? set.setNum : index + 1;
  },

  getWarmupWorkingSet(exId) {
    const ex = this.findExerciseById(exId);
    if (!ex) return null;
    const name = this.getEffectiveExerciseName(exId, ex);
    const matches = (this.session?.logs?.[exId] || []).filter(set =>
      set.exerciseName === name || (!set.exerciseName && !this.session?.swaps?.[exId]));
    if (!matches.some(set => this.isSetPending(set))) return null;
    const positive = set => !set.needsBaseline && set.weight !== null && String(set.weight).trim() !== '' && Number.isFinite(Number(set.weight)) && Number(set.weight) > 0;
    return matches.find(set => this.isSetPending(set) && positive(set)) || matches.find(set => !set.skipped && positive(set)) || null;
  },

  hasWarmupRamp(exId) {
    const ex = this.findExerciseById(exId);
    if (!ex) return false;
    const name = this.getEffectiveExerciseName(exId, ex);
    return this.getWarmupSets(exId).some(set => set.exerciseName === name || (!set.exerciseName && !this.session?.swaps?.[exId]));
  },

  getNextWarmup(exId) {
    const setIdx = this.getWarmupSets(exId).findIndex(set => this.isSetPending(set));
    const ex = this.findExerciseById(exId);
    return ex && setIdx >= 0 ? { ex, setIdx, type: 'warmup' } : null;
  },

  mapMuscleToLandmark(muscleStr) {
    const labels = {
      chest: 'Chest', back: 'Back / Lats', lats: 'Back / Lats',
      quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes',
      adductors: 'Adductors', adductor: 'Adductors',
      calves: 'Calves', biceps: 'Biceps', triceps: 'Triceps',
      forearms: 'Forearms', abs: 'Abs / Core', core: 'Abs / Core',
      'front delts': 'Front Delts', 'side delts': 'Side Delts', 'rear delts': 'Rear Delts'
    };
    return labels[String(muscleStr || '').toLowerCase().trim()] || null;
  },

  getExerciseMuscleCredits(name, muscle) {
    // Only names from the exercise catalog (or explicitly tagged custom exercises) are mapped.
    const catalog = [
      ...(typeof DEFAULT_ROUTINE !== 'undefined' ? DEFAULT_ROUTINE : []).flatMap(d => d.exercises).flatMap(ex => [ex, ex.previousExercise, ...(ex.equipmentAlternatives || [])]).filter(Boolean),
      ...(typeof RETIRED_MONDAY_ABDUCTION !== 'undefined' ? [RETIRED_MONDAY_ABDUCTION, RETIRED_MONDAY_ABDUCTION.previousExercise].filter(Boolean) : []),
      ...(typeof MONDAY_HIP_ADDUCTION !== 'undefined' ? [MONDAY_HIP_ADDUCTION] : []),
      ...(typeof EXERCISE_SUBSTITUTIONS === 'object' ? Object.values(EXERCISE_SUBSTITUTIONS).flat() : []),
      ...(this.routine || []).flatMap(d => d.exercises)
    ];
    const canonicalName = this.getCanonicalExerciseName(name);
    const exercise = catalog.find(ex => ex.name === name || ex.name === canonicalName);
    if (!exercise && !muscle) return null;
    const n = name.toLowerCase();
    let direct = [...new Set(String(muscle || exercise?.muscle || '').split('/').map(tag => this.mapMuscleToLandmark(tag)).filter(Boolean))];
    const indirect = {};
    if (/calf/.test(n)) direct = ['Calves'];
    else if (/hip adduction|adductor/.test(n)) direct = ['Adductors'];
    else if (/lateral raise/.test(n)) direct = ['Side Delts'];
    else if (/rear delt|reverse pec|face pull/.test(n)) direct = ['Rear Delts'];
    else if (/shoulder press|overhead press/.test(n)) { direct = ['Front Delts']; indirect['Side Delts'] = 0.5; indirect.Triceps = 0.5; }
    else if (/hip thrust|glute drive/.test(n)) direct = ['Glutes'];
    else if (/leg curl/.test(n)) direct = ['Hamstrings'];
    else if (/leg press|hack squat|goblet squat|smith machine squat/.test(n)) { direct = ['Quads']; indirect.Glutes = 0.5; }
    else if (/romanian deadlift|back extension|pull-through/.test(n)) direct = /glute focus/i.test(name) ? ['Glutes'] : ['Hamstrings', 'Glutes'];
    else if (/press|push-up/.test(n) && direct.includes('Chest')) { indirect.Triceps = 0.5; indirect['Front Delts'] = 0.5; }
    else if (/row|pulldown|pull-up|chin-up/.test(n) && direct.includes('Back / Lats')) { indirect.Biceps = 0.5; indirect.Forearms = 0.5; if (/row/.test(n)) indirect['Rear Delts'] = 0.25; }
    if (/hammer|reverse curl/.test(n)) indirect.Forearms = 0.5;
    if (/reverse curl/.test(n)) indirect.Biceps = 0.5;
    direct.forEach(m => delete indirect[m]);
    return direct.length ? { direct, indirect } : null;
  },

  calculateWeeklyVolume(now = Date.now()) {
    const muscles = ['Chest', 'Back / Lats', 'Front Delts', 'Side Delts', 'Rear Delts', 'Biceps', 'Triceps', 'Forearms', 'Quads', 'Hamstrings', 'Glutes', 'Adductors', 'Calves', 'Abs / Core'];
    const makeTotals = () => Object.fromEntries(muscles.map(m => [m, { direct: 0, indirect: 0 }]));
    const result = { planned: makeTotals(), completed: makeTotals(), unmapped: new Set() };
    const add = (kind, name, muscle, count) => {
      const mapping = this.getExerciseMuscleCredits(name, muscle);
      if (!mapping) { result.unmapped.add(name); return; }
      mapping.direct.forEach(m => { if (result[kind][m]) result[kind][m].direct += count; });
      Object.entries(mapping.indirect).forEach(([m, credit]) => { if (result[kind][m]) result[kind][m].indirect += count * credit; });
    };
    (this.routine || []).filter(day => !day.oneTime).forEach(day => day.exercises.forEach(ex => add('planned', ex.name, ex.muscle, this.deloadActive ? Math.max(2, Math.floor(ex.sets * 0.67)) : ex.sets)));
    const cutoff = now - 7 * 86400000;
    const recent = date => { const value = new Date(date).getTime(); return value >= cutoff && value <= now; };
    const savedSessionIds = new Set((this.history || []).map(h => h.sessionId).filter(Boolean));
    (this.history || []).filter(h => recent(h.date)).forEach(h => {
      Object.entries(h.exercises || {}).forEach(([name, entry]) => (entry.sets || []).filter(set => set.completed !== false && set.type !== 'warmup' && (!set.completedAt || recent(set.completedAt))).forEach(set => add('completed', set.exerciseName || name, set.muscle, 1)));
    });
    this.getStoredSessions().filter(session => !savedSessionIds.has(session.id)).forEach(session => {
      const day = (this.routine || []).find(d => d.id === session.dayId)
        || session.oneTimeDay
        || (this.history || []).find(h => h.dayId === session.dayId && h.oneTimeDay)?.oneTimeDay
        || (typeof ONE_TIME_SUNDAY_UPPER_B_ARMS_COMBO !== 'undefined' && session.dayId === ONE_TIME_SUNDAY_UPPER_B_ARMS_COMBO.id ? ONE_TIME_SUNDAY_UPPER_B_ARMS_COMBO : null);
      Object.entries(session.logs).forEach(([id, sets]) => (Array.isArray(sets) ? sets : []).filter(set => set.completed && set.type !== 'warmup' && recent(set.completedAt || session.startTime || session.updatedAt)).forEach(set => {
        const ex = day?.exercises.find(e => e.id === id);
        const swap = session.swaps?.[id];
        const name = set.exerciseName || swap?.name || ex?.name || id;
        const muscle = set.muscle || (name === swap?.name ? swap.muscle : name === ex?.name ? ex.muscle : undefined);
        add('completed', name, muscle, 1);
      }));
    });
    return { ...result, unmapped: [...result.unmapped] };
  }
});
