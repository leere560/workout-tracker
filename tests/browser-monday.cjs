const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.join(__dirname,'..');
const defaults=vm.runInNewContext(fs.readFileSync(path.join(root,'routine-data.js'),'utf8')+';DEFAULT_ROUTINE;');
const legacy=JSON.parse(JSON.stringify(defaults));
for(const ex of legacy[4].exercises){if(!ex.previousExercise)continue;const old=ex.previousExercise;Object.assign(ex,old,{sets:old.programSets,needsBaseline:false});delete ex.mondayRevision;delete ex.previousExercise;delete ex.equipmentAlternatives;delete ex.programSets;}
const ids=['mon__lower_b_ex_hip_thrust','mon__lower_b_ex_back_ext','mon__lower_b_ex6'];
async function focus(page,id){const summary=page.locator('.workout-overview > summary');if(!await page.locator('.workout-overview').evaluate(el=>el.open))await summary.click();await page.locator(`.overview-exercise[data-exid="${id}"]`).click();}
(async()=>{const installed='C:/Program Files/Google/Chrome/Application/chrome.exe';const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||(fs.existsSync(installed)?installed:undefined)});const report=[];try{
for(const width of [375,402,430]){
 const context=await browser.newContext({viewport:{width,height:874},reducedMotion:'reduce'}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push(message.text());});
 const url=process.env.PREVIEW_URL||'http://127.0.0.1:8766/preview.html';await page.goto(url);await page.selectOption('#workoutDayPicker','4');
 for(const [id,name,count,reps] of [[ids[0],'Barbell Romanian Deadlift',3,'8–10'],[ids[1],'Seated Hip Abduction',2,'12–20'],[ids[2],'Machine Crunch',3,'10–12']]){
  await focus(page,id);assert.equal(await page.locator('.exercise-name').textContent(),name);
  assert.equal(await page.locator('.set-row').count(),count);assert.ok((await page.locator('.focus-prescription').textContent()).includes(reps));
  assert.equal(await page.locator('.set-weight-input').first().inputValue(),'');assert.equal(await page.locator('.set-check-btn').first().isDisabled(),true);
 }
 const counts=await page.evaluate(()=>({quads:app.calculateWeeklyVolume().planned.Quads.direct,hams:app.calculateWeeklyVolume().planned.Hamstrings.direct,abs:app.calculateWeeklyVolume().planned['Abs / Core'].direct,total:app.getWorkingSetCounts().total}));
 assert.equal(counts.quads,10);assert.equal(counts.hams,10);assert.equal(counts.abs,6);assert.equal(counts.total,18);
 await focus(page,ids[0]);await page.locator('.set-weight-input').first().fill('95');await page.locator('.set-reps-input').first().fill('8');await page.locator('.set-check-btn').first().click();
 assert.equal(await page.evaluate(()=>app.timer.totalDuration),180);assert.equal(await page.locator('#timerSkipBtn').isDisabled(),true);
 await page.reload();assert.equal(await page.evaluate(id=>app.session.logs[id][0].weight,ids[0]),95);
 // Seed only this isolated browser origin with a synthetic old saved routine and draft.
 for(const progressed of [false,true]){
  const original=await page.evaluate(({routine,progressed})=>{
   app.stopTimer();const oldView=Object.assign(Object.create(app),{routine,session:null,history:[],lastWeights:{}}),draft=oldView.initNewSession(4);delete draft.mondayRevision;
   const changed=['mon__lower_b_ex_hip_thrust','mon__lower_b_ex_back_ext','mon__lower_b_ex6'];
   changed.forEach((id,index)=>draft.logs[id].forEach(set=>{set.weight=[200,35,0][index];set.reps=8;}));draft.initialLogs=JSON.parse(JSON.stringify(draft.logs));
   if(progressed){draft.logs[changed[0]][0].completed=true;draft.logs[changed[1]][2].skipped=true;draft.startTime=draft.lastInteractionAt=new Date().toISOString();draft.warmups[changed[0]]=[{setNum:1,weight:40,reps:10,completed:true,exerciseName:'Machine Hip Thrust / Glute Drive'}];}
   localStorage.clear();localStorage.setItem(app.storageKeys.routine,JSON.stringify(routine));localStorage.setItem(app.storageKeys.routineRev,'16');localStorage.setItem(app.getSessionKey(draft.dayId),JSON.stringify(draft));localStorage.setItem('gym_last_active_day_v1',draft.dayId);return draft;
  },{routine:legacy,progressed});
  await page.reload();await page.selectOption('#workoutDayPicker','4');
  if(progressed){
   assert.equal(await page.locator('.exercise-name').textContent(),'Machine Hip Thrust / Glute Drive');
   const preserved=await page.evaluate(()=>app.session);
   for(const id of ids)assert.deepEqual(preserved.logs[id].map(s=>[s.weight,s.reps,s.completed,!!s.skipped]),original.logs[id].map(s=>[s.weight,s.reps,s.completed,!!s.skipped]));
   assert.equal(preserved.swaps[ids[1]].programSets,3);assert.equal(preserved.lastInteractionAt,original.lastInteractionAt);
   assert.equal(await page.evaluate(()=>app.startNewSession()),true);
  }
  await focus(page,ids[1]);assert.equal(await page.locator('.exercise-name').textContent(),'Seated Hip Abduction');assert.equal(await page.locator('.set-row').count(),2);assert.equal(await page.locator('.set-weight-input').first().inputValue(),'');
 }
 await focus(page,ids[0]);
 if(width===402){await page.locator('.app-toast').waitFor({state:'detached'});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(root,'docs/monday-rdl-preview.png')});}
 for(const id of ids){await focus(page,id);const layout=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,small:[...document.querySelectorAll('button')].filter(el=>el.getClientRects().length&&el.getBoundingClientRect().height<43.5).map(el=>el.textContent.trim()),tiny:[...document.querySelectorAll('input:not([type=checkbox]),select')].filter(el=>el.getClientRects().length&&parseFloat(getComputedStyle(el).fontSize)<16).map(el=>el.className)}));assert.equal(layout.overflow,false);assert.deepEqual(layout.small,[]);assert.deepEqual(layout.tiny,[]);}
 await page.selectOption('#workoutDayPicker','1');const friday=await page.evaluate(()=>app.routine[1].exercises.find(ex=>ex.name==='Leg Extension'));assert.equal(friday.sets,4);assert.equal(friday.targetReps,'8–12');
 assert.deepEqual(errors,[]);report.push({width,freshDefaults:'passed',untouchedMigration:'passed',progressedDraftPreserved:'passed',newBaselines:'passed',fridayUnchanged:true,errors});await context.close();
}
console.log(JSON.stringify(report,null,2));}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
