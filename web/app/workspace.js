/* Project workspace: drawings on the left, the sheet in the middle, Measure / Results / History on the right. */
const WS={project:null,sel:new Set(),open:null,tool:'conc',items:{},fast:true,rooms:true,lines:false,tab:'measure',task:null,active:null,el:null,busy:false};
const toolItems=id=>WS.items[id]||(WS.items[id]=new Set(TOOLS_UI[id].items.filter(x=>x!=='Connections'||id==='steel')));

async function workspacePage(id){
 $('#app').innerHTML=shell('projects',`<div class="ws"><aside id="wsL"></aside><div class="stage" id="stage"></div><section class="panel" id="wsR"></section></div>`);
 viewerMount($('#stage'));
 VIEW.onSelect=e=>{WS.el=e;renderDetail()};
 DOCX.onChange=()=>{renderLeft();if(WS.tab==='measure')renderRight()};
 RUN.hooks={onThink:t=>{if(t===WS.active)thinkUpdate(t)},onUpdate:t=>{if(t===WS.task){viewerSet(t.elements);if(WS.el)WS.el=t.elements.find(x=>x.id===WS.el.id)||null}renderRightSoon()},
  onDone:async t=>{renderRight();if(t.status==='ok'){toast(`${t.tool}: ${plural(t.elements.length,'item')} measured${t.credits?` · ${t.credits} credits used`:''}.`,{action:()=>{WS.tab='results';renderRight()},label:'See results',ms:7000})}else if(t.status==='err')toast(t.run.err||'The measurement failed.',{bad:true,ms:7000});refreshRuns()}};
 $('#wsL').innerHTML='<div class="pane"><span class="spin"></span> Opening project…</div>';
 try{const {project}=await api('projects/'+id);WS.project=project;Object.assign(WS,{sel:new Set(),open:null,task:null,active:null,el:null,tab:'measure'})}
 catch(e){$('#app').innerHTML=shell('projects',`<div class="page"><div class="empty"><h2>Project not found</h2><p>${esc(e.message)}</p><a class="btn" href="#/projects">Back to projects</a></div></div>`);return}
 renderLeft();renderRight();
 await loadProjectDoc(WS.project,(m)=>{$('#wsL .pane')&&($('#wsL .pane').innerHTML=`<span class="spin"></span> ${esc(m)}`)});
 renderLeft();
 if(DOC.sheets.length){WS.open=DOC.sheets[0].p;await viewerOpen(sheetOf(WS.open));renderLeft()}
 // a run still going on the server (the page was reloaded): follow it again
 const live=WS.project.runs.find(r=>r.status==='running');
 if(live){try{const {run}=await api('runs/'+live.id);const t=await openSavedRun(run);WS.task=WS.active=t;viewerSet(t.elements);renderRight()}catch(e){}}
}

/* ---- left: drawings ---- */
function renderLeft(){
 const L=$('#wsL');if(!L||!WS.project)return;
 const files=DOC.files;
 L.innerHTML=`<div class="head"><input class="pname" id="pName" value="${esc(WS.project.name)}" title="Rename project"><button class="btn sm pri" id="upBtn">${icon('upload')}Upload</button><input type="file" id="upIn" accept="application/pdf,.pdf" multiple hidden></div>
  <div class="scroll"><div class="sheets">${files.length?files.map(f=>{const S=DOC.sheets.filter(s=>s.file===f),all=S.length&&S.every(s=>WS.sel.has(s.p));return `<div class="fgroup"><div class="fh"><span class="cbx ${all?'on':''}" data-fall="${f.fid}" title="Select all sheets of this file"></span><span title="${esc(f.name)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span><div class="sp"></div><button class="btn ghost sm" data-frm="${f.fid}" title="Remove this drawing">${icon('trash')}</button></div>
   ${S.map(s=>{const a=s.area;return `<div class="sheet ${WS.open===s.p?'open':''}" data-p="${s.p}"><span class="cbx ${WS.sel.has(s.p)?'on':''}" data-sel="${s.p}"></span><span class="th" data-th="${s.p}">${a?`<i style="left:${a.x*100}%;top:${a.y*100}%;width:${a.w*100}%;height:${a.h*100}%"></i>`:''}</span>
    <span class="nm"><div title="${esc(sname(s))}">${esc(sname(s))}</div><small>${s.ai.status==='running'||s.ai.status==='queued'?'<span class="spin" style="width:10px;height:10px;border-width:1.5px"></span>Reading title…':esc([TYPE_TAG[s.meta.type]&&TYPE_TAG[s.meta.type].n,s.meta.scale,s.floor].filter(Boolean).join(' · ')||'—')}</small></span></div>`}).join('')}</div>`}).join('')
   :`<div class="dropzone" id="dz">${icon('upload')}<div style="margin-top:6px"><b>Upload PDF drawings</b></div><div class="small faint">Drop files here or click to choose</div></div>`}</div></div>
  <div class="pane small muted" style="border-top:1px solid var(--line)">${WS.sel.size?`${plural(WS.sel.size,'sheet')} selected for measuring`:'Tick the sheets you want to measure.'}</div>`;
 L.querySelectorAll('[data-th]').forEach(el=>{const s=sheetOf(+el.dataset.th);if(s)paintThumb(el,s)});
 const up=$('#upIn');$('#upBtn').onclick=()=>up.click();up.onchange=()=>{const f=[...up.files];up.value='';uploadPdfs(f).then(renderLeft)};
 const dz=$('#dz');if(dz)dz.onclick=()=>up.click();
 $('#pName').onchange=async e=>{const n=e.target.value.trim();if(!n)return;try{const {project}=await api('projects/'+WS.project.id,{method:'PATCH',body:{name:n}});WS.project.name=project.name}catch(x){errToast(x)}};
}
document.addEventListener('click',e=>{
 if(!e.target.closest('#wsL'))return;
 const fa=e.target.closest('[data-fall]');if(fa){const S=DOC.sheets.filter(s=>s.file.fid===+fa.dataset.fall),all=S.every(s=>WS.sel.has(s.p));S.forEach(s=>all?WS.sel.delete(s.p):WS.sel.add(s.p));renderLeft();renderRight();return}
 const fr=e.target.closest('[data-frm]');if(fr){removeFile(+fr.dataset.frm);return}
 const c=e.target.closest('[data-sel]');if(c){const p=+c.dataset.sel;WS.sel.has(p)?WS.sel.delete(p):WS.sel.add(p);renderLeft();renderRight();return}
 const r=e.target.closest('.sheet[data-p]');if(r){const p=+r.dataset.p;if(WS.open!==p){WS.open=p;WS.el=null;renderDetail();viewerOpen(sheetOf(p)).then(()=>{if(WS.task)viewerSet(WS.task.elements)});renderLeft()}}
});
['dragover','dragleave','drop'].forEach(ev=>document.addEventListener(ev,e=>{
 const L=e.target.closest&&e.target.closest('#wsL');if(!L||!(e.dataTransfer&&[...e.dataTransfer.types].includes('Files')))return;e.preventDefault();
 const dz=$('#dz');if(dz)dz.classList.toggle('over',ev==='dragover');
 if(ev==='drop')uploadPdfs([...e.dataTransfer.files]).then(renderLeft);
}));

/* ---- right: Measure / Results / History ---- */
let rT=0;function renderRightSoon(){if(rT)return;rT=setTimeout(()=>{rT=0;renderRight()},250)}
function renderRight(){
 const R=$('#wsR');if(!R)return;
 const nRuns=(WS.project&&WS.project.runs||[]).length;
 R.innerHTML=`<div class="tabs"><button data-tab="measure" class="${WS.tab==='measure'?'on':''}">Measure</button><button data-tab="results" class="${WS.tab==='results'?'on':''}">Results${WS.task&&WS.task.status==='ok'?'':''}</button><button data-tab="history" class="${WS.tab==='history'?'on':''}">History${nRuns?` <span class="faint">${nRuns}</span>`:''}</button></div>
  <div class="scroll">${WS.tab==='measure'?measurePane():WS.tab==='results'?resultsPane():historyPane()}</div>${WS.tab==='measure'?runBox():''}`;
 R.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{WS.tab=b.dataset.tab;renderRight()});
}
function measurePane(){
 const sel=DOC.sheets.filter(s=>WS.sel.has(s.p)),its=toolItems(WS.tool);
 return `<div class="pane">
  <div class="step"><div class="lbl"><b>1</b>What to measure</div><div class="tools">${Object.entries(TOOLS_UI).map(([k,v])=>`<div class="tool ${WS.tool===k?'on':''}" data-tool="${k}"><span class="ico">${icon(v.icon)}</span><div><b>${v.name}</b><small>${v.desc}</small></div></div>`).join('')}</div></div>
  <div class="step"><div class="lbl"><b>2</b>Items</div><div class="chips">${TOOLS_UI[WS.tool].items.map(x=>`<span class="chip ${its.has(x)?'on':''}" data-item="${esc(x)}">${esc(x)}</span>`).join('')}</div></div>
  <div class="step"><div class="lbl"><b>3</b>Drawings</div>${sel.length?`<div class="sel-list">${sel.map(s=>`<div class="sel-row"><span title="${esc(sname(s))}">${esc(sname(s))}</span><button class="btn sm" data-area="${s.p}" title="Measure only part of this sheet">${icon('area')}${s.area?'Area set':'Whole sheet'}</button></div>`).join('')}</div>`:'<div class="note">Tick the sheets to measure in the list on the left. Plans, sections, schedules and details can go together: they are read as one set.</div>'}</div>
  <details class="step"><summary class="lbl" style="cursor:pointer">More options</summary>
   <div class="toggle ${WS.fast?'on':''}" data-opt="fast"><span class="sw"></span><div><b>Faster measuring</b><small>Large sheets are split into parts that are measured at the same time.</small></div></div>
   ${WS.tool==='fin'?`<div class="toggle ${WS.rooms?'on':''}" data-opt="rooms"><span class="sw"></span><div><b>Find rooms automatically</b><small>Rooms and door swings are found from the drawing's own lines; the AI names them and reads their finishes.</small></div></div>`:''}
   ${WS.tool!=='fin'||!WS.rooms?`<div class="toggle ${WS.lines?'on':''}" data-opt="lines"><span class="sw"></span><div><b>Use the PDF's lines</b><small>Sizes come straight from the drawn lines. Works best with an area on each sheet.</small></div></div>`:''}
  </details></div>`;
}
// live thinking: the last lines of what the AI is thinking now, so you can see the run is working
const runElapsed=t=>{const s=Math.round((Date.now()-(t.run.t0||t.startAt||Date.now()))/1000);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')} elapsed`};
function thinkBox(t){const th=thinkNow(t),out=t.run.out||0;
 return `<div class="think"><div class="th-h"><span class="dot"></span><b id="thWho">${esc(th.text?th.who+' · thinking':'Waiting for the first thoughts…')}</b><button class="btn ghost sm" id="thAll">All</button></div>
  <div class="th-t" id="thTx">${esc(th.text.slice(-600))}</div>${out?`<div class="small muted" id="thOut">Writing the answer · ${out.toLocaleString()} characters</div>`:'<div class="small muted" id="thOut"></div>'}</div>`}
function thinkUpdate(t){const el=$('#thTx');if(!el)return renderRightSoon();const th=thinkNow(t);el.textContent=th.text.slice(-600);el.scrollTop=el.scrollHeight;
 const w=$('#thWho');if(w)w.textContent=th.who+' · thinking';const e=$('#runEl');if(e)e.textContent=runElapsed(t)}
setInterval(()=>{const t=WS.active;if(t&&t.status==='run'){const e=$('#runEl');if(e)e.textContent=runElapsed(t)}},1000);
function runBox(){
 const t=WS.active,run=t&&t.status==='run';
 if(run){const L=Object.values(t.run.lanes||{});return `<div class="runbox"><div style="display:flex;align-items:center;gap:10px"><span class="spin"></span><b style="flex:1">${esc(runStatus(t))}</b><button class="btn sm danger" id="stopB">Stop</button></div>
  <div class="progress ind"><i></i></div><div class="small muted">${plural(t.elements.length,'item')} found so far · ${esc(t.tool)} · <span id="runEl">${runElapsed(t)}</span></div>
  ${thinkBox(t)}
  ${L.length?`<div class="parts">${L.slice(0,8).map(x=>`<div class="part">${x.st==='done'?icon('check'):'<span class="spin" style="width:10px;height:10px;border-width:1.5px"></span>'}<span title="${esc(x.item)}">${esc(x.item||'Part '+x.n)}</span><b>+${x.added}</b></div>`).join('')}</div>`:''}</div>`}
 const sel=DOC.sheets.filter(s=>WS.sel.has(s.p)),its=toolItems(WS.tool),c=APP.user.credits||0;
 const free=!!APP.cfg.testMode;   // test mode: no credits needed
 const why=!APP.cfg.measure?'Measuring is not available on this server yet.':!sel.length?'Select at least one sheet.':!its.size?'Choose at least one item.':!free&&c<=0?'You have no credits left.':'';
 return `<div class="runbox"><button class="btn pri block" id="runB" ${why?'disabled':''}>${icon('bolt')}Measure ${plural(sel.length,'sheet')}</button><div class="small ${!free&&c<=0?'':'muted'}" style="margin-top:8px;text-align:center">${why?esc(why):free?'Test mode · no credits used':`${c.toLocaleString()} credits available · charged by what the run uses`}${!free&&c<=0?' <a href="#/account">Top up</a>':''}</div></div>`;
}
document.addEventListener('click',e=>{
 if(!e.target.closest('#wsR'))return;
 if(e.target.closest('#thAll')){const t=WS.active;if(t)dialog(`<header><div><h2>Thinking so far</h2><p>${esc(t.tool)} · ${runElapsed(t)}</p></div><div class="sp"></div><button class="btn ghost sm" data-x>${icon('x')}</button></header><div class="body"><pre class="th-all">${esc(thinkAll(t)||'Nothing yet.')}</pre></div><footer><button class="btn pri" data-x>Close</button></footer>`,{wide:true});return}
 const tl=e.target.closest('[data-tool]');if(tl){WS.tool=tl.dataset.tool;renderRight();return}
 const it=e.target.closest('[data-item]');if(it){const S=toolItems(WS.tool),k=it.dataset.item;S.has(k)?S.delete(k):S.add(k);renderRight();return}
 const op=e.target.closest('[data-opt]');if(op){const k=op.dataset.opt;WS[k]=!WS[k];renderRight();return}
 const ar=e.target.closest('[data-area]');if(ar){editArea(sheetOf(+ar.dataset.area),{rooms:WS.tool==='fin'&&WS.rooms}).then(()=>{renderLeft();renderRight()});return}
 if(e.target.closest('#runB')){runMeasure();return}
 if(e.target.closest('#stopB')){if(WS.active)stopMeasure(WS.active);return}
 const rv=e.target.closest('[data-why]');if(rv){const E=(WS.task.elements||[]).filter(x=>x.status==='rv'&&whyKey(x)===rv.dataset.why);if(E.length)focusEl(E[0]);return}
 const hr=e.target.closest('[data-run]');if(hr){openRunFromHistory(+hr.dataset.run);return}
 const hd=e.target.closest('[data-rundel]');if(hd){e.stopPropagation();deleteRun(+hd.dataset.rundel);return}
 if(e.target.closest('#expB')){exportReport();return}
 const fx_=e.target.closest('[data-goel]');if(fx_){const el=WS.task.elements.find(x=>x.id===fx_.dataset.goel);if(el)focusEl(el)}
});
async function runMeasure(){
 const ps=DOC.sheets.filter(s=>WS.sel.has(s.p)).map(s=>s.p);if(!ps.length)return;
 if(WS.active&&WS.active.status==='run'){toast('A measurement is already running in this project.');return}
 const t=newTask({toolId:WS.tool,ps,items:[...toolItems(WS.tool)],fast:WS.fast,rooms:WS.rooms,lines:WS.lines});
 WS.task=WS.active=t;WS.el=null;renderDetail();viewerSet([]);renderRight();
 await startMeasure(t,WS.project.id);renderRight();
}
async function refreshRuns(){try{const {project}=await api('projects/'+WS.project.id);WS.project.runs=project.runs;renderRight()}catch(e){}}
async function openRunFromHistory(id){
 if(WS.active&&WS.active.runId===id){WS.task=WS.active;WS.tab='results';viewerSet(WS.task.elements);renderRight();return}
 try{const {run}=await api('runs/'+id);const t=await openSavedRun(run);WS.task=t;if(t.status==='run')WS.active=t;WS.el=null;renderDetail();WS.tab='results';
  const p=t.srcs[0]||t.ps[0];if(p&&WS.open!==p){WS.open=p;await viewerOpen(sheetOf(p));renderLeft()}viewerSet(t.elements);renderRight()}
 catch(e){errToast(e)}
}
async function deleteRun(id){if(!await confirmDlg('Delete this result?','The measured items and their history entry will be removed.',{ok:'Delete',danger:true}))return;
 try{await api('runs/'+id,{method:'DELETE'});if(WS.task&&WS.task.runId===id){WS.task=null;viewerSet([])}refreshRuns()}catch(e){errToast(e)}}
function resultsPane(){
 const t=WS.task;
 if(!t)return `<div class="pane"><div class="empty" style="padding:40px 10px"><div class="ico">${icon('layers')}</div><h3>No results yet</h3><p>Run a measurement, or open one from the History tab.</p></div></div>`;
 if(t.status==='run'&&!t.elements.length)return `<div class="pane"><div class="note"><span class="spin"></span> ${esc(runStatus(t))}. Items appear on the drawing as they are measured.</div></div>`;
 const res=t.res||summary(t),RV=t.elements.filter(e=>e.status==='rv'),G=rvGroups(RV);let cat={cols:[],rows:[]};
 try{cat=REPORTS[t.toolId].category(t)}catch(e){console.warn(e)}
 return `<div class="pane"><div style="display:flex;align-items:center;gap:10px;margin-bottom:14px"><div style="flex:1"><h3>${esc(t.tool)}</h3><div class="small faint">${fmtTime(t.endAt||t.startAt)}${t.credits?` · ${t.credits} credits`:''}${t.status==='run'?' · still measuring':''}</div></div><button class="btn sm" id="expB" ${t.elements.length?'':'disabled'}>${icon('download')}PDF report</button></div>
  ${t.run.stopped&&!t.run.complete?`<div class="note warn" style="margin-bottom:12px">${esc(t.run.stopped)}</div>`:''}
  <div class="tiles">${res.map((x,i)=>`<div class="tile ${i===3&&+String(x.v).replace(/\D/g,'')>0?'warn':''}"><b>${esc(String(x.v))}</b><small>${esc(x.l)}</small></div>`).join('')}</div>
  ${G.length?`<div class="step"><div class="lbl">Needs review</div><div class="reasons">${G.slice(0,8).map(g=>`<div class="reason" data-why="${esc(g.k)}"><span>${esc(g.label)}</span><b>${g.n}</b></div>`).join('')}</div></div>`:''}
  ${cat.rows.length?`<div class="step"><div class="lbl">Quantities</div><div class="qwrap"><table class="q"><thead><tr>${cat.cols.map(c=>`<th class="${c.align==='right'?'n':''}">${esc(c.l)}</th>`).join('')}</tr></thead><tbody>${cat.rows.map(r=>`<tr class="${r._tot?'tot':r._sub?'sub':''}">${cat.cols.map((c,i)=>`<td class="${c.align==='right'?'n':''}">${esc(r[i]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`:''}
  ${t.jobs.some(j=>j.err)?`<div class="note warn">${t.jobs.filter(j=>j.err).map(j=>esc(shName(j.p)+': '+j.err)).join('<br>')}</div>`:''}</div>`;
}
function historyPane(){
 const R=(WS.project&&WS.project.runs)||[];
 if(!R.length)return `<div class="pane"><div class="empty" style="padding:40px 10px"><div class="ico">${icon('clock')}</div><h3>No measurements yet</h3><p>Every measurement you run in this project is kept here.</p></div></div>`;
 const st=r=>r.status==='running'?'<span class="pill">Running</span>':r.status==='done'?'<span class="pill ok">Done</span>':r.status==='cancelled'?'<span class="pill">Stopped</span>':'<span class="pill bad">Failed</span>';
 return `<div class="pane"><div class="hist">${R.map(r=>{const u=TOOLS_UI[r.tool]||TOOLS_UI.conc;return `<div class="hrow ${WS.task&&WS.task.runId===r.id?'on':''}" data-run="${r.id}"><span class="ico">${icon(u.icon)}</span><div class="nm"><b>${u.name}</b><small>${fmtTime(r.createdAt)} · ${plural((r.settings.sheets||[]).length,'sheet')}${r.summary&&r.summary.items!=null?` · ${plural(r.summary.items,'item')}`:''}${r.credits?` · ${r.credits} credits`:''}</small></div>${st(r)}${r.status!=='running'?`<button class="btn ghost sm" data-rundel="${r.id}" title="Delete">${icon('trash')}</button>`:''}</div>`}).join('')}</div></div>`;
}
async function exportReport(){
 const t=WS.task;if(!t)return;const b=$('#expB');if(b){b.disabled=true;b.innerHTML='<span class="spin"></span>Building…'}
 try{const {bytes}=await generatePdf(t,{onProgress:m=>{if(b)b.innerHTML=`<span class="spin"></span>${esc(m.replace(/…$/,''))}`}});
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));a.download=`${WS.project.name} - ${t.tool} - Measure.AI.pdf`.replace(/[\\/:*?"<>|]/g,'_');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  toast('PDF report downloaded.')}catch(e){errToast(e)}finally{renderRight()}
}

/* ---- the selected item ---- */
// calculation lines come as HTML with <i>&lt;label&gt;</i> markers (engine I_()); everything else is escaped, so text
// read from a drawing can never become markup
function safeExpr(v){const s=String(v??''),re=/<i>&lt;([\s\S]*?)&gt;<\/i>/g;let out='',last=0,m;
 while((m=re.exec(s))){out+=esc(s.slice(last,m.index).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'))+`<i>&lt;${esc(m[1])}&gt;</i>`;last=re.lastIndex}
 return out+esc(s.slice(last).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&'))}
async function focusEl(e){
 if(WS.open!==e.sheet){WS.open=e.sheet;await viewerOpen(sheetOf(e.sheet));viewerSet(WS.task.elements);renderLeft()}
 viewerSelect(e.id);viewerZoomTo(e);WS.el=e;renderDetail();
}
function renderDetail(){
 const st=$('#stage');if(!st)return;let d=st.querySelector('.detail');const e=WS.el;
 if(!e){if(d)d.remove();return}
 if(!d){d=document.createElement('div');d.className='detail card';st.append(d)}
 const pill=e.status==='rv'?'<span class="pill warn">Needs review</span>':e.status==='ck'?'<span class="pill ok">Checked</span>':'<span class="pill">Measured</span>';
 d.innerHTML=`<button class="btn ghost sm x" id="dX">${icon('x')}</button><h3>${esc(e.name)} <span class="faint" style="font-weight:500">${esc(e.sec||'')}</span></h3><div class="small muted" style="margin-bottom:8px">${esc(e.type)}${e.loc&&e.loc!=='—'?' · '+esc(e.loc):''}</div>${pill}
  ${e.why&&e.status!=='ok'?`<div class="note warn" style="margin-top:10px">${esc(e.why)}</div>`:''}
  ${(e.expr||[]).map(([k,v])=>`<div class="expr"><b>${esc(k)}</b>${safeExpr(v)}</div>`).join('')}
  <dl>${(e.attrs||[]).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
  ${e.note?`<div class="small faint" style="margin-bottom:10px">${esc(e.note)}</div>`:''}
  <button class="btn sm ${e.status==='ck'?'':'pri'}" id="dCk">${icon('check')}${e.status==='ck'?'Unmark checked':'Mark as checked'}</button>`;
 d.querySelector('#dX').onclick=()=>{WS.el=null;viewerSelect(null);renderDetail()};
 d.querySelector('#dCk').onclick=()=>{toggleCheck(WS.task,e);drawOverlay();renderLegend();renderDetail();if(WS.tab==='results')renderRight()};
}
