// State Management & Controller for 4-Day Machine Routine Tracker

class WorkoutApp {
  constructor() {
    this.storageKeys = {
      routine: 'gym_routine_v4',
      history: 'gym_history_v1',
      machineSettings: 'gym_machine_settings_v1',
      streamlineMode: 'gym_streamline_mode_v1',
      currentSession: 'gym_current_session_v4'
    };

    // Load Routine
    this.routine = this.loadRoutine();
    this.history = this.loadHistory();
    this.machineSettings = this.loadMachineSettings();
    this.streamlineMode = localStorage.getItem(this.storageKeys.streamlineMode) !== 'false'; // Default to true

    // Active Day: determine suggested day based on current weekday
    this.activeDayIndex = this.getSuggestedDayIndex();

    // Timer State
    this.timer = {
      totalDuration: 90,
      remaining: 0,
      intervalId: null,
      active: false
    };

    // Active session logs in memory
    this.session = this.loadSession();

    // Init UI
    this.initElements();
    this.bindEvents();
    this.render();
  }

  loadRoutine() {
    const CURRENT_ROUTINE_REV = 4;
    const savedRev = localStorage.getItem('gym_routine_rev');
    const saved = localStorage.getItem(this.storageKeys.routine);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Correct any legacy muscle tags for calves
        parsed.forEach(day => {
          day.exercises.forEach(ex => {
            if (ex.name.toLowerCase().includes('calf') && ex.muscle === 'Quads') {
              ex.muscle = 'Calves';
            }
          });
        });

        // Migrate Monday Lower B to the updated routine (Hip Thrust & 45 Back Extension)
        const monDay = parsed.find(d => d.id === 'mon__lower_b');
        const needsMondayUpdate = monDay && (
          monDay.exercises.some(e => e.id === 'mon__lower_b_ex1') ||
          monDay.exercises.some(e => e.name.includes('Romanian Deadlift')) ||
          monDay.exercises.some(e => e.name.includes('Adduction')) ||
          savedRev !== String(CURRENT_ROUTINE_REV)
        );

        if (needsMondayUpdate) {
          const newMonDay = DEFAULT_ROUTINE.find(d => d.id === 'mon__lower_b');
          if (newMonDay) {
            const monIdx = parsed.findIndex(d => d.id === 'mon__lower_b');
            if (monIdx !== -1) {
              parsed[monIdx] = JSON.parse(JSON.stringify(newMonDay));
            }
          }
          localStorage.setItem('gym_routine_rev', String(CURRENT_ROUTINE_REV));
          localStorage.setItem(this.storageKeys.routine, JSON.stringify(parsed));
        }

        return parsed;
      } catch (e) { console.error(e); }
    }
    localStorage.setItem('gym_routine_rev', String(CURRENT_ROUTINE_REV));
    return DEFAULT_ROUTINE;
  }

  saveRoutine() {
    localStorage.setItem(this.storageKeys.routine, JSON.stringify(this.routine));
  }

  loadHistory() {
    const saved = localStorage.getItem(this.storageKeys.history);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { console.error(e); }
    }
    return [];
  }

  saveHistory() {
    localStorage.setItem(this.storageKeys.history, JSON.stringify(this.history));
  }

  loadMachineSettings() {
    const saved = localStorage.getItem(this.storageKeys.machineSettings);
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { console.error(e); }
    }
    return {};
  }

  saveMachineSettings() {
    localStorage.setItem(this.storageKeys.machineSettings, JSON.stringify(this.machineSettings));
  }

  loadSession() {
    const saved = localStorage.getItem(this.storageKeys.currentSession);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.dayId === this.routine[this.activeDayIndex]?.id) {
          // Ensure any newly added exercises have initialized log entries
          const day = this.routine[this.activeDayIndex];
          if (day && day.exercises) {
            day.exercises.forEach(ex => {
              if (!parsed.logs[ex.id] || parsed.logs[ex.id].length === 0) {
                const prevData = this.getPreviousExercisePerformance(ex.name);
                parsed.logs[ex.id] = [];
                for (let i = 1; i <= ex.sets; i++) {
                  const prevSet = prevData && prevData.sets && prevData.sets[i - 1];
                  parsed.logs[ex.id].push({
                    setNum: i,
                    weight: prevSet ? prevSet.weight : this.parseInitialWeight(ex.startingWeight),
                    reps: prevSet ? prevSet.reps : this.parseInitialReps(ex.targetReps),
                    completed: false
                  });
                }
              }
            });
          }
          return parsed;
        }
      } catch (e) { console.error(e); }
    }
    return this.initNewSession(this.activeDayIndex);
  }

  initNewSession(dayIndex) {
    const day = this.routine[dayIndex] || this.routine[0];
    const session = {
      dayId: day.id,
      dayTitle: day.title,
      startTime: new Date().toISOString(),
      logs: {}
    };

    day.exercises.forEach(ex => {
      const prevData = this.getPreviousExercisePerformance(ex.name);
      session.logs[ex.id] = [];
      for (let i = 1; i <= ex.sets; i++) {
        const prevSet = prevData && prevData.sets && prevData.sets[i - 1];
        session.logs[ex.id].push({
          setNum: i,
          weight: prevSet ? prevSet.weight : this.parseInitialWeight(ex.startingWeight),
          reps: prevSet ? prevSet.reps : this.parseInitialReps(ex.targetReps),
          completed: false
        });
      }
    });

    return session;
  }

  saveCurrentSession() {
    localStorage.setItem(this.storageKeys.currentSession, JSON.stringify(this.session));
  }

  parseInitialWeight(str) {
    if (!str) return '';
    const m = str.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : '';
  }

  parseInitialReps(str) {
    if (!str) return 10;
    const m = str.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 10;
  }

  parseRestSeconds(restStr) {
    if (!restStr) return 90;
    const lower = restStr.toLowerCase();
    if (lower.includes('2.5') || lower.includes('2-3 min') || lower.includes('2–3 min')) return 150;
    if (lower.includes('2 min')) return 120;
    if (lower.includes('90 sec') || lower.includes('90s')) return 90;
    if (lower.includes('60 sec') || lower.includes('60s')) return 60;
    return 90;
  }

  getSuggestedDayIndex() {
    // Current day of week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    const day = new Date().getDay();
    if (day === 3) return 0; // Wednesday -> Upper A
    if (day === 5) return 1; // Friday -> Lower A
    if (day === 6) return 2; // Saturday -> Upper B
    if (day === 1) return 3; // Monday -> Lower B
    // Off days: suggest the upcoming workout
    if (day === 2) return 0; // Tuesday -> Wed Upper A
    if (day === 4) return 1; // Thursday -> Fri Lower A
    return 3; // Sunday -> Mon Lower B
  }

  getPreviousExercisePerformance(exerciseName) {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const workout = this.history[i];
      if (workout.exercises && workout.exercises[exerciseName]) {
        return workout.exercises[exerciseName];
      }
    }
    return null;
  }

  getPersonalRecord(exerciseName) {
    let maxWeight = 0;
    let max1RM = 0;
    let bestReps = 0;

    this.history.forEach(h => {
      if (h.exercises && h.exercises[exerciseName]) {
        h.exercises[exerciseName].sets.forEach(s => {
          if (s.completed && s.weight > 0 && s.reps > 0) {
            if (s.weight > maxWeight) maxWeight = s.weight;
            // Epley 1RM formula
            const est1RM = Math.round(s.weight * (1 + s.reps / 30));
            if (est1RM > max1RM) max1RM = est1RM;
            if (s.reps > bestReps) bestReps = s.reps;
          }
        });
      }
    });

    return { maxWeight, max1RM, bestReps };
  }

  initElements() {
    this.daySelectorEl = document.getElementById('daySelector');
    this.sessionInfoEl = document.getElementById('sessionInfo');
    this.exerciseListEl = document.getElementById('exerciseList');
    this.timerDockEl = document.getElementById('timerDock');
    this.timerDisplayEl = document.getElementById('timerDisplay');
    this.timerProgressBarEl = document.getElementById('timerProgressBar');
    this.timerSoundToggleEl = document.getElementById('timerSoundToggle');

    // Modals
    this.summaryModalEl = document.getElementById('summaryModal');
    this.summaryContentEl = document.getElementById('summaryContent');
    this.analyticsModalEl = document.getElementById('analyticsModal');
    this.analyticsContentEl = document.getElementById('analyticsContent');
    this.routineModalEl = document.getElementById('routineModal');
    this.routineEditorEl = document.getElementById('routineEditor');

    // Time saver toggle
    this.streamlineToggleBtn = document.getElementById('streamlineToggleBtn');
  }

  bindEvents() {
    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const view = btn.dataset.view;
        this.switchMainView(view);
      });
    });

    // Streamline toggle
    if (this.streamlineToggleBtn) {
      this.streamlineToggleBtn.addEventListener('click', () => {
        this.streamlineMode = !this.streamlineMode;
        localStorage.setItem(this.storageKeys.streamlineMode, this.streamlineMode);
        this.updateStreamlineButton();
        this.renderWorkout();
      });
    }

    // Finish Workout button
    const finishBtn = document.getElementById('finishWorkoutBtn');
    if (finishBtn) {
      finishBtn.addEventListener('click', () => this.showWorkoutSummary());
    }

    // Timer controls
    document.getElementById('timerSkipBtn')?.addEventListener('click', () => this.stopTimer());
    document.getElementById('timerPlus30Btn')?.addEventListener('click', () => this.adjustTimer(30));
    document.getElementById('timerMinus15Btn')?.addEventListener('click', () => this.adjustTimer(-15));

    // Modal closes
    document.querySelectorAll('.close-modal-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = btn.closest('.modal-backdrop');
        if (modal) modal.classList.remove('open');
      });
    });

    // Export & Reset buttons
    document.getElementById('exportDataBtn')?.addEventListener('click', () => this.exportData());
    document.getElementById('resetRoutineBtn')?.addEventListener('click', () => this.resetRoutine());
  }

  switchMainView(view) {
    const workoutView = document.getElementById('workoutView');
    const analyticsView = document.getElementById('analyticsView');
    const routineView = document.getElementById('routineView');

    if (view === 'workout') {
      workoutView.style.display = 'block';
      analyticsView.style.display = 'none';
      routineView.style.display = 'none';
      this.renderWorkout();
    } else if (view === 'analytics') {
      workoutView.style.display = 'none';
      analyticsView.style.display = 'block';
      routineView.style.display = 'none';
      this.renderAnalytics();
    } else if (view === 'routine') {
      workoutView.style.display = 'none';
      analyticsView.style.display = 'none';
      routineView.style.display = 'block';
      this.renderRoutineEditor();
    }
  }

  updateStreamlineButton() {
    if (!this.streamlineToggleBtn) return;
    if (this.streamlineMode) {
      this.streamlineToggleBtn.classList.add('active');
      this.streamlineToggleBtn.innerHTML = '⚡ Streamlined (ON)';
    } else {
      this.streamlineToggleBtn.classList.remove('active');
      this.streamlineToggleBtn.innerHTML = '⚡ Streamlined (OFF)';
    }
  }

  render() {
    this.renderDaySelector();
    this.updateStreamlineButton();
    this.renderWorkout();
  }

  renderDaySelector() {
    const todayIndex = this.getSuggestedDayIndex();
    this.daySelectorEl.innerHTML = this.routine.map((day, idx) => {
      const isActive = idx === this.activeDayIndex;
      const isToday = idx === todayIndex;
      
      let dayAbbr = 'DAY';
      let routineName = day.title;
      if (day.title.includes('Wed')) { dayAbbr = 'WED'; routineName = 'Upper A'; }
      else if (day.title.includes('Fri')) { dayAbbr = 'FRI'; routineName = 'Lower A'; }
      else if (day.title.includes('Sat')) { dayAbbr = 'SAT'; routineName = 'Upper B'; }
      else if (day.title.includes('Mon')) { dayAbbr = 'MON'; routineName = 'Lower B'; }

      const coreCount = day.exercises.filter(e => !e.isOptional).length;

      return `
        <button class="day-btn ${isActive ? 'active' : ''}" data-index="${idx}">
          <div class="day-btn-header">
            <span class="day-btn-day">${dayAbbr}</span>
            ${isToday ? '<span class="today-dot">● Today</span>' : `<span style="font-size: 0.65rem; color: var(--text-muted);">${coreCount} lifts</span>`}
          </div>
          <div class="day-btn-title">${routineName}</div>
        </button>
      `;
    }).join('');

    this.daySelectorEl.querySelectorAll('.day-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        this.activeDayIndex = idx;
        this.session = this.loadSession();
        this.renderDaySelector();
        this.renderWorkout();
      });
    });
  }

  renderWorkout() {
    const currentDay = this.routine[this.activeDayIndex];
    if (!currentDay) return;

    // Separate Core Lifts and Exclusively Optional Finishers
    const coreExercises = currentDay.exercises.filter(ex => !ex.isOptional);
    const optionalExercises = currentDay.exercises.filter(ex => ex.isOptional);

    const hasSuperset = coreExercises.some(ex => ex.superset);
    const totalCoreSets = coreExercises.reduce((sum, ex) => sum + ex.sets, 0);
    const estimatedMins = hasSuperset ? (coreExercises.length * 8) - 8 : (coreExercises.length * 8);

    // Clean Day Title for header
    let cleanDayTitle = currentDay.title;
    if (cleanDayTitle.includes('Mon-')) cleanDayTitle = 'Mon - Lower B';

    this.sessionInfoEl.innerHTML = `
      <h2>${cleanDayTitle}</h2>
      <div class="session-meta">
        <span>🏋️ ${coreExercises.length} Core Lifts</span>
        <span>•</span>
        <span>⚡ ${totalCoreSets} Sets</span>
        <span>•</span>
        <span>⏱️ ~${estimatedMins}m ${hasSuperset ? '<strong style="color: var(--accent-purple);">(⚡ Superset)</strong>' : ''}</span>
      </div>
    `;

    // Render Core Cards
    const coreHTML = coreExercises.map(ex => this.renderExerciseCard(ex, false)).join('');

    // Render Dedicated Optional Drawer
    const optionalHTML = optionalExercises.length > 0 ? `
      <div class="optional-section-wrap">
        <div class="optional-section-header" id="optionalToggleHeader">
          <div class="optional-header-left">
            <span class="optional-badge-pill">⚡ 100% EXCLUSIVELY OPTIONAL</span>
            <div class="optional-section-title">${optionalExercises.length} Bonus Finisher${optionalExercises.length > 1 ? 's' : ''}</div>
            <div class="optional-section-subtitle">Only do this if you have 10+ mins left on your 60m timer!</div>
          </div>
          <span class="optional-toggle-pill" id="optionalTogglePill">View Finisher (+5m) ▾</span>
        </div>
        <div class="optional-cards-list" id="optionalCardsList">
          ${optionalExercises.map(ex => this.renderExerciseCard(ex, true)).join('')}
        </div>
      </div>
    ` : '';

    this.exerciseListEl.innerHTML = coreHTML + optionalHTML;
    this.bindWorkoutCardEvents();
  }

  renderExerciseCard(ex, isBonus) {
    const sessionSets = this.session.logs[ex.id] || [];
    const prev = this.getPreviousExercisePerformance(ex.name);
    const pr = this.getPersonalRecord(ex.name);
    const machineSetting = this.machineSettings[ex.id] || '';
    const isAllDone = sessionSets.length > 0 && sessionSets.every(s => s.completed);

    const cleanTag = ex.muscle.replace(/[^a-zA-Z]/g, '');
    const effectiveRest = ex.superset ? ex.superset.rest : (ex.rest || '90 sec');

    return `
      <div class="exercise-card ${isAllDone ? 'completed' : ''} ${isBonus ? 'is-optional' : ''} ${ex.superset ? 'is-superset' : ''}" id="card_${ex.id}">
        
        ${ex.superset && ex.superset.tag.endsWith('A') ? `
          <div class="superset-guide-banner">
            <span style="font-size: 1.1rem;">⚡</span>
            <div>
              <strong>${ex.superset.name}</strong><br>
              <span>${ex.superset.tip}</span>
            </div>
          </div>
        ` : ''}

        <div class="card-header">
          <div class="card-title-group">
            <div>
              <span class="muscle-tag tag-${cleanTag}">${ex.muscle}</span>
              ${ex.superset ? `<span class="superset-badge">⚡ SUPERSET ${ex.superset.tag}</span>` : ''}
              ${isBonus ? '<span class="optional-badge">⚡ Optional Bonus</span>' : ''}
            </div>
            <h3 class="exercise-name">${ex.name}</h3>
          </div>
          <div class="card-actions">
            ${ex.videoUrl ? `
              <a href="${ex.videoUrl}" target="_blank" rel="noopener noreferrer" class="video-link-btn" title="Watch form guide">
                ▶ Form
              </a>
            ` : ''}
          </div>
        </div>

        <div class="exercise-meta-box">
          <div class="target-targets">
            <div class="target-item"><strong>Target:</strong> ${ex.sets} sets × ${ex.targetReps} reps</div>
            <div class="target-item"><strong>Rest:</strong> <span style="${ex.superset ? 'color: #d8b4fe; font-weight: 700;' : ''}">${effectiveRest}</span></div>
            <div class="target-item"><strong>Start Weight:</strong> ${ex.startingWeight || 'Moderate'}</div>
            ${pr.maxWeight > 0 ? `<div class="target-item"><strong>PR:</strong> ${pr.maxWeight} lbs</div>` : ''}
          </div>
          ${ex.notes ? `<div class="form-notes"><strong>Setup & Form:</strong> ${ex.notes}</div>` : ''}
          
          <div class="machine-settings-row">
            <span class="machine-settings-label">⚙️ Pin / Seat:</span>
            <input type="text" class="machine-settings-input" 
                   placeholder="e.g. Seat #4, Pin #8" 
                   value="${machineSetting}" 
                   data-exid="${ex.id}" />
          </div>
        </div>

        <div class="sets-table-wrap">
          <table class="sets-table">
            <thead>
              <tr>
                <th>Set</th>
                <th>Prev</th>
                <th>Target</th>
                <th>Lbs</th>
                <th>Reps</th>
                <th>Done</th>
              </tr>
            </thead>
            <tbody>
              ${sessionSets.map((s, sIdx) => {
                const prevSet = prev && prev.sets && prev.sets[sIdx];
                const prevText = prevSet && prevSet.completed ? `${prevSet.weight}×${prevSet.reps}` : '—';
                return `
                  <tr class="set-row ${s.completed ? 'completed' : ''}" data-exid="${ex.id}" data-setidx="${sIdx}">
                    <td class="set-index-cell">${s.setNum}</td>
                    <td class="prev-cell">${prevText}</td>
                    <td style="font-size: 0.78rem; color: var(--text-muted);">${ex.targetReps}</td>
                    <td>
                      <input type="number" class="set-input set-weight-input" 
                             value="${s.weight}" 
                             data-exid="${ex.id}" data-setidx="${sIdx}" 
                             step="5" min="0" placeholder="0" 
                             inputmode="decimal" pattern="[0-9]*"
                             aria-label="Set ${s.setNum} weight in lbs" />
                    </td>
                    <td>
                      <input type="number" class="set-input set-reps-input" 
                             value="${s.reps}" 
                             data-exid="${ex.id}" data-setidx="${sIdx}" 
                             step="1" min="0" placeholder="0" 
                             inputmode="numeric" pattern="[0-9]*"
                             aria-label="Set ${s.setNum} reps" />
                    </td>
                    <td>
                      <button class="set-check-btn" data-exid="${ex.id}" data-setidx="${sIdx}" data-rest="${effectiveRest}" aria-label="Mark set ${s.setNum} ${s.completed ? 'incomplete' : 'complete'}">
                        ${s.completed ? '✓' : '○'}
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>

        <div class="card-footer">
          <button class="add-set-btn" data-exid="${ex.id}">
            <span>+</span> Add Set
          </button>
          <div class="card-footer-right">
            ${sessionSets.length > 1 ? `
              <button class="icon-btn remove-set-btn" data-exid="${ex.id}" title="Remove last set">
                − Remove Set
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  bindWorkoutCardEvents() {
    // Optional finisher drawer toggle
    const optHeader = document.getElementById('optionalToggleHeader');
    const optList = document.getElementById('optionalCardsList');
    const optPill = document.getElementById('optionalTogglePill');
    if (optHeader && optList) {
      optHeader.addEventListener('click', () => {
        const isOpen = optList.classList.toggle('open');
        if (optPill) {
          optPill.textContent = isOpen ? 'Hide Finisher ▴' : 'View Finisher (+5m) ▾';
        }
      });
    }

    // Check buttons
    this.exerciseListEl.querySelectorAll('.set-check-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const exId = btn.dataset.exid;
        const setIdx = parseInt(btn.dataset.setidx, 10);
        const rest = btn.dataset.rest;
        this.toggleSetCompletion(exId, setIdx, rest);
      });
    });

    // Weight and Rep input changes
    this.exerciseListEl.querySelectorAll('.set-weight-input').forEach(input => {
      input.addEventListener('change', () => {
        const exId = input.dataset.exid;
        const setIdx = parseInt(input.dataset.setidx, 10);
        const val = parseFloat(input.value) || 0;
        if (this.session.logs[exId] && this.session.logs[exId][setIdx]) {
          this.session.logs[exId][setIdx].weight = val;
          this.saveCurrentSession();
        }
      });
    });

    this.exerciseListEl.querySelectorAll('.set-reps-input').forEach(input => {
      input.addEventListener('change', () => {
        const exId = input.dataset.exid;
        const setIdx = parseInt(input.dataset.setidx, 10);
        const val = parseInt(input.value, 10) || 0;
        if (this.session.logs[exId] && this.session.logs[exId][setIdx]) {
          this.session.logs[exId][setIdx].reps = val;
          this.saveCurrentSession();
        }
      });
    });

    // Machine Settings input changes
    this.exerciseListEl.querySelectorAll('.machine-settings-input').forEach(input => {
      input.addEventListener('change', () => {
        const exId = input.dataset.exid;
        this.machineSettings[exId] = input.value;
        this.saveMachineSettings();
      });
    });

    // Add / Remove Set buttons
    this.exerciseListEl.querySelectorAll('.add-set-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const exId = btn.dataset.exid;
        this.addSetToExercise(exId);
      });
    });

    this.exerciseListEl.querySelectorAll('.remove-set-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const exId = btn.dataset.exid;
        this.removeLastSetFromExercise(exId);
      });
    });
  }

  toggleSetCompletion(exId, setIdx, restStr) {
    const setObj = this.session.logs[exId] && this.session.logs[exId][setIdx];
    if (!setObj) return;

    setObj.completed = !setObj.completed;
    this.saveCurrentSession();

    // Trigger Rest Timer if marking as completed
    if (setObj.completed) {
      const restSeconds = this.parseRestSeconds(restStr);
      this.startTimer(restSeconds);
    }

    this.renderWorkout();
  }

  addSetToExercise(exId) {
    const list = this.session.logs[exId];
    if (!list) return;
    const lastSet = list[list.length - 1];
    list.push({
      setNum: list.length + 1,
      weight: lastSet ? lastSet.weight : 50,
      reps: lastSet ? lastSet.reps : 10,
      completed: false
    });
    this.saveCurrentSession();
    this.renderWorkout();
  }

  removeLastSetFromExercise(exId) {
    const list = this.session.logs[exId];
    if (list && list.length > 1) {
      list.pop();
      this.saveCurrentSession();
      this.renderWorkout();
    }
  }

  // Rest Timer Controller
  startTimer(seconds) {
    this.stopTimer();
    this.timer.totalDuration = seconds;
    this.timer.remaining = seconds;
    this.timer.active = true;

    this.updateTimerUI();
    this.timerDockEl.classList.add('active');
    document.body.classList.add('timer-active');

    this.timer.intervalId = setInterval(() => {
      this.timer.remaining--;
      this.updateTimerUI();

      if (this.timer.remaining <= 0) {
        this.stopTimer();
        this.playTimerAlarm();
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timer.intervalId) {
      clearInterval(this.timer.intervalId);
      this.timer.intervalId = null;
    }
    this.timer.active = false;
    this.timerDockEl.classList.remove('active');
    document.body.classList.remove('timer-active');
  }

  adjustTimer(delta) {
    if (!this.timer.active) return;
    this.timer.remaining = Math.max(5, this.timer.remaining + delta);
    this.timer.totalDuration = Math.max(this.timer.totalDuration, this.timer.remaining);
    this.updateTimerUI();
  }

  updateTimerUI() {
    const mins = Math.floor(this.timer.remaining / 60);
    const secs = this.timer.remaining % 60;
    this.timerDisplayEl.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

    const pct = ((this.timer.totalDuration - this.timer.remaining) / this.timer.totalDuration) * 100;
    this.timerProgressBarEl.style.width = `${Math.min(100, pct)}%`;
  }

  playTimerAlarm() {
    // Vibration if available on mobile
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200, 100, 300]);
    }

    // Pleasant Web Audio Chime
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      const playTone = (freq, start, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
        gain.gain.setValueAtTime(0.3, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + duration);
      };

      playTone(587.33, 0, 0.2); // D5
      playTone(880, 0.2, 0.4);   // A5
    } catch (e) {
      console.warn('AudioContext not allowed without user interaction:', e);
    }
  }

  // Workout Completion & Summary
  showWorkoutSummary() {
    const currentDay = this.routine[this.activeDayIndex];
    let totalVolume = 0;
    let totalCompletedSets = 0;
    const newPRs = [];

    const recordedExercises = {};

    currentDay.exercises.forEach(ex => {
      const sets = this.session.logs[ex.id] || [];
      const completedSets = sets.filter(s => s.completed);
      totalCompletedSets += completedSets.length;

      completedSets.forEach(s => {
        const vol = (s.weight || 0) * (s.reps || 0);
        totalVolume += vol;

        // Check PR
        const pr = this.getPersonalRecord(ex.name);
        if (s.weight > pr.maxWeight && pr.maxWeight > 0) {
          newPRs.push(`${ex.name}: New Weight Record (${s.weight} lbs)`);
        }
      });

      if (completedSets.length > 0) {
        recordedExercises[ex.name] = {
          sets: sets.map(s => ({
            setNum: s.setNum,
            weight: s.weight,
            reps: s.reps,
            completed: s.completed
          }))
        };
      }
    });

    const durationMins = Math.max(15, Math.round((new Date() - new Date(this.session.startTime)) / 60000));

    // Save to history
    const workoutRecord = {
      id: 'w_' + Date.now(),
      date: new Date().toISOString(),
      dayTitle: currentDay.title,
      totalVolume,
      totalCompletedSets,
      durationMins,
      exercises: recordedExercises
    };

    this.history.push(workoutRecord);
    this.saveHistory();

    // Reset current session
    this.session = this.initNewSession(this.activeDayIndex);
    this.saveCurrentSession();

    // Render Modal
    this.summaryContentEl.innerHTML = `
      <div style="text-align: center; margin-bottom: 20px;">
        <div style="font-size: 50px;">🏆</div>
        <h2 style="font-size: 1.5rem; font-weight: 800; color: var(--accent-emerald);">Workout Complete!</h2>
        <p style="color: var(--text-secondary);">${currentDay.title}</p>
      </div>

      <div class="stats-grid" style="margin-bottom: 20px;">
        <div class="stat-box">
          <div class="stat-val">${totalVolume.toLocaleString()}</div>
          <div class="stat-label">Total Volume (lbs)</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${totalCompletedSets}</div>
          <div class="stat-label">Sets Finished</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${durationMins}m</div>
          <div class="stat-label">Duration</div>
        </div>
      </div>

      ${newPRs.length > 0 ? `
        <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid var(--accent-emerald); border-radius: var(--radius-md); padding: 12px; margin-bottom: 20px;">
          <h4 style="color: var(--accent-emerald); font-weight: 700; margin-bottom: 6px;">🎉 New Records Hit!</h4>
          <ul style="padding-left: 20px; font-size: 0.85rem; color: #e2e8f0;">
            ${newPRs.map(pr => `<li>${pr}</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <button class="primary-btn" id="finishSummaryBtn">Done & View Progress</button>
    `;

    this.summaryModalEl.classList.add('open');

    document.getElementById('finishSummaryBtn')?.addEventListener('click', () => {
      this.summaryModalEl.classList.remove('open');
      document.querySelector('[data-view="analytics"]').click();
    });

    this.renderWorkout();
  }

  // Analytics & History View
  renderAnalytics() {
    const totalWorkouts = this.history.length;
    const totalVolumeAllTime = this.history.reduce((sum, h) => sum + (h.totalVolume || 0), 0);

    // Group workouts for volume chart (last 7 workouts)
    const recentWorkouts = this.history.slice(-7);
    const maxVol = Math.max(...recentWorkouts.map(w => w.totalVolume || 0), 1000);

    const historyHTML = this.history.slice().reverse().map(h => {
      const d = new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const exNames = Object.keys(h.exercises || {}).join(', ');

      return `
        <div class="history-item">
          <div class="history-item-header">
            <span class="history-item-title">${h.dayTitle}</span>
            <span class="history-item-date">${d}</span>
          </div>
          <div class="history-pills">
            <span class="history-pill">🏋️ ${(h.totalVolume || 0).toLocaleString()} lbs</span>
            <span class="history-pill">⚡ ${h.totalCompletedSets || 0} sets</span>
            <span class="history-pill">⏱️ ${h.durationMins || 45} mins</span>
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 8px;">
            ${exNames || 'No details'}
          </div>
        </div>
      `;
    }).join('');

    this.analyticsContentEl.innerHTML = `
      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-val">${totalWorkouts}</div>
          <div class="stat-label">Workouts Logged</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">${(totalVolumeAllTime / 1000).toFixed(1)}k</div>
          <div class="stat-label">Total Volume (lbs)</div>
        </div>
        <div class="stat-box">
          <div class="stat-val">4-Day</div>
          <div class="stat-label">Machine Split</div>
        </div>
      </div>

      ${recentWorkouts.length > 0 ? `
        <div class="volume-chart-container">
          <div class="chart-header">
            <div class="chart-title">Volume Progression (lbs per session)</div>
          </div>
          <div class="chart-bars">
            ${recentWorkouts.map((w, idx) => {
              const heightPct = Math.round(((w.totalVolume || 0) / maxVol) * 100);
              const isLast = idx === recentWorkouts.length - 1;
              const d = new Date(w.date).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
              return `
                <div class="chart-bar-wrap">
                  <div class="chart-bar ${isLast ? 'current' : ''}" style="height: ${Math.max(12, heightPct)}%;">
                    <span class="chart-bar-val">${Math.round(w.totalVolume / 1000)}k</span>
                  </div>
                  <span class="chart-bar-label">${d}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      ` : ''}

      <div style="margin-top: 24px;">
        <h3 style="font-size: 1.1rem; font-weight: 700; margin-bottom: 12px;">Workout History</h3>
        ${this.history.length > 0 ? historyHTML : `
          <div class="empty-state">
            <div class="empty-icon">📊</div>
            <p>No workouts recorded yet. Finish a workout to see your strength progress!</p>
          </div>
        `}
      </div>
    `;
  }

  // Routine & Customizer View
  renderRoutineEditor() {
    this.routineEditorEl.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 8px;">Routine Customization & Time-Saving</h3>
        <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4;">
          Tailor your 4-Day Machine routine. You can hide or toggle optional finishers (like Friday Cable Crunches) to keep your gym sessions strictly under 45 minutes.
        </p>
      </div>

      <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 20px;">
        <h4 style="font-size: 0.95rem; font-weight: 700; margin-bottom: 12px;">Active Workout Days</h4>
        ${this.routine.map(day => `
          <div style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
            <div style="font-weight: 700; font-size: 0.95rem; color: var(--accent-blue);">${day.title} (${day.exercises.length} lifts)</div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
              ${day.exercises.map(e => `${e.name} (${e.sets}×${e.targetReps}${e.isOptional ? ' - optional' : ''})`).join(' • ')}
            </div>
          </div>
        `).join('')}
      </div>

      <div style="display: flex; gap: 12px; flex-wrap: wrap;">
        <button class="secondary-btn" id="exportDataBtn" style="flex: 1; min-width: 160px;">
          📥 Export Data (JSON)
        </button>
        <button class="secondary-btn" id="resetRoutineBtn" style="flex: 1; min-width: 160px; color: #f87171; border-color: rgba(239,68,68,0.3);">
          🔄 Reset to Original Sheet
        </button>
      </div>
    `;

    document.getElementById('exportDataBtn')?.addEventListener('click', () => this.exportData());
    document.getElementById('resetRoutineBtn')?.addEventListener('click', () => this.resetRoutine());
  }

  exportData() {
    const data = {
      routine: this.routine,
      history: this.history,
      machineSettings: this.machineSettings,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `4-Day_Machine_Lifting_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  resetRoutine() {
    if (confirm('Reset your routine to the original spreadsheet defaults?')) {
      this.routine = JSON.parse(JSON.stringify(DEFAULT_ROUTINE));
      this.saveRoutine();
      this.session = this.initNewSession(this.activeDayIndex);
      this.saveCurrentSession();
      alert('Routine reset to original spreadsheet successfully!');
      this.render();
    }
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  window.app = new WorkoutApp();
});
