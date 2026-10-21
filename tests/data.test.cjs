const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
function setup() {
  const storage = new Map();
  const localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,String(v)), removeItem:k=>storage.delete(k), key:i=>[...storage.keys()][i], get length(){return storage.size;} };
  const context = vm.createContext({ console: {error(){}}, localStorage, document:{addEventListener(){}}, window:{}, Date, setTimeout, clearTimeout, setInterval, clearInterval, confirm:()=>true, alert:message=>{context.alertMessage=message;} });
  vm.runInContext(fs.readFileSync(path.join(root,'routine-data.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8')+'\nglobalThis.App=WorkoutApp;',context);
  const app = Object.create(context.App.prototype);
  const keys = ['routine','history','machineSettings','exerciseNotes','lastWeights','exercisePreferences','routineRev','wakeLockEnabled','deloadActive','deloadStartDate','lastBackupTime','timerTargetEnd','timerTotalDuration'];
  app.storageKeys=Object.fromEntries(keys.map(key=>[key,key]));
  app.storageKeys.currentSessionPrefix='gym_session_'; app.storageKeys.legacyCurrentSession='legacy';
  app.history=[];app.lastWeights={};app.exercisePreferences={};app.machineSettings={};app.exerciseNotes={};app.deloadActive=false;app.deloadStartDate=0;app.activeDayIndex=0;app.routine=app.loadRoutine();app.session=null;
  app.showToast=()=>{};app.render=()=>{};app.restoreActiveTimer=()=>{};app.renderWorkout=()=>{};app.renderAnalytics=()=>{};
  return {app,localStorage,storage,context};
}
const clone = value => JSON.parse(JSON.stringify(value));
test('migration preserves custom exercises, reps, sets and ordering and is repeatable',()=>{
 const {app,localStorage}=setup();
 const custom=[{id:'mine',title:'My day',exercises:[{id:'custom',name:'Cable Lateral Raise',muscle:'Shoulders',sets:4,targetReps:'8–12',notes:'my note',rest:'90 sec',increment:2.5},{id:'other',name:'My press',sets:2,targetReps:'5–7',rest:'3 min'}]}];
 localStorage.setItem('routine',JSON.stringify(custom));localStorage.setItem('routineRev','1');
 const first=clone(app.loadRoutine()); const second=clone(app.loadRoutine());
 assert.equal(first[0].exercises[0].targetReps,'8–12');assert.equal(first[0].exercises[0].sets,4);assert.equal(first[0].exercises[0].notes,'my note');assert.equal(first[0].exercises[0].increment,2.5);
 assert.equal(first[0].exercises[0].restSeconds,120);assert.equal(first[0].exercises[1].restSeconds,180);assert.deepEqual(first,second);
});
test('pending edited session preserves values and removed sets without any completed set',()=>{
 const {app,localStorage}=setup();const day=app.routine[0]; const session={id:'s',dayId:day.id,deload:false,logs:{[day.exercises[0].id]:[{weight:127.5,reps:7,completed:false,rir:2}]},swaps:{}};
 localStorage.setItem(app.getSessionKey(day.id),JSON.stringify(session));app.deloadActive=true;
 assert.deepEqual(clone(app.loadSession()).logs,session.logs); assert.equal(app.loadSession().deload,false);
});
test('only provably untouched sessions rescale on deload mode changes',()=>{
 const {app,localStorage}=setup();const day=app.routine[0];const logs={a:[{weight:100,reps:8,completed:false}]};
 localStorage.setItem(app.getSessionKey(day.id),JSON.stringify({dayId:day.id,deload:false,logs,initialLogs:logs,swaps:{},startTime:null}));
 app.deloadActive=true;app.initNewSession=()=>({rescaled:true,deload:true});assert.equal(app.loadSession().rescaled,true);
});
test('volume separates actual completed work, shoulder heads and hip thrust glutes',()=>{
 const {app}=setup(); const result=app.calculateWeeklyVolume();
 assert.equal(result.completed.Chest.direct,0);assert.equal(result.planned['Side Delts'].direct,6);assert.equal(result.planned['Rear Delts'].direct,5);
 assert.ok(result.planned.Hamstrings.direct>0);assert.ok(result.planned.Glutes.direct>0);
 assert.deepEqual(clone(app.getExerciseMuscleCredits('Machine Hip Thrust / Glute Drive')), {direct:['Glutes'],indirect:{}});
});
test('completed volume includes active days and snapshots, excludes old sets and saved sessions',()=>{
 const {app,localStorage}=setup();const now=Date.now();const date=new Date(now-1000).toISOString();
 app.history=[{id:'w',sessionId:'saved',date,exercises:{'Machine Hip Thrust / Glute Drive':{sets:[{completed:true}]},'Unrecognized vintage lift':{sets:[{completed:true}]}}}];
 const day=app.routine[0];const id=day.exercises[0].id;
 app.session={id:'saved',dayId:day.id,startTime:date,logs:{[id]:[{completed:true,exerciseName:'Converging Machine Chest Press'}]}};
 localStorage.setItem(app.getSessionKey(app.routine[1].id),JSON.stringify({id:'active',dayId:app.routine[1].id,startTime:date,logs:{old:[{completed:true,exerciseName:'Cable Lateral Raise',muscle:'Shoulders',completedAt:date},{completed:true,exerciseName:'Cable Lateral Raise',completedAt:new Date(now-8*86400000).toISOString()}]}}));
 const totals=app.calculateWeeklyVolume(now);
 assert.equal(totals.completed.Glutes.direct,1);assert.equal(totals.completed.Glutes.indirect,0);assert.equal(totals.completed.Chest.direct,0);assert.equal(totals.completed['Side Delts'].direct,1);assert.deepEqual(clone(totals.unmapped),['Unrecognized vintage lift']);
});
test('invalid backup is rejected before any writes, valid backup restores pending sessions and timer',()=>{
 const {app,localStorage,storage,context}=setup();const before=[...storage.entries()];
 app.importData(JSON.stringify({history:[],routine:[{id:'broken'}]}));assert.deepEqual([...storage.entries()],before);assert.match(context.alertMessage,/routine/);
 const day=app.routine[0];app.session={id:'active',dayId:day.id,deload:false,logs:{[day.exercises[0].id]:[{weight:101,reps:7,completed:false}]},swaps:{}};
 app.exercisePreferences={'Cable Lateral Raise':{increment:2.5,loadConvention:'per-hand'}};
 localStorage.setItem(app.storageKeys.timerTargetEnd,String(Date.now()+120000));localStorage.setItem('gym_timer_minimum_v1','120');
 const backup=clone(app.createBackupData());app.session=null;app.exercisePreferences={};app.importData(JSON.stringify(backup));
 assert.equal(app.session.logs[day.exercises[0].id][0].weight,101);assert.equal(app.exercisePreferences['Cable Lateral Raise'].increment,2.5);assert.equal(localStorage.getItem('gym_timer_minimum_v1'),'120');
});
test('legacy backup without sessions remains importable and duplicate workouts merge once',()=>{
 const {app}=setup();const workout={id:'old',date:new Date().toISOString(),exercises:{'Cable Lateral Raise':{sets:[{weight:10,reps:12}]}}};
 app.importData(JSON.stringify({version:'2.4',history:[workout,workout],lastWeights:{'Cable Lateral Raise':{sets:[null,{weight:10,reps:12}]}}}));assert.equal(app.history.length,1);
});
test('safe updates preserve every stored value and do not clear workout state',async()=>{
 const {app,context,storage}=setup();let checked=false,applied=false;context.window.workoutUpdates={check:async()=>{checked=true;},apply:async()=>{applied=true;return false;}};
 storage.set('important','keep');const before=[...storage.entries()];await app.forceAppUpdate();assert.deepEqual([...storage.entries()],before);assert.equal(checked,true);assert.equal(applied,true);
});
test('legacy last weights exclude recovery loads and rebuild normal baseline',()=>{
 const {app,localStorage}=setup();const normal={id:'normal',date:'2026-10-01',exercises:{Lift:{sets:[{weight:100,reps:8}]}}}; const recovery={id:'recovery',date:'2026-10-08',deload:true,exercises:{Lift:{sets:[{weight:90,reps:8}]}}};
 app.history=[normal,recovery];localStorage.setItem('lastWeights',JSON.stringify({Lift:{date:'2026-10-08',sets:[{weight:90,reps:8}]}}));assert.equal(app.loadLastWeights().Lift.sets[0].weight,100);
 app.history=[recovery];assert.equal(app.loadLastWeights().Lift.deload,true);
});
test('finishing a swapped session keeps completed identities separate and deload baseline intact',()=>{
 const {app,context}=setup();const ex=app.routine[0].exercises[0];
 app.session={id:'mixed',dayId:app.routine[0].id,deload:true,startTime:new Date().toISOString(),logs:{[ex.id]:[{weight:100,reps:8,completed:true,exerciseName:ex.name,muscle:'Chest'},{weight:35,reps:10,completed:true,exerciseName:'Dumbbell Bench Press',muscle:'Chest'}]},swaps:{[ex.id]:{name:'Dumbbell Bench Press',muscle:'Chest',targetReps:'8–12'}}};
 app.lastWeights={[ex.name]:{date:'2026-10-01',sets:[{weight:120,reps:8}]}};
 app.getPersonalRecord=()=>({maxWeight:0,bestReps:0});app.escapeHtml=v=>String(v);app.summaryContentEl={innerHTML:''};app.summaryModalEl={classList:{add(){}}};context.document.getElementById=()=>null;
 app.initNewSession=()=>({id:'new',dayId:app.routine[0].id,logs:{},swaps:{},deload:true});
 app.stopTimer=()=>{};app.finishSession();const result=app.history[0];
 assert.equal(result.exercises[ex.name].sets[0].weight,100);assert.equal(result.exercises['Dumbbell Bench Press'].sets[0].weight,35);assert.equal(result.sessionId,'mixed');assert.equal(result.deload,true);assert.equal(app.lastWeights[ex.name].sets[0].weight,120);assert.equal(result.totalVolume,1150);
});
test('imported history stays chronological and does not replace newer equipment baseline',()=>{
 const {app}=setup();const exercise={Lift:{sets:[{weight:100,reps:8}]}};
 app.history=[{id:'recent',date:'2026-10-15',exercises:exercise}];app.lastWeights={Lift:{date:'2026-10-15',sets:[{weight:120,reps:8}]}};
 app.importData(JSON.stringify({history:[{id:'older',date:'2026-10-01',exercises:exercise}],lastWeights:{Lift:{date:'2026-10-01',sets:[{weight:100,reps:8}]}}}));
 assert.deepEqual(clone(app.history.map(h=>h.id)),['older','recent']);assert.equal(app.lastWeights.Lift.sets[0].weight,120);
});
test('active set snapshots never inherit the muscle of a later swap',()=>{
 const {app}=setup();const ex=app.routine[0].exercises[0];app.session={id:'snapshot',dayId:app.routine[0].id,startTime:new Date(Date.now()-1000).toISOString(),swaps:{[ex.id]:{name:'Cable Lateral Raise',muscle:'Shoulders'}},logs:{[ex.id]:[{completed:true,exerciseName:ex.name}]}};
 const volume=app.calculateWeeklyVolume();assert.equal(volume.completed.Chest.direct,1);assert.equal(volume.completed['Side Delts'].direct,0);
});

test('history rebuild retains the newest normal baseline without stale extra sets',()=>{
 const {app}=setup();
 app.history=[{date:'2026-10-15',deload:true,exercises:{Lift:{sets:[{weight:70,reps:8}]}}},{date:'2026-10-10',exercises:{Lift:{sets:[{weight:110,reps:8}]}}},{date:'2026-10-01',exercises:{Lift:{sets:[{weight:100,reps:8},{weight:100,reps:8}]}}}];
 app.rebuildLastWeightsFromHistory();assert.equal(app.lastWeights.Lift.sets.length,1);assert.equal(app.lastWeights.Lift.sets[0].weight,110);
});

test('warmup uses the current equipment baseline rather than an earlier completed swap',()=>{
 const {app}=setup(); const ex=app.routine[0].exercises[0];
 app.session={logs:{[ex.id]:[{exerciseName:ex.name,weight:200,completed:true},{exerciseName:'New equipment',weight:null,completed:false}]},swaps:{[ex.id]:{name:'New equipment',targetReps:'10-12'}}};
 app.updateNowLiftingHUD=()=>{};app.jumpToActiveExercise=()=>{};assert.equal(app.addWarmupSets(ex.id),false);assert.equal(app.getWarmupSets(ex.id).length,0);
 app.session.logs[ex.id][1].weight=50;assert.equal(app.addWarmupSets(ex.id),true);const rows=app.getWarmupSets(ex.id);assert.equal(rows.length,3);assert.ok(rows.every(row=>row.exerciseName==='New equipment' && row.weight<=50));assert.equal(rows[0].weight,Math.round(25/app.getExerciseIncrement(ex,'New equipment'))*app.getExerciseIncrement(ex,'New equipment'));
});
