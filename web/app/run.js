/* Measuring runs: build the request from the selected sheets, follow the server's live events, turn the answer into
   items with the engine (cfBuild / finBuild / stlBuild), and reopen saved runs from the project history. */
const TOOLS_UI={
 conc:{name:'Concrete & Formwork',short:'Concrete',icon:'cube',desc:'Columns, beams, slabs, walls, footings',items:['Column','Beam','Slab','Wall','Foundation','Stair']},
 fin:{name:'Finishes',short:'Finishes',icon:'room',desc:'Floors, walls, skirting, ceilings, waterproofing',items:['Floor finish','Wall finish','Skirting','Suspended ceiling','Ceiling finish','Waterproofing']},
 steel:{name:'Steel Structure',short:'Steel',icon:'beam',desc:'Members, connections, plates and bolts',items:['Column','Beam','Bracing','Purlin & girt','Rafter & truss','Secondary steel','Connections']},
};
let tid=0;
const RUN={hooks:{}};   // hooks: onUpdate(t), onDone(t)
const upd=t=>{if(RUN.hooks.onUpdate)RUN.hooks.onUpdate(t)};
// stable id of an item across sessions (used to keep "checked" marks)
const ckKey=e=>{const s=sheetOf(e.sheet);return s?`${s.drawingId}:${s.page}:${e.tag}`:e.id};

function newTask({toolId,ps,items,fast=true,rooms=true,lines=false}){
 const kinds=items.flatMap(e=>CF_KIND[e]||[]);
 return {id:++tid,real:true,tool:TOOLS_UI[toolId].name,toolId,ps,els:items,kinds,model:AI_NAME,effort:'high',detail:'original',text:false,prompt:'',
  rounds:true,perRound:150,lanes:fast?8:1,live:true,costCap:0,tier:'default',later:'medium',compact:true,
  areas:Object.fromEntries(ps.map(p=>[p,areaOf(p)])),lines:!!lines&&!(toolId==='fin'&&rooms),rooms:toolId==='fin'&&!!rooms,
  startAt:Date.now(),status:'run',jobs:ps.map(p=>({p,st:'wait',notes:[]})),run:{st:'wait',think:'',out:0,notes:[]},srcs:[],bySrc:{},elements:[],res:null,checks:new Set()};
}
async function startMeasure(t,projectId){
 const r=t.run;r.t0=Date.now();const sheets=[];
 try{
  if(t.lines)for(const p of t.ps){const n=(await linesIn(p,areaOf(p)).catch(()=>[])).length;if(n>LINES_MAX)throw new Error(`${shName(p)} has ${n.toLocaleString()} PDF lines in its area (limit ${LINES_MAX.toLocaleString()}). Choose a smaller area.`)}
  for(const j of t.jobs){
   if(t.status!=='run')return;
   j.st='render';r.st='render';upd(t);
   const s=sheetOf(j.p),x=await cfSheet(t,j);x.drawing=s.drawingId;x.area=areaOf(j.p);sheets.push(x);
   j.st='ready';upd(t);
  }
  if(t.status!=='run')return;
  setRun(t,'upload');upd(t);
  const k=await api('takeoff/jobs',{method:'POST',body:{projectId,tool:t.toolId,dpi:CF_DPI,kinds:t.kinds,items:t.els,rounds:true,perRound:t.perRound,lanes:t.lanes,live:t.live,compact:true,sheets,options:{fast:t.lanes>1,rooms:t.rooms,lines:t.lines}}});
  r.jobId=k.id;t.runId=k.runId;
  if(t.status!=='run'){api(`takeoff/jobs/${k.id}/cancel`,{method:'POST'}).catch(()=>{});return}
  setRun(t,'queued');listen(t);
 }catch(e){if(t.status!=='run')return;fail(t,e.message||String(e));if(e.code==='no_credits')toast(e.message,{bad:true,action:()=>go('/account'),label:'Top up',ms:8000})}
}
function listen(t){
 const r=t.run,es=new EventSource(`/api/takeoff/jobs/${r.jobId}/events`);r.es=es;
 es.onmessage=m=>{let ev;try{ev=JSON.parse(m.data)}catch(e){return}onEvent(t,ev)};
 es.onerror=()=>{if(r.final||es.readyState!==EventSource.CLOSED)return;r.final=true;fail(t,'Lost the connection to the server. Reopen the run from History.')};
}
function fail(t,msg,st){const r=t.run;if(!terminal(r)){r.st=st||'error';r.err=msg;r.t1=Date.now()}t.jobs.forEach(j=>{if(!terminal(j)){j.st=st||'error';j.err=msg}});t.status=st==='cx'?'cx':'err';t.endAt=Date.now();upd(t);if(RUN.hooks.onDone)RUN.hooks.onDone(t)}
function onEvent(t,ev){
 const r=t.run;
 switch(ev.type){
  case 'status':if(!terminal(r)&&JOB_ST[ev.status]&&!['done','error'].includes(ev.status))setRun(t,ev.status);break;
  case 'thinking':if(ev.lane)laneOf(r,ev.lane).think+=ev.delta||'';else r.think+=ev.delta||'';
   r.thinkFrom=ev.lane||0;r.thinkAt=Date.now();if(RUN.hooks.onThink)RUN.hooks.onThink(t);return;   // live thinking: only the thinking box redraws
  case 'lanes':r.laneWait=ev.items||[];r.laneLimit=ev.limit;break;
  case 'lane':{const L=laneOf(r,ev.lane);L.st=ev.state;L.why=ev.why||'';break}
  case 'output':r.out=ev.chars||0;break;
  case 'note':r.notes.push(ev.text);break;
  case 'round':r.round=ev.round;r.sweep=ev.sweep||0;r.out=0;if(ev.lane){const L=laneOf(r,ev.lane);L.item=ev.item;L.k=ev.laneRound;L.st='run'}break;
  case 'live':if(terminal(r))break;r.result=ev.result;liveSoon(t);return;   // rebuilt at most every few seconds
  case 'partial':(r.rounds=r.rounds||[]).push({round:ev.round,lane:ev.lane,added:ev.added,total:ev.total});if(ev.lane)laneOf(r,ev.lane).added+=ev.added||0;r.result=ev.result;r.remaining=ev.remaining||[];liveSoon(t);break;
  case 'result':clearTimeout(t._lt);t._lt=0;r.st='done';r.t1=Date.now();r.result=ev.result;r.stopped=ev.stopped;r.complete=ev.complete;t.credits=ev.credits||0;
   if(ev.balance!=null)setCredits(ev.balance);
   if(ev.result)rebuild(t,true);else t.jobs.forEach(j=>{j.st='error';j.err='No result'});
   t.status='ok';t.endAt=Date.now();break;
  case 'error':if(ev.balance!=null)setCredits(ev.balance);t.credits=ev.credits||0;fail(t,ev.error,ev.code==='cancelled'?'cx':'error');return;
  case 'end':r.final=true;r.es&&r.es.close();if(!terminal(r))fail(t,'The server ended the run without an answer.');else if(RUN.hooks.onDone)RUN.hooks.onDone(t);return;
 }
 upd(t);
}
// The thinking being written now (planning or the part that wrote last), as plain text, and its source.
function thinkNow(t){const r=t.run,n=r.thinkFrom||0,L=n?(r.lanes||{})[n]:null,txt=(L?L.think:r.think)||'';
 return {who:n?`Part ${n}${L&&L.item?': '+L.item:''}`:'Planning',text:txt.replace(/\*\*/g,'').replace(/\n{3,}/g,'\n\n').trim()}}
function thinkAll(t){const r=t.run,parts=Object.values(r.lanes||{}).filter(L=>L.think);
 return [r.think?`PLANNING\n${r.think}`:'',...parts.map(L=>`PART ${L.n}${L.item?' · '+L.item:''}\n${L.think}`)].filter(Boolean).join('\n\n').replace(/\*\*/g,'')}
// Live updates: keep only the latest answer and rebuild the items from it at most every 2.5 s (longer when a rebuild
// itself is slow, e.g. many rooms), so the page never falls behind the server. The final result is applied at once.
function liveSoon(t){
 if(t._lt)return;
 t._lt=setTimeout(()=>{t._lt=0;if(terminal(t.run))return;const a=performance.now();rebuild(t,false);t._lms=performance.now()-a;upd(t)},Math.max(2500,3*(t._lms||0)));
}
function rebuild(t,final){
 const G=t.run.result;if(!G)return;
 t.elements=[];t.bySrc={};t.srcs=[];
 const build=t.toolId==='fin'?finBuild:t.toolId==='steel'?stlBuild:cfBuild;
 t.jobs.forEach((j,i)=>{try{build(t,j,G.sheets[i]);if(final)j.st='done'}catch(e){console.error(e);if(final){j.st='error';j.err='This sheet could not be turned into items: '+e.message}}});
 t.elements.forEach(e=>{if(t.checks.has(ckKey(e)))e.status='ck'});
 t.res=summary(t);
}
function stopMeasure(t){
 const r=t.run;
 // keep what is here and finish now: used when the server no longer has the run, or does not answer within 15 s
 const settle=()=>{if(t.status!=='run')return;clearTimeout(t._lt);t._lt=0;if(r.es)r.es.close();r.final=true;
  if(r.result){r.st='done';r.t1=Date.now();r.stopped=r.stopped||'Stopped by the user';rebuild(t,true);t.status='ok';t.endAt=Date.now();upd(t);if(RUN.hooks.onDone)RUN.hooks.onDone(t)}
  else fail(t,'Stopped','cx')};
 if(r.jobId){api(`takeoff/jobs/${r.jobId}/cancel`,{method:'POST'}).catch(settle);
  if(r.result&&!terminal(r)){r.stopping=true;upd(t);setTimeout(settle,15000);return}}   // normally the server sends what it found within seconds
 if(r.es)r.es.close();r.final=true;t.status='cx';fail(t,'Stopped','cx');
}
function toggleCheck(t,e){
 const k=ckKey(e);if(e.status==='ck'){e.status=e.why?'rv':'ok';t.checks.delete(k)}else{e.status='ck';t.checks.add(k)}
 t.res=summary(t);if(t.runId)api('runs/'+t.runId,{method:'PATCH',body:{checks:[...t.checks]}}).catch(()=>{});
}
// a run from the history: its saved answer, rebuilt on the drawings as they are now
async function openSavedRun(run){
 const S=(run.settings.sheets||[]).map(x=>DOC.sheets.find(s=>s.drawingId===x.drawing&&s.page===x.page)||null);
 const ps=S.filter(Boolean).map(s=>s.p);
 const t=newTask({toolId:run.tool,ps,items:run.settings.items&&run.settings.items.length?run.settings.items:TOOLS_UI[run.tool].items,fast:true,rooms:!!(run.settings.options||{}).rooms});
 t.runId=run.id;t.startAt=run.createdAt;t.endAt=run.finishedAt;t.credits=run.credits;t.checks=new Set(run.checks||[]);
 t.jobs=S.map((s,i)=>s?{p:s.p,st:'done',notes:[]}:null);
 if(run.status==='running'&&run.jobId){t.jobs=t.jobs.filter(Boolean);t.run.jobId=run.jobId;await prepJobs(t);setRun(t,'queued');listen(t);return t}
 t.status=run.status==='done'?'ok':run.status==='cancelled'?'cx':'err';t.run.st=run.status==='done'?'done':'error';t.run.err=run.error||'';
 if(run.result){
  // the answer has one entry per sheet sent; sheets removed since then are skipped
  const G={...run.result,sheets:run.result.sheets.filter((_,i)=>t.jobs[i])};t.jobs=t.jobs.filter(Boolean);
  await prepJobs(t);t.run.result=G;rebuild(t,true);
 }else t.jobs=t.jobs.filter(Boolean);
 return t;
}
// what a build needs from each sheet: page size, the PDF's vector lines (snapping) and its text positions (door tags)
async function prepJobs(t){
 for(const j of t.jobs){const s=sheetOf(j.p),page=await pageOf(s),vp=page.getViewport({scale:1});j.pw=vp.width;j.ph=vp.height;j.img={dpi:CF_DPI};
  try{j.vec=await vectorIndex(page)}catch(e){j.vec=null}
  try{const tc=await page.getTextContent();j.texts=tc.items.filter(i=>i.str&&i.str.trim()).map(i=>{const m=pdfjs.Util.transform(vp.transform,i.transform),h=Math.hypot(m[2],m[3]);return {s:i.str,cx:m[4]+(i.width||0)/2,cy:m[5]-h/2}})}catch(e){j.texts=null}}
}
// one line of status for a running task
function runStatus(t){
 const r=t.run;if(t.status==='ok')return r.stopped&&!r.complete?'Finished early: '+r.stopped:'Finished';if(t.status==='cx')return 'Stopped';if(t.status==='err')return r.err||'Failed';
 if(r.stopping)return 'Stopping… the results so far are kept';
 if(r.st==='render'){const n=t.jobs.filter(j=>!['wait','render'].includes(j.st)).length;return `Preparing sheet ${Math.min(n+1,t.jobs.length)} of ${t.jobs.length}`}
 if(r.st==='upload')return 'Sending the drawings';if(r.st==='queued')return 'Waiting for a free slot';
 const L=Object.values(r.lanes||{});if(L.length){const run=L.filter(x=>x.st==='run').length,done=L.filter(x=>x.st==='done').length;return `Measuring in parts: ${done} done, ${run} running${(r.laneWait||[]).length?`, ${r.laneWait.length} waiting`:''}`}
 if(r.round>1)return `Measuring: round ${r.round}`;
 return r.st==='writing'?'Measuring: writing results':'Reading the drawings';
}
