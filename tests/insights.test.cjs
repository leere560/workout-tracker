const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup() {
 const handlers={}; const elements={};
 const context=vm.createContext({document:{addEventListener(){},getElementById(id){return elements[id] ||= {addEventListener(name,fn){handlers[id+':'+name]=fn;},focus(){}};}},localStorage:{getItem(){return null;}},console,Date});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8')+';globalThis.App=WorkoutApp;',context);
 const app=Object.create(context.App.prototype);app.escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 const selectors={};app.analyticsContentEl={innerHTML:'',querySelectorAll(selector){return selectors[selector] || [];}};app.routineEditorEl={innerHTML:''};app.history=[];app.routine=[{title:'Wed',exercises:[{name:'Press',sets:3,targetReps:'6–8'}]}];app.lastWeights={};app.selectedProgressExercise=null;app.getPersonalRecord=()=>({maxWeight:100,max1RM:120});app.generateSVGProgressionChart=()=>'<svg></svg>';app.generateWeeklyVolumeLandmarksHTML=()=>'<table>Muscle volumes</table>';app.getBackupStatusText=()=> 'Last backup: yesterday';app.deloadActive=false;app.getDeloadDaysLeft=()=>5;app.storageKeys={};
 return {app,handlers,selectors};
}
function record(id,date,name='Press') {return {id,date,dayTitle:'Upper A',totalCompletedSets:3,totalVolume:2400,durationMins:12,exercises:{[name]:{sets:[{setNum:1,weight:100,reps:8,completed:true}]}}};}
test('progress leads with newest saved workout and lift comparison before expandable muscle table',()=>{
 const {app}=setup();app.history=[record('new','2026-10-20','Alternative press'),record('old','2026-10-10')];app.renderAnalytics();const html=app.analyticsContentEl.innerHTML;
 assert.ok(html.indexOf('data-wid="new"')<html.indexOf('Lift progress'));assert.ok(html.indexOf('Lift progress')<html.indexOf('Weekly muscle volume'));assert.match(html,/<label[^>]*for="progressExerciseSelect"/);assert.match(html,/<option value="Alternative press" selected/);assert.match(html,/<details[^>]*><summary>Weekly muscle volume/);assert.doesNotMatch(html,/5-Day|stat-box/);
});
test('comparison reports load and reps separately, including bodyweight and a first-session baseline',()=>{
 const {app}=setup();const history=[{date:'2026-10-10',sets:[{weight:100,reps:8}]},{date:'2026-10-20',sets:[{weight:105,reps:6}]}];const html=app.getLiftComparisonHTML(history);
 assert.match(html,/105 lb × 6/);assert.match(html,/\+5 lb and -2 reps/);assert.match(app.getLiftComparisonHTML([{date:'2026-10-20',sets:[{weight:0,reps:10}]}]),/Bodyweight × 10/);assert.match(app.getLiftComparisonHTML(history.slice(0,1)),/First session/);assert.match(app.getLiftComparisonHTML([]),/No saved sets/);
});
test('history reopen is only offered for snapshots and invokes the safe API',()=>{
 const {app,selectors}=setup();const legacy=record('legacy','2026-10-10');assert.doesNotMatch(app.renderHistoryCard(legacy),/history-reopen-btn/);
 legacy.sessionSnapshot={};legacy.durationLabel='<1 min';assert.match(app.renderHistoryCard(legacy),/history-reopen-btn/);assert.match(app.renderHistoryCard(legacy),/&lt;1 min/);
 let handler,received;selectors['.history-reopen-btn']=[{dataset:{wid:'legacy'},addEventListener(event,fn){handler=fn;}}];app.reopenWorkout=id=>{received=id;};app.renderAnalytics();handler();assert.equal(received,'legacy');
});
test('program and settings have named controls, plain backup labels and collapsible day details',()=>{
 const {app}=setup();app.renderRoutineEditor();const html=app.routineEditorEl.innerHTML;assert.match(html,/Your program/);assert.match(html,/<details class="program-day/);assert.match(html,/Settings & backup/);assert.match(html,/Download backup/);assert.match(html,/Check for update/);assert.doesNotMatch(html,/Data Shield/);
 for(const id of ['deloadSetting','wakeLockSetting']) {assert.match(html,new RegExp(`id="${id}Toggle" aria-labelledby="${id}Label" aria-describedby="${id}Description"`));assert.match(html,new RegExp(`id="${id}Label" for="${id}Toggle"`));}
});
