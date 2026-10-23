const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));

function setup() {
  const values = new Map(); let failKey;
  const localStorage = {getItem:key=>values.get(key)??null, setItem(key,value){if(key===failKey){failKey=null;throw Error('Quota');}values.set(key,String(value));},removeItem:key=>values.delete(key),key:index=>[...values.keys()][index],get length(){return values.size;}};
  const context=vm.createContext({localStorage,console:{error(){}},document:{addEventListener(){},querySelector(){return {click(){}};}},window:{},Date});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../routine-data.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../app.js'),'utf8')+';globalThis.App=WorkoutApp;',context);
  const defaults=vm.runInContext('JSON.parse(JSON.stringify(DEFAULT_ROUTINE))',context);
  const app=Object.create(context.App.prototype);
  Object.assign(app,{routine:clone(defaults),history:[],lastWeights:{},exercisePreferences:{},activeDayIndex:2,deloadActive:false,
    storageKeys:{routine:'routine',routineRev:'rev',currentSessionPrefix:'gym_session_',legacyCurrentSession:'legacy',history:'history',lastWeights:'weights'},collapsedCards:new Set()});
  for(const method of ['showToast','renderWorkout','stopTimer','render','jumpToActiveExercise']) app[method]=()=>{};
  const incline=app.routine[2].exercises[0],overhead=app.routine[2].exercises[2];
  Object.assign(incline,{name:'Incline Dumbbell Bench Press',startingWeight:'40',increment:2.5});
  Object.assign(overhead,{name:'Seated Dumbbell Shoulder Press',startingWeight:'30',increment:2.5});
  values.set('routine',JSON.stringify(app.routine));
  return {app,values,defaults,failOn:key=>{failKey=key;}};
}

test('repair restores only the two known Saturday equipment defaults and preserves prescriptions',()=>{
  const {app,values,defaults}=setup();const before=clone(app.routine);
  app.routine[2].exercises[0].sets=4;app.routine[2].exercises[0].targetReps='5–9';values.set('routine',JSON.stringify(app.routine));
  app.routine=app.loadRoutine();const [incline,,overhead]=app.routine[2].exercises;
  assert.equal(incline.name,defaults[2].exercises[0].name);assert.equal(overhead.name,defaults[2].exercises[2].name);
  assert.equal(incline.sets,4);assert.equal(incline.targetReps,'5–9');assert.equal(incline.restSeconds,180);assert.equal(incline.equipmentRepairVersion,1);
  assert.deepEqual(clone(app.routine[3]),before[3]);assert.deepEqual(clone(app.routine[2].exercises[1]),before[2].exercises[1]);
  assert.ok(incline.equipmentAlternatives.some(ex=>ex.name==='Incline Dumbbell Bench Press'));
  const once=JSON.stringify(app.routine);app.routine=app.loadRoutine();assert.equal(JSON.stringify(app.routine),once);
});

test('repair does not rewrite custom equipment or future deliberate default changes',()=>{
  const {app,values}=setup();app.routine[2].exercises[0].name='My custom chest machine';values.set('routine',JSON.stringify(app.routine));
  app.routine=app.loadRoutine();assert.equal(app.routine[2].exercises[0].name,'My custom chest machine');
  const ex=app.routine[2].exercises[2];app.session=app.initNewSession(2);
  app.applyExerciseSwap(ex.id,{name:'Seated Dumbbell Shoulder Press',muscle:'Shoulders',targetReps:'8–10'},'permanent');
  app.routine=app.loadRoutine();assert.equal(app.routine[2].exercises[2].name,'Seated Dumbbell Shoulder Press');
});

test('untouched dumbbell drafts regenerate from restored equipment, never from dumbbell loads',()=>{
  const {app,values,defaults}=setup();const draft=app.initNewSession(2),id=defaults[2].exercises[0].id;
  values.set(app.getSessionKey(draft.dayId),JSON.stringify(draft));app.routine=app.loadRoutine();
  const restored=JSON.parse(values.get(app.getSessionKey(draft.dayId)));
  assert.equal(restored.logs[id][0].exerciseName,defaults[2].exercises[0].name);assert.equal(restored.logs[id][0].weight,null);assert.equal(restored.logs[id][0].needsBaseline,true);
  assert.deepEqual(restored.logs,restored.initialLogs);assert.equal(restored.lastInteractionAt,null);assert.equal(app.hasSessionProgress(restored),false);
});

test('equipment repair uses only the restored lift history and respects a draft deload',()=>{
  const {app,values,defaults}=setup();const original=defaults[2].exercises[0];
  app.history=[{date:'2026-10-10',exercises:{[original.name]:{sets:[{weight:80,reps:6,completed:true}]}}}];
  app.lastWeights={'Incline Dumbbell Bench Press':{sets:[{weight:40,reps:8}]}};
  const draft=app.initNewSession(2);draft.deload=true;values.set('legacy',JSON.stringify(draft));
  const history=clone(app.history),weights=clone(app.lastWeights);app.routine=app.loadRoutine();const restored=JSON.parse(values.get('legacy'));
  assert.equal(restored.logs[original.id][0].weight,70);assert.deepEqual(clone(app.history),history);assert.deepEqual(clone(app.lastWeights),weights);
});

test('progressed active, retained and legacy drafts preserve values and equipment identities',()=>{
  const {app,values,defaults}=setup();const draft=app.initNewSession(2),id=defaults[2].exercises[0].id;
  Object.assign(draft.logs[id][0],{weight:42.5,reps:7,completed:true});delete draft.logs[id][0].exerciseName;
  draft.logs[id][1].reps='';draft.startTime='2026-10-17T12:00:00Z';draft.lastInteractionAt=draft.startTime;draft.updatedAt=draft.startTime;
  draft.warmups[id]=[{weight:20,reps:10,completed:true}];const before=clone(draft);
  const keys=[app.getSessionKey(draft.dayId),'legacy','gym_saved_draft_recovered'];keys.forEach(key=>values.set(key,JSON.stringify(draft)));
  values.set('gym_timer_minimum_v1','120');values.set('history','keep history');values.set('weights','keep weights');app.routine=app.loadRoutine();
  for(const key of keys){const restored=JSON.parse(values.get(key));assert.equal(restored.swaps[id].name,'Incline Dumbbell Bench Press');assert.equal(restored.logs[id][0].exerciseName,'Incline Dumbbell Bench Press');assert.equal(restored.logs[id][0].weight,42.5);assert.equal(restored.logs[id][1].reps,'');assert.equal(restored.warmups[id][0].exerciseName,'Incline Dumbbell Bench Press');for(const field of ['startTime','lastInteractionAt','updatedAt','exerciseOrder'])assert.deepEqual(restored[field],before[field]);}
  assert.equal(values.get('history'),'keep history');assert.equal(values.get('weights'),'keep weights');assert.equal(values.get('gym_timer_minimum_v1'),'120');
});

test('an existing explicit workout swap takes precedence during repair',()=>{
  const {app,values,defaults}=setup();const draft=app.initNewSession(2),id=defaults[2].exercises[0].id;
  draft.swaps[id]={name:'Converging Machine Incline Press',muscle:'Chest',targetReps:'6–8'};
  draft.logs[id].forEach(set=>{set.exerciseName=draft.swaps[id].name;set.weight=90;});
  values.set('legacy',JSON.stringify(draft));app.routine=app.loadRoutine();const restored=JSON.parse(values.get('legacy'));
  assert.deepEqual(restored.swaps[id],draft.swaps[id]);assert.equal(restored.logs[id][0].weight,90);
});

test('repair rolls back routine, draft and revision writes together on storage failure',()=>{
  for(const failed of ['routine','rev','legacy']) {
    const {app,values,failOn}=setup();const draft=app.initNewSession(2);values.set('legacy',JSON.stringify(draft));const stored=[...values.entries()];
    failOn(failed);app.routine=app.loadRoutine();assert.equal(app.equipmentRepairFailed,true);assert.equal(app.routine[2].exercises[0].name,'Incline Dumbbell Bench Press');assert.deepEqual([...values.entries()],stored);
  }
});

test('legacy backup restoration repairs defaults while modern backups retain intentional defaults',()=>{
  const {app,values}=setup();const legacy=clone(app.routine);app.routine=app.loadRoutine();
  values.set('routine',JSON.stringify(legacy));app.routine=app.loadRoutine();assert.match(app.routine[2].exercises[0].name,/Smith/);
  const modern=clone(app.routine);modern[2].exercises[0].name='Incline Dumbbell Bench Press';values.set('routine',JSON.stringify(modern));
  app.routine=app.loadRoutine();assert.equal(app.routine[2].exercises[0].name,'Incline Dumbbell Bench Press');
});

test('retained drafts derive active equipment from pending names rather than a later routine replacement',()=>{
  for(const pendingName of ['Smith Machine Incline Press (30°)','Converging Machine Incline Press']) {
    const {app,values}=setup();const draft=app.initNewSession(2),id=app.routine[2].exercises[0].id;
    Object.assign(draft.logs[id][0],{weight:40,reps:7,completed:true});
    draft.logs[id].slice(1).forEach(set=>Object.assign(set,{exerciseName:pendingName,weight:110,reps:7,needsBaseline:false}));
    draft.warmups[id]=[{weight:20,reps:10,completed:true,exerciseName:'Incline Dumbbell Bench Press',muscle:'Chest',targetReps:'6–8'}];
    values.set('gym_saved_draft_before_replacement',JSON.stringify(draft));app.routine=app.loadRoutine();
    const restored=JSON.parse(values.get('gym_saved_draft_before_replacement'));
    app.session=restored;const ex=app.routine[2].exercises[0];
    assert.equal(app.getEffectiveExerciseName(id,ex),pendingName);
    assert.equal(restored.logs[id][1].weight,110);assert.equal(restored.logs[id][1].needsBaseline,false);
    assert.equal(restored.logs[id][0].exerciseName,'Incline Dumbbell Bench Press');assert.equal(restored.logs[id][0].weight,40);
    assert.deepEqual(restored.warmups,clone(draft.warmups));
  }
});

test('unanimous completed equipment supplies missing pending identities without changing recorded values',()=>{
  const {app,values}=setup();const draft=app.initNewSession(2),id=app.routine[2].exercises[0].id;
  Object.assign(draft.logs[id][0],{exerciseName:'Converging Machine Incline Press',weight:110,completed:true});
  draft.logs[id].slice(1).forEach(set=>{delete set.exerciseName;set.weight=110;});
  values.set('legacy',JSON.stringify(draft));app.routine=app.loadRoutine();const restored=JSON.parse(values.get('legacy'));
  assert.equal(restored.swaps[id].name,'Converging Machine Incline Press');
  assert.ok(restored.logs[id].every(set=>set.exerciseName==='Converging Machine Incline Press' && set.weight===110));
});

test('reopening old dumbbell snapshots restores their equipment even after the one-time repair',()=>{
  const {app,values}=setup();const snapshot=app.initNewSession(2),id=app.routine[2].exercises[0].id;
  snapshot.logs[id].forEach(set=>Object.assign(set,{weight:40,needsBaseline:false}));snapshot.logs[id][0].completed=true;
  const record={id:'old-db',sessionId:snapshot.id,dayId:snapshot.dayId,date:'2026-10-17T12:30:00Z',
    exercises:{'Incline Dumbbell Bench Press':{sets:[clone(snapshot.logs[id][0])]}},sessionSnapshot:clone(snapshot)};
  app.history=[record];const archived=clone(record);app.routine=app.loadRoutine();app.routine=app.loadRoutine();
  app.session=app.initNewSession(2);app.session.id='fresh';
  assert.equal(app.reopenWorkout(record.id),true);const ex=app.routine[2].exercises[0];
  assert.equal(app.getEffectiveExerciseName(id,ex),'Incline Dumbbell Bench Press');
  assert.equal(app.session.logs[id][1].weight,40);assert.equal(app.session.logs[id][1].needsBaseline,false);
  assert.equal(JSON.parse(values.get(app.getSessionKey(snapshot.dayId))).swaps[id].name,'Incline Dumbbell Bench Press');
  assert.deepEqual(record,archived);assert.equal(app.initNewSession(2).logs[id][0].exerciseName,'Smith Machine Incline Press (30°)');
});

test('reopening unnamed snapshot rows can recover equipment from the archived exercise family',()=>{
  const {app}=setup();const snapshot=app.initNewSession(2),id=app.routine[2].exercises[0].id;
  snapshot.logs[id].forEach(set=>{delete set.exerciseName;set.weight=40;set.needsBaseline=false;});snapshot.logs[id][0].completed=true;
  const record={id:'unnamed-db',sessionId:snapshot.id,dayId:snapshot.dayId,date:'2026-10-17T12:30:00Z',
    exercises:{'Incline Dumbbell Bench Press':{sets:[{weight:40,reps:7,completed:true}]},'Half-Kneeling Single-Arm Pulldown':{sets:[{weight:55,reps:8,completed:true}]}},sessionSnapshot:clone(snapshot)};
  app.history=[record];const archived=clone(record);app.routine=app.loadRoutine();app.session=app.initNewSession(2);app.session.id='fresh';
  assert.equal(app.reopenWorkout(record.id),true);
  assert.equal(app.session.swaps[id].name,'Incline Dumbbell Bench Press');
  assert.ok(app.session.logs[id].every(set=>set.exerciseName==='Incline Dumbbell Bench Press' && set.weight===40));
  assert.deepEqual(record,archived);
});

test('explicit snapshot swaps override named pending rows and completed names remain recorded',()=>{
  const {app}=setup();const snapshot=app.initNewSession(2),id=app.routine[2].exercises[0].id;
  snapshot.swaps[id]={name:'My explicit press',muscle:'Chest',targetReps:'6–8'};
  snapshot.logs[id][0].completed=true;const completedName=snapshot.logs[id][0].exerciseName;
  snapshot.logs[id].forEach(set=>{delete set.muscle;delete set.targetReps;});const beforeRows=clone(snapshot.logs[id]);
  app.routine=app.loadRoutine();app.reconcileSessionEquipmentIdentity(snapshot,app.routine[2].exercises[0]);
  assert.equal(snapshot.swaps[id].name,'My explicit press');assert.equal(snapshot.logs[id][0].exerciseName,completedName);
  assert.deepEqual(clone(snapshot.logs[id]),beforeRows);
});

test('equipment change success toasts escape imported equipment names',()=>{
  const {app}=setup();app.session=app.initNewSession(2);app.showToast=message=>{app.toast=message;};
  const ex=app.routine[2].exercises[0];ex.name='<b>Original</b>';
  app.applyExerciseSwap(ex.id,{name:'<img src=x onerror=alert(1)>',muscle:'Chest'},'permanent');
  assert.match(app.toast,/&lt;b&gt;Original&lt;\/b&gt;/);assert.match(app.toast,/&lt;img src=x onerror=alert\(1\)&gt;/);assert.ok(!app.toast.includes('<img'));
});
