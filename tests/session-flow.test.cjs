const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = x => JSON.parse(JSON.stringify(x));
function setup() {
 let now = Date.parse('2026-10-20T17:00:00Z');
 const values = new Map(), handlers = new Map(), elements = new Map();
 let failKey = null;
 const localStorage = {getItem:k=>values.get(k) ?? null,setItem(k,v){if(k===failKey){failKey=null;throw Error('Quota exceeded');}values.set(k,String(v));},removeItem:k=>values.delete(k),key:i=>[...values.keys()][i],get length(){return values.size;}};
 const classList={add(){},remove(){}};
 const element=id=>{if(!elements.has(id)) elements.set(id,{innerHTML:'',textContent:'',style:{},classList,addEventListener:(name,fn)=>handlers.set(id+':'+name,fn),click(){}});return elements.get(id);};
 const context=vm.createContext({console,localStorage,Date:class extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}},document:{addEventListener(){},getElementById:element,querySelector:()=>({click(){}}),body:{classList}},window:{},setInterval:()=>1,clearInterval(){},confirm:()=>true,alert(){}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../routine-data.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../app.js'),'utf8')+';globalThis.App=WorkoutApp;',context);
 const app=Object.create(context.App.prototype);
 const keys=['routine','history','lastWeights','routineRev','machineSettings','exerciseNotes','exercisePreferences','wakeLockEnabled','deloadActive','deloadStartDate','lastBackupTime','timerTargetEnd','timerTotalDuration'];
 app.storageKeys=Object.fromEntries(keys.map(k=>[k,k]));app.storageKeys.currentSessionPrefix='gym_session_';app.storageKeys.legacyCurrentSession='legacy';
 Object.assign(app,{routine:vm.runInContext('JSON.parse(JSON.stringify(DEFAULT_ROUTINE))',context),activeDayIndex:0,history:[],lastWeights:{},machineSettings:{},exerciseNotes:{},exercisePreferences:{},deloadActive:false,deloadStartDate:0,wakeLockEnabled:true,activeView:'workout',collapsedCards:new Set(),timer:{active:false,intervalId:null},timerDockEl:{classList},summaryContentEl:element('summaryContent'),summaryModalEl:element('summaryModal'),exerciseListEl:{querySelector:()=>null}});
 for(const method of ['renderWorkout','render','renderAnalytics','updateNowLiftingHUD','triggerHaptic','primeAudioContext','playTimerAlarm','showRestCompleteBanner','requestWakeLock','releaseWakeLock','restoreActiveTimer','jumpToActiveExercise']) app[method]=()=>{};
 app.showToast=message=>{app.toast=message;};app.session=app.initNewSession(0);app.saveCurrentSession();
 const first=()=>app.session.logs[app.routine[app.activeDayIndex].exercises[0].id][0];
 const complete=()=>{Object.assign(first(),{weight:100,reps:8,completed:true});app.session.startTime=new context.Date(now-42000).toISOString();app.saveCurrentSession();};
 return {app,values,handlers,first,complete,localStorage,advance:ms=>{now+=ms;},failOnce:key=>{failKey=key;}};
}

test('finish review and Keep training do not archive or reset entries',()=>{
 const {app,complete,handlers}=setup();complete();const before=clone(app.session);app.showWorkoutSummary();
 assert.match(app.summaryContentEl.innerHTML,/1 sets completed/);assert.match(app.summaryContentEl.innerHTML,/Finish early/);assert.equal(app.history.length,0);assert.deepEqual(clone(app.session),before);
 handlers.get('keepTrainingBtn:click')();assert.deepEqual(clone(app.session),before);assert.equal(app.history.length,0);
});

test('confirm saves exactly once, retains draft snapshot and reports actual short duration',()=>{
 const {app,complete,first}=setup();complete();app.timer.active=true;const id=app.session.id;
 assert.equal(app.finishSession(id),true);assert.equal(app.history.length,1);assert.equal(app.history[0].durationSeconds,42);assert.equal(app.history[0].durationLabel,'<1 min');assert.equal(app.history[0].sessionSnapshot.id,id);assert.equal(app.timer.active,false);assert.notEqual(app.session.id,id);assert.equal(first().completed,false);
 assert.equal(app.finishSession(id),false);assert.equal(app.history.length,1);
});

test('failed finish rolls back history and baseline without closing the draft or timer',()=>{
 const {app,complete,values,failOnce}=setup();complete();app.timer.active=true;const before=[...values.entries()],id=app.session.id;failOnce('lastWeights');
 assert.equal(app.finishSession(id),false);assert.equal(app.history.length,0);assert.equal(app.session.id,id);assert.equal(app.timer.active,true);assert.deepEqual([...values.entries()],before);assert.deepEqual(clone(app.lastWeights),{});
});

test('reopen recovers pending entries without double counting history or overwriting a newer draft',()=>{
 const {app,complete}=setup();complete();const ex=app.routine[0].exercises[0];app.session.logs[ex.id][1].reps='';const original=clone(app.session);app.finishSession();const record=app.history[0];
 assert.equal(app.reopenWorkout(record.id),true);assert.equal(app.history.length,0);assert.deepEqual(clone(app.session.logs),original.logs);assert.equal(app.lastWeights[ex.name],undefined);
 app.session.logs[ex.id][1].reps=6;app.finishSession();const newRecord=app.history[0];app.updateSetWeight(ex.id,0,125);const progressed=clone(app.session);
 assert.equal(app.reopenWorkout(newRecord.id),false);assert.equal(app.history.length,1);assert.deepEqual(clone(app.session),progressed);
});

test('reopen storage failure preserves archived record and existing active draft',()=>{
 const {app,complete,failOnce,values}=setup();complete();app.finishSession();const id=app.session.id,before=clone(app.history),storage=[...values.entries()];failOnce('lastWeights');
 assert.equal(app.reopenWorkout(before[0].id),false);assert.equal(app.session.id,id);assert.deepEqual(clone(app.history),before);assert.deepEqual([...values.entries()],storage);
});

test('resume restores the last progressed off-schedule day and supports legacy drafts without IDs',()=>{
 const {app,values}=setup();app.activeDayIndex=1;app.session=app.initNewSession(1);const ex=app.routine[1].exercises[0];app.updateSetWeight(ex.id,0,145);app.saveCurrentSession();
 assert.equal(app.getResumeDayIndex(),1);assert.equal(app.loadSession(1).logs[ex.id][0].weight,145);
 values.set(app.getSessionKey(app.routine[1].id),JSON.stringify({dayId:app.routine[1].id,logs:{[ex.id]:[{weight:145,reps:7,completed:false}]}}));app.history=[{id:'old',exercises:{},date:'2026-10-01'}];
 assert.equal(app.getResumeDayIndex(),1);assert.equal(app.loadSession(1).logs[ex.id][0].weight,145);
});

test('Start new preserves and backs up a stale draft including blank or invalid pending edits',()=>{
 const {app,advance,first,values}=setup();app.updateSetReps(app.routine[0].exercises[0].id,0,'');first().weight=-2;const original=clone(app.session);advance(86400000);
 assert.equal(app.getSessionResumeInfo().stale,true);assert.equal(app.startNewSession(),true);assert.equal(app.getSessionResumeInfo().savedDraftId,original.id);
 const backup=clone(app.createBackupData());assert.equal(backup.savedDrafts.length,1);assert.equal(backup.savedDrafts[0].logs[app.routine[0].exercises[0].id][0].reps,'');assert.doesNotThrow(()=>app.validateBackup(backup));
 values.delete('gym_saved_draft_'+original.id);values.delete('gym_saved_draft_for_'+original.dayId);app.importData(JSON.stringify(backup));assert.equal(app.getSessionResumeInfo().savedDraftId,original.id);
 assert.equal(app.restoreSavedDraft(original.id),true);assert.deepEqual(clone(app.session.logs),original.logs);assert.equal(values.has('gym_saved_draft_'+original.id),false);
});

test('working set completion requires positive whole reps and valid load while preserving edit text',()=>{
 const {app,first}=setup();const ex=app.routine[0].exercises[0];app.startTimer=()=>{};
 for(const value of ['',0,-1,2.5]) {app.updateSetReps(ex.id,0,value);app.toggleSetCompletion(ex.id,0);assert.equal(first().completed,false);assert.equal(first().reps,value);}
 app.updateSetReps(ex.id,0,'8');app.updateSetWeight(ex.id,0,-5);app.toggleSetCompletion(ex.id,0);assert.equal(first().completed,false);assert.equal(first().weight,-5);
 app.updateSetWeight(ex.id,0,0);app.toggleSetCompletion(ex.id,0);assert.equal(first().completed,true);
});
