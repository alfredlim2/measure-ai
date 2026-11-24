/* The open project's drawings: PDFs loaded from the server, one sheet per imported page, AI sheet naming in the
   background, sheet details (name, scale, level, analysis area) saved back to the server. */
let nextP=1;
const DOCX={projectId:null,onChange:null,saveT:new Map(),q:[],running:0};
const changed=()=>{if(DOCX.onChange)DOCX.onChange()};

function sheetFromRecord(file,r){
 const single=file.pages===1;
 const meta={placeholder:r.name||(single?baseName(file.name):`${baseName(file.name)}_sheet${pad3(r.page)}`),label:r.number||'',title:r.title||'',scale:r.scale||'',type:r.type||'',discipline:r.discipline||'',group:'',kind:''};
 const s={p:nextP++,file,page:r.page,meta,floor:r.level||'',ai:{status:r.named?'done':'queued'},area:r.area||null,drawingId:file.fid};
 if(r.named)setGroup(s);else meta.group=single?'Drawings':'Not named yet';
 return s;
}
const recordOf=s=>({page:s.page,name:s.meta.placeholder,number:s.meta.label,title:s.meta.title,scale:s.meta.scale,level:s.floor,discipline:s.meta.discipline,type:s.meta.type,named:s.ai.status!=='queued'&&s.ai.status!=='running',area:s.area||null});
function saveDrawing(fid){
 clearTimeout(DOCX.saveT.get(fid));
 DOCX.saveT.set(fid,setTimeout(()=>{api('drawings/'+fid,{method:'PATCH',body:{sheets:DOC.sheets.filter(s=>s.file.fid===fid).map(recordOf)}}).catch(errToast)},600));
}
async function openPdf(bytes){return pdfjs.getDocument({data:new Uint8Array(bytes.slice(0)),isEvalSupported:false}).promise}
async function loadProjectDoc(project,onProgress){
 DOC={files:[],sheets:[]};DOCX.projectId=project.id;DOCX.q=[];
 for(const [i,d] of project.drawings.entries()){
  if(onProgress)onProgress(`Opening ${d.fileName}…`,i/project.drawings.length);
  try{
   const r=await fetch(`/api/drawings/${d.id}/file`,{credentials:'same-origin'});if(!r.ok)throw new Error('could not download');
   const bytes=await r.arrayBuffer(),pdf=await openPdf(bytes);
   const file={fid:d.id,name:d.fileName,size:d.size,bytes,pdf,pages:pdf.numPages,count:d.sheets.length};
   DOC.files.push(file);d.sheets.forEach(rec=>DOC.sheets.push(sheetFromRecord(file,rec)));
  }catch(e){toast(`${d.fileName} could not be opened (${e.message}).`,{bad:true})}
 }
 enqueueNaming(DOC.sheets.filter(s=>s.ai.status==='queued'));
}

/* ---- upload: pick pages, send the file, name the sheets ---- */
async function uploadPdfs(files){
 for(const f of files){
  if(!/\.pdf$/i.test(f.name)&&f.type!=='application/pdf'){toast(`${f.name} is not a PDF.`,{bad:true});continue}
  if(APP.cfg&&f.size>APP.cfg.maxUploadMb*1048576){toast(`${f.name} is larger than ${APP.cfg.maxUploadMb} MB.`,{bad:true});continue}
  let bytes,pdf;
  try{bytes=await f.arrayBuffer();pdf=await openPdf(bytes)}catch(e){toast(`${f.name} could not be read as a PDF.`,{bad:true});continue}
  let pages=Array.from({length:pdf.numPages},(_,i)=>i+1);
  if(pdf.numPages>1){const L=await pickPages(pdf,f.name);if(!L||!L.length)continue;pages=L}
  toast(`Uploading ${f.name}…`,{ms:2500});
  try{
   const {drawing}=await api(`projects/${DOCX.projectId}/drawings`,{method:'POST',raw:bytes,headers:{'Content-Type':'application/pdf','X-File-Name':encodeURIComponent(f.name),'X-Pages':String(pdf.numPages)}});
   const file={fid:drawing.id,name:drawing.fileName,size:drawing.size,bytes,pdf,pages:pdf.numPages,count:pages.length};
   DOC.files.push(file);const added=pages.map(page=>sheetFromRecord(file,{page}));DOC.sheets.push(...added);
   saveDrawing(file.fid);changed();enqueueNaming(added);
   toast(`Added ${plural(added.length,'sheet')} from ${f.name}. Naming them in the background.`);
  }catch(e){errToast(e)}
 }
}
async function removeFile(fid){
 const f=DOC.files.find(x=>x.fid===fid);if(!f)return;
 if(!await confirmDlg('Remove drawing?',`${f.name} and its ${plural(DOC.sheets.filter(s=>s.file===f).length,'sheet')} will be removed from this project. Past results stay in the history.`,{ok:'Remove',danger:true}))return;
 try{await api('drawings/'+fid,{method:'DELETE'});DOC.files=DOC.files.filter(x=>x!==f);DOC.sheets=DOC.sheets.filter(s=>s.file!==f);changed()}catch(e){errToast(e)}
}

/* ---- AI sheet naming: number, title, scale, type, level ---- */
function enqueueNaming(L){if(!APP.cfg||!APP.cfg.naming)return;L.forEach(s=>{s.ai={status:'queued'};if(!DOCX.q.includes(s))DOCX.q.push(s)});pumpNaming()}
function pumpNaming(){
 const max=(APP.cfg&&APP.cfg.concurrency)||3;
 while(DOCX.running<max&&DOCX.q.length){const s=DOCX.q.shift();if(!DOC.sheets.includes(s))continue;DOCX.running++;nameSheet(s).finally(()=>{DOCX.running--;pumpNaming()})}
}
async function nameSheet(s){
 s.ai={status:'running'};changed();
 try{const payload=await buildPayload(s,false);const j=await api('sheet-name',{method:'POST',body:payload});applyName(s,j)}
 catch(e){s.ai={status:'failed'};if(['no_key','bad_key','no_credits'].includes(e.code)){DOCX.q=[]}}
 saveDrawing(s.file.fid);changed();
}

/* ---- thumbnails ---- */
const THUMBS=new Map();
function thumbOf(s){
 if(!THUMBS.has(s.p))THUMBS.set(s.p,(async()=>{const pg=await pageOf(s),v=pg.getViewport({scale:1}),k=96/Math.max(v.width,v.height),vp=pg.getViewport({scale:k});
  const c=document.createElement('canvas');c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);await pg.render({canvasContext:x,viewport:vp}).promise;return c})());
 return THUMBS.get(s.p);
}
async function paintThumb(el,s){try{const c=await thumbOf(s);if(!el.isConnected)return;const cv=document.createElement('canvas');cv.width=c.width;cv.height=c.height;cv.getContext('2d').drawImage(c,0,0);el.prepend(cv)}catch(e){}}

/* ---- page picker for multi-page PDFs ---- */
function pickPages(pdf,name){
 const n=pdf.numPages,sel=new Set(Array.from({length:n},(_,i)=>i+1));
 return dialog(`<header><div><h2>Choose pages to import</h2><p>${esc(name)} has ${n} pages. Click a page to leave it out.</p></div><div class="sp"></div><button class="btn ghost sm" data-x>${icon('x')}</button></header>
  <div class="body"><div style="display:flex;gap:8px;margin-bottom:12px"><button class="btn sm" id="pkAll">Select all</button><button class="btn sm" id="pkNone">Select none</button></div><div class="pgrid" id="pkG">${Array.from({length:n},(_,i)=>`<div class="pcell on" data-i="${i+1}"><div class="th"></div><div class="lb"><span class="cbx on"></span>Page ${i+1}</div></div>`).join('')}</div></div>
  <footer><span class="muted small" id="pkN"></span><div class="sp"></div><button class="btn" data-x>Cancel</button><button class="btn pri" id="pkGo"></button></footer>`,{wide:true,onOpen:(d,close)=>{
  const G=d.querySelector('#pkG'),paint=()=>{G.querySelectorAll('.pcell').forEach(c=>{const on=sel.has(+c.dataset.i);c.classList.toggle('on',on);c.querySelector('.cbx').classList.toggle('on',on)});d.querySelector('#pkN').textContent=`${sel.size} of ${n} selected`;const b=d.querySelector('#pkGo');b.textContent=`Import ${plural(sel.size,'page')}`;b.disabled=!sel.size};
  G.onclick=e=>{const c=e.target.closest('.pcell');if(!c)return;const i=+c.dataset.i;sel.has(i)?sel.delete(i):sel.add(i);paint()};
  d.querySelector('#pkAll').onclick=()=>{for(let i=1;i<=n;i++)sel.add(i);paint()};d.querySelector('#pkNone').onclick=()=>{sel.clear();paint()};
  d.querySelector('#pkGo').onclick=()=>close([...sel].sort((a,b)=>a-b));paint();
  const io=new IntersectionObserver(es=>es.forEach(async en=>{if(!en.isIntersecting)return;io.unobserve(en.target);const i=+en.target.closest('.pcell').dataset.i;
   try{const pg=await pdf.getPage(i),v=pg.getViewport({scale:1}),k=180/Math.max(v.width,v.height),vp=pg.getViewport({scale:k}),c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);await pg.render({canvasContext:x,viewport:vp}).promise;en.target.append(c)}catch(e){}}),{root:d.querySelector('.body')});
  G.querySelectorAll('.th').forEach(t=>io.observe(t));
 }});
}

/* ---- analysis area: draw a box; only that part of the sheet is measured ---- */
function editArea(s,{rooms=false}={}){
 let box=s.area?{...s.area}:null,show=null;
 return dialog(`<header><div><h2>Area to measure</h2><p>${esc(sname(s))} · drag a box around the part you want measured. Leave it empty to measure the whole sheet.</p></div><div class="sp"></div><button class="btn ghost sm" data-x>${icon('x')}</button></header>
  <div class="body" style="display:flex;flex-direction:column;gap:10px"><div class="areav" id="arV"><canvas id="arPc"></canvas><canvas id="arOc" class="ov"></canvas></div>
   <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">${rooms?'<label class="small"><input type="checkbox" id="arRooms"> Show the rooms Measure.AI finds in this area</label>':''}<span class="muted small" id="arInfo"></span></div></div>
  <footer><button class="btn" id="arClear">Whole sheet</button><div class="sp"></div><button class="btn" data-x>Cancel</button><button class="btn pri" id="arSave">Save area</button></footer>`,{wide:true,onOpen:async(d,close)=>{
  const pc=d.querySelector('#arPc'),oc=d.querySelector('#arOc'),Vw=d.querySelector('#arV'),info=d.querySelector('#arInfo');
  d.querySelector('#arClear').onclick=()=>{box=null;draw()};
  d.querySelector('#arSave').onclick=()=>{s.area=box&&box.w>.01&&box.h>.01&&!(box.w>.99&&box.h>.99)?box:null;saveDrawing(s.file.fid);changed();close(true)};
  const pg=await pageOf(s),v1=pg.getViewport({scale:1});await new Promise(r=>setTimeout(r,30));
  const R={w:Vw.clientWidth||900,h:Vw.clientHeight||520},k=Math.min((R.w-2)/v1.width,(R.h-2)/v1.height),dpr=Math.min(2,devicePixelRatio||1),pw=Math.floor(v1.width*k),ph=Math.floor(v1.height*k);
  for(const c of [pc,oc]){c.width=pw*dpr;c.height=ph*dpr;c.style.width=pw+'px';c.style.height=ph+'px';c.style.left=(R.w-pw)/2+'px';c.style.top=(R.h-ph)/2+'px'}
  const x=pc.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,pc.width,pc.height);await pg.render({canvasContext:x,viewport:pg.getViewport({scale:k*dpr})}).promise;
  function draw(){const c=oc.getContext('2d'),W=oc.width,H=oc.height;c.clearRect(0,0,W,H);
   if(box){const bx=box.x*W,by=box.y*H,bw=box.w*W,bh=box.h*H;c.fillStyle='rgba(27,36,48,.35)';c.fillRect(0,0,W,by);c.fillRect(0,by+bh,W,H-by-bh);c.fillRect(0,by,bx,bh);c.fillRect(bx+bw,by,W-bx-bw,bh);c.strokeStyle='#0E9F6E';c.lineWidth=2.5*dpr;c.strokeRect(bx,by,bw,bh)}
   if(show)show.forEach((rm,i)=>{c.beginPath();rm.pts.forEach((q,n)=>n?c.lineTo(q[0]/1000*W,q[1]/1000*H):c.moveTo(q[0]/1000*W,q[1]/1000*H));c.closePath();c.fillStyle=`hsla(${(i*67)%360},70%,50%,.28)`;c.fill();c.strokeStyle=`hsl(${(i*67)%360},70%,35%)`;c.lineWidth=dpr;c.stroke()});
   const mm=v=>Math.round(v/72*25.4);info.textContent=box?`Box ${mm(box.w*v1.width)} × ${mm(box.h*v1.height)} mm on the sheet`:'The whole sheet will be measured.';
   if(show)info.textContent+=` · ${plural(show.length,'room')} found`}
  const rc=d.querySelector('#arRooms');if(rc)rc.onchange=async()=>{if(!rc.checked){show=null;draw();return}info.textContent='Finding rooms…';try{show=(await findRooms(s.p,box)).rooms}catch(e){show=null}draw()};
  const P=e=>{const r=oc.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))]};
  oc.addEventListener('pointerdown',e=>{e.preventDefault();oc.setPointerCapture(e.pointerId);const [x0,y0]=P(e),inside=box&&x0>=box.x&&x0<=box.x+box.w&&y0>=box.y&&y0<=box.y+box.h,b0=box&&{...box};
   const mv=ev=>{const [x1,y1]=P(ev);box=inside?{...b0,x:Math.max(0,Math.min(1-b0.w,b0.x+x1-x0)),y:Math.max(0,Math.min(1-b0.h,b0.y+y1-y0))}:{x:Math.min(x0,x1),y:Math.min(y0,y1),w:Math.abs(x1-x0),h:Math.abs(y1-y0)};show=null;if(rc)rc.checked=false;draw()};
   const up=()=>{oc.removeEventListener('pointermove',mv);oc.removeEventListener('pointerup',up);if(box&&(box.w<.01||box.h<.01))box=inside?b0:null;draw()};
   oc.addEventListener('pointermove',mv);oc.addEventListener('pointerup',up)});
  draw();
 }});
}
