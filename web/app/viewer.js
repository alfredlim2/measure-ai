/* Drawing viewer: the PDF page (sharp, re-rendered after pan / zoom) with the measured items drawn on top.
   Page units = PDF points at scale 1, y down; toScreen() maps them to the canvas. The items come from viewerSet(). */
const V={sheet:null,page:null,pw:1191,ph:842,s:1,tx:0,ty:0,rs:null,rtask:null,timer:null,labels:1,
 toggles:Object.fromEntries(Object.keys(COLORS).map(k=>[k,1]))};
let selEls=new Set(),hoverEl=null;
const VIEW={stage:null,pdfc:null,ovc:null,tip:null,legend:null,spin:null,els:[],onSelect:null};
const toScreen=(x,y)=>[V.tx+x*V.s,V.ty+y*V.s];
const lineW=()=>Math.max(1.5,Math.min(5,V.s*1.4));
const ptR=()=>Math.max(5,Math.min(8,4+V.s*1.2));

function viewerMount(stage){
 VIEW.stage=stage;
 stage.innerHTML=`<canvas class="pdf"></canvas><canvas class="ovl"></canvas><div class="blank"><div>${icon('doc')}<div style="margin-top:8px">Select a drawing on the left to view it.</div></div></div>
  <div class="vchip hidden"></div><div class="rspin hidden"><span class="spin"></span>Rendering</div><div class="legend"></div>
  <div class="vbar"><button data-z="1.25" title="Zoom in">${icon('zin')}</button><button data-z="0.8" title="Zoom out">${icon('zout')}</button><button data-z="fit" title="Fit to screen">${icon('fit')}</button></div><div class="tip" hidden></div>`;
 VIEW.pdfc=stage.querySelector('canvas.pdf');VIEW.ovc=stage.querySelector('canvas.ovl');VIEW.tip=stage.querySelector('.tip');VIEW.legend=stage.querySelector('.legend');VIEW.spin=stage.querySelector('.rspin');
 stage.querySelector('.blank svg').style.cssText='width:34px;height:34px;color:#A0A9B8';
 const ovc=VIEW.ovc;
 ovc.addEventListener('wheel',e=>{if(!V.page)return;e.preventDefault();const r=ovc.getBoundingClientRect();zoomAt(Math.exp(-e.deltaY*0.0012),e.clientX-r.left,e.clientY-r.top)},{passive:false});
 stage.querySelectorAll('.vbar button').forEach(b=>b.onclick=()=>{if(!V.page)return;if(b.dataset.z==='fit')return fitView();zoomAt(+b.dataset.z,stage.clientWidth/2,stage.clientHeight/2)});
 let drag=null;
 ovc.addEventListener('pointerdown',e=>{if(!V.page)return;drag={x:e.clientX,y:e.clientY,tx:V.tx,ty:V.ty,moved:false};ovc.setPointerCapture(e.pointerId)});
 ovc.addEventListener('pointermove',e=>{
  const r=ovc.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
  if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;
   if(drag.moved){V.tx=drag.tx+dx;V.ty=drag.ty+dy;applyXf();drawOverlay();renderPdf();ovc.style.cursor='grabbing';VIEW.tip.hidden=true;return}}
  const el=hitTest(mx,my),id=el?el.id:null;
  if(id!==hoverEl){hoverEl=id;drawOverlay()}
  ovc.style.cursor=id?'pointer':'grab';
  if(el){VIEW.tip.innerHTML=`<b>${esc(el.name)}</b> ${esc(el.sec||'')}<br><small>${esc(el.type)}${el.loc&&el.loc!=='—'?' · '+esc(el.loc):''}${el.status==='rv'?' · needs review':el.status==='ck'?' · checked':''}</small>`;
   VIEW.tip.style.left=Math.min(mx+14,stage.clientWidth-290)+'px';VIEW.tip.style.top=(my+14)+'px';VIEW.tip.hidden=false}else VIEW.tip.hidden=true;
 });
 ovc.addEventListener('pointerup',e=>{
  const r=ovc.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,wasDrag=drag&&drag.moved;drag=null;ovc.style.cursor='grab';
  if(wasDrag)return;const el=hitTest(mx,my);
  selEls=new Set(el?[el.id]:[]);drawOverlay();if(VIEW.onSelect)VIEW.onSelect(el||null);
 });
 ovc.addEventListener('pointerleave',()=>{if(hoverEl){hoverEl=null;drawOverlay()}VIEW.tip.hidden=true});
 new ResizeObserver(()=>{const d=window.devicePixelRatio||1;ovc.width=stage.clientWidth*d;ovc.height=stage.clientHeight*d;ovc.style.width=stage.clientWidth+'px';ovc.style.height=stage.clientHeight+'px';if(V.page){renderPdf();applyXf()}drawOverlay()}).observe(stage);
 VIEW.legend.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const k=b.dataset.k;
  if(k==='lbl'){V.labels=V.labels?0:1}else if(k in V.toggles)V.toggles[k]=V.toggles[k]?0:1;renderLegend();drawOverlay()});
}
async function viewerOpen(sh){
 if(!VIEW.stage)return;
 V.sheet=sh;V.rs=null;selEls.clear();hoverEl=null;
 if(!sh){V.page=null;VIEW.stage.querySelector('.blank').classList.remove('hidden');VIEW.stage.querySelector('.vchip').classList.add('hidden');const c=VIEW.pdfc.getContext('2d');c.clearRect(0,0,VIEW.pdfc.width,VIEW.pdfc.height);drawOverlay();renderLegend();return}
 V.page=await pageOf(sh);const vp=V.page.getViewport({scale:1});V.pw=vp.width;V.ph=vp.height;
 VIEW.stage.querySelector('.blank').classList.add('hidden');
 const ch=VIEW.stage.querySelector('.vchip');ch.classList.remove('hidden');ch.innerHTML=`${esc(sname(sh))}<small>${esc([sh.meta.scale,sh.floor].filter(Boolean).join(' · '))}</small>`;
 fitView();renderLegend();
}
function viewerSet(els){VIEW.els=els||[];selEls=new Set([...selEls].filter(id=>VIEW.els.some(e=>e.id===id)));drawOverlay();renderLegend()}
function viewerSelect(id){selEls=new Set(id?[id]:[]);drawOverlay()}
function viewerZoomTo(e){
 if(!V.page||!e)return;const P=e.pt?[e.pt]:e.line||e.poly;if(!P||!P.length)return;
 const xs=P.map(p=>p[0]),ys=P.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);
 const W=VIEW.stage.clientWidth,H=VIEW.stage.clientHeight,w=Math.max(40,x1-x0),h=Math.max(40,y1-y0);
 V.s=Math.min(10,Math.min(W/(w*3),H/(h*3)));V.tx=W/2-(x0+x1)/2*V.s;V.ty=H/2-(y0+y1)/2*V.s;applyXf();renderPdf(true);drawOverlay();
}
function fitView(){
 const st=VIEW.stage,W=st.clientWidth,H=st.clientHeight;if(!W||!H||!V.page)return;
 V.s=Math.min((W-48)/V.pw,(H-48)/V.ph);V.tx=(W-V.pw*V.s)/2;V.ty=(H-V.ph*V.s)/2;
 V.rs=null;VIEW.pdfc.style.transform='';renderPdf(true);drawOverlay();
}
function renderPdf(now){
 clearTimeout(V.timer);if(!V.page)return;
 if(!now){V.timer=setTimeout(()=>renderPdf(true),160);return}
 if(V.rtask){try{V.rtask.cancel()}catch(e){}V.rtask=null}
 const st=VIEW.stage,W=st.clientWidth,H=st.clientHeight,d=Math.min(2,window.devicePixelRatio||1);
 const off=document.createElement('canvas');off.width=Math.round(W*d);off.height=Math.round(H*d);
 const ctx=off.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,off.width,off.height);
 const s0={s:V.s,tx:V.tx,ty:V.ty},page=V.page;
 VIEW.spin.classList.remove('hidden');
 const task=page.render({canvasContext:ctx,viewport:page.getViewport({scale:V.s*d,offsetX:V.tx*d,offsetY:V.ty*d})});V.rtask=task;
 task.promise.then(()=>{
  if(V.rtask!==task||V.page!==page)return;
  const p=VIEW.pdfc;p.width=off.width;p.height=off.height;p.style.width=W+'px';p.style.height=H+'px';p.getContext('2d').drawImage(off,0,0);
  V.rs=s0;applyXf();VIEW.spin.classList.add('hidden');V.rtask=null;
 }).catch(()=>{});
}
function applyXf(){
 if(!V.rs){VIEW.pdfc.style.transform='';return}
 const k=V.s/V.rs.s,dx=V.tx-V.rs.tx*k,dy=V.ty-V.rs.ty*k;
 VIEW.pdfc.style.transform=`translate(${dx}px,${dy}px) scale(${k})`;
}
function zoomAt(f,mx,my){const ns=Math.max(.15,Math.min(16,V.s*f));f=ns/V.s;V.tx=mx-(mx-V.tx)*f;V.ty=my-(my-V.ty)*f;V.s=ns;applyXf();drawOverlay();renderPdf()}
const viewEls=()=>V.sheet?VIEW.els.filter(e=>e.sheet===V.sheet.p):[];
function drawOverlay(){
 const ovc=VIEW.ovc;if(!ovc)return;const d=window.devicePixelRatio||1,c=ovc.getContext('2d');c.setTransform(d,0,0,d,0,0);c.clearRect(0,0,ovc.width,ovc.height);
 if(!V.page)return;
 const list=viewEls().filter(e=>V.toggles[e.kind]).sort((a,b)=>KIND_ORDER[a.kind]-KIND_ORDER[b.kind]);
 for(const e of list){
  const sel=selEls.has(e.id),hov=hoverEl===e.id,col=COLORS[e.kind],rv=e.status==='rv',ck=e.status==='ck';
  if(e.kind==='wfin'||e.lineOnly){
   const S=e.line.map(p=>toScreen(p[0],p[1])),path=()=>{c.beginPath();S.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p))};c.lineCap='round';c.lineJoin='round';
   if(sel||hov){c.lineWidth=lineW()+5;c.strokeStyle='rgba(14,159,110,.28)';path();c.stroke()}
   c.lineWidth=lineW();c.strokeStyle=rv?'#D92D20':ck?'#12A150':col;if(rv)c.setLineDash([6,4]);path();c.stroke();c.setLineDash([]);c.lineCap='butt';continue}
  if(e.pt){
   const [x0,y0]=toScreen(e.pt[0],e.pt[1]),r=ptR()+(sel?2:hov?1:0),o=e.ptOff?ptR()*1.5:0,x=x0+o,y=y0+o;
   c.beginPath();c.arc(x,y,r,0,7);c.fillStyle=col;c.fill();c.lineWidth=sel?2.5:1.5;c.strokeStyle=sel?'#1B2430':rv?'#D92D20':'#fff';c.stroke();
   const pl=e.ptTxt??(e.kind==='door'?'D':e.kind==='win'?'W':'');
   if(pl){c.fillStyle='#fff';c.font=`700 ${Math.round(r*1.1)}px Inter,Arial`;c.textAlign='center';c.textBaseline='middle';c.fillText(pl,x,y+.5)}continue}
  c.beginPath();e.poly.forEach(([x,y],i)=>{const [sx,sy]=toScreen(x,y);i?c.lineTo(sx,sy):c.moveTo(sx,sy)});c.closePath();
  const flat=['slab','fdn','stair','room'].includes(e.kind);
  c.globalAlpha=flat?(sel?.42:hov?.32:.18):(sel?.85:hov?.72:.5);c.fillStyle=sel?'#0E9F6E':col;c.fill();c.globalAlpha=1;
  if(rv||ck||sel||hov||e.kind==='room'){c.lineWidth=sel?2.2:e.kind==='room'&&!hov&&e.status==='ok'?1:1.4;c.strokeStyle=sel?'#067A52':rv?'#D92D20':ck?'#12A150':col;if(rv&&!sel)c.setLineDash([4,3]);c.stroke();c.setLineDash([])}
 }
 if(V.labels)drawLabels(c,list);
 if(typeof drawRoomDetail==='function')drawRoomDetail(c,list);
}
function drawLabels(c,list){
 const fs=Math.min(13,Math.max(0,V.s*3.2));if(fs<7)return;
 c.font=`600 ${fs}px Inter,Arial`;c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';
 for(const e of list){
  if(e.kind==='wfin'||e.kind==='sjoint')continue;
  let x,y,ang=0;const P=e.line||e.poly;
  if(e.line&&e.line.length>=2){const i=Math.floor((e.line.length-1)/2),a=e.line[i],b=e.line[i+1];x=(a[0]+b[0])/2;y=(a[1]+b[1])/2;ang=Math.atan2(b[1]-a[1],b[0]-a[0]);if(ang>Math.PI/2)ang-=Math.PI;if(ang<-Math.PI/2)ang+=Math.PI}
  else if(P){x=P.reduce((s,p)=>s+p[0],0)/P.length;y=P.reduce((s,p)=>s+p[1],0)/P.length}
  if(e.pt){x=e.pt[0];y=e.pt[1]}
  const [sx,sy0]=toScreen(x,y),sy=e.pt?sy0-ptR()-8:sy0,txt=e.pt?(e.stl?e.name:e.raw&&e.raw.mark||''):e.kind==='slab'||e.kind==='fdn'?`${e.name} ${e.sec}`:e.name;if(!txt)continue;
  c.save();c.translate(sx,sy);c.rotate(ang);c.lineWidth=3.5;c.strokeStyle='rgba(255,255,255,.92)';c.strokeText(txt,0,0);c.fillStyle=e.status==='rv'?'#B42318':'#1B2430';c.fillText(txt,0,0);c.restore();
 }
}
function hitTest(mx,my){
 if(!V.page)return null;
 const x=(mx-V.tx)/V.s,y=(my-V.ty)/V.s,tol=3/V.s;let best=null;
 for(const e of viewEls().filter(e=>V.toggles[e.kind])){
  if(e.pt){const o=e.ptOff?ptR()*1.5/V.s:0;if(Math.hypot(e.pt[0]+o-x,e.pt[1]+o-y)>(ptR()+3)/V.s)continue}
  else if(e.kind==='wfin'||e.lineOnly){if(!nearLine(x,y,e.line,(lineW()/2+4)/V.s))continue}
  else if(!inPoly(x,y,e.poly)&&!(e.kind!=='slab'&&e.kind!=='room'&&nearPoly(x,y,e.poly,tol)))continue;
  if(!best||KIND_ORDER[e.kind]>KIND_ORDER[best.kind])best=e;
 }
 return best;
}
function renderLegend(){
 const L=VIEW.legend;if(!L)return;const E=viewEls();if(!E.length){L.innerHTML='';return}
 const n=k=>E.filter(e=>e.kind===k).length,rv=E.filter(e=>e.status==='rv').length;
 L.innerHTML=KIND_LBL.filter(([k])=>n(k)).map(([k,l])=>`<button data-k="${k}" class="${V.toggles[k]?'':'off'}"><i style="background:${COLORS[k]}"></i>${l} <span class="faint">${n(k)}</span></button>`).join('')
  +(rv?`<button data-k="rv" title="Items that need review are outlined in red"><i style="border:1.5px dashed #D92D20;background:#fff"></i>Needs review <span class="faint">${rv}</span></button>`:'')
  +`<button data-k="lbl" class="${V.labels?'':'off'}">Aa Labels</button>`;
}
