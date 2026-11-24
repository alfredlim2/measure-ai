/* Measure.AI engine — sheet images, concrete & formwork build, shared geometry. Extracted from the measuring code; no page layout or DOM here. */
const AI_NAME='Measure.AI';
// the engine reads its image limits from /api/config (set by the app) and the DPI choice from CF.opt
const CF={vision:null,opt:{dpi:'auto'}};
const CF_TOOL='Conc & Fwk Measure',FIN_TOOL='Finishes Measure',CF_DPI=200;   // STL_TOOL: steel.js
const NOUN={conc:['element','elements'],fin:['room','rooms'],steel:['item','items']};
const noun=(t,n)=>NOUN[t.toolId||'conc'][n===1?0:1];
const CF_KIND={Column:['column'],Beam:['beam'],Slab:['slab'],Wall:['wall'],Foundation:['footing','pile_cap'],Stair:['stair'],
 'Floor finish':['floor'],'Wall finish':['wall'],'Skirting':['skirting'],'Suspended ceiling':['suspended_ceiling'],'Ceiling finish':['ceiling_paint'],'Waterproofing':['waterproofing'],
 Bracing:['bracing'],'Purlin & girt':['purlin','girt'],'Rafter & truss':['rafter','truss'],'Secondary steel':['sag_rod','tie_rod','stair','handrail','other'],Connections:['connection']};   // Column / Beam are shared with Steel
const KIND_KEY={column:'col',beam:'beam',slab:'slab',wall:'wall',footing:'fdn',pile_cap:'fdn',stair:'stair',other:'oth'};
const TYPE_NAME={column:'Column',beam:'Beam',slab:'In-situ Slab',wall:'Wall',footing:'Footing',pile_cap:'Pile Cap',stair:'Stair',other:'Other concrete'};
const LABEL_SRC={on_element:'Label on the element',nearby:'Label on a nearby span of the same member',schedule:'Schedule / legend on the sheet',typical_note:'Typical note on the sheet',other_sheet:'Another sheet of the set (schedule, detail or plan)',inferred:'Not found; inferred by AI'};
const JOB_ST={wait:'Waiting',render:'Rendering 200 DPI image',upload:'Uploading',queued:'Queued on server',sending:'Sending to model',thinking:'Thinking',writing:'Writing answer',done:'Done',error:'Failed',cx:'Cancelled'};
const I_=t=>`<i>&lt;${t}&gt;</i>`;   // label inside an expression, e.g. 0.25<Width>
const hm=ms=>new Date(ms).toTimeString().slice(0,5);
const median=a=>{a=a.filter(v=>v!=null&&isFinite(v)).sort((x,y)=>x-y);return a.length?a[Math.floor(a.length/2)]:null};
const scaleDen=s=>{const m=String(s||'').match(/1\s*:\s*(\d+(?:\.\d+)?)/);return m?+m[1]:null};
const mdLite=s=>esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/\n/g,'<br>');
const shLabel=p=>{const s=sheetOf(p);return s?(s.meta.label||s.meta.placeholder):'?'};
const shName=p=>{const s=sheetOf(p);return s?sname(s):'?'};
const terminal=j=>['done','error','cx'].includes(j.st);
const floorsOf=E=>[...new Set(E.map(e=>e.floor))].sort((a,b)=>floorRank(a)-floorRank(b)||String(a).localeCompare(String(b)));
function setRun(t,st){t.run.st=st;t.jobs.forEach(j=>{if(!terminal(j))j.st=st})}
function imageTarget(model,detail,w0,h0){
 const v=CF.vision,why=[];let w=w0,h=h0;
 if(!v)return {w:Math.floor(w0),h:Math.floor(h0),detail:'original',why};
 const f=Math.min(1,v.maxSide/Math.max(w,h));if(f<1){w*=f;h*=f;why.push(`longest side capped at ${v.maxSide} px`)}
 const B=v.block||32,pc=(a,b)=>Math.ceil(a/B)*Math.ceil(b/B);
 if(v.maxBlocks&&pc(w,h)>v.maxBlocks){const sf=Math.sqrt(B*B*v.maxBlocks/(w*h)),adj=sf*Math.min(Math.floor(w*sf/B)/(w*sf/B),Math.floor(h*sf/B)/(h*sf/B));w*=adj;h*=adj;why.push('kept under the image size limit')}
 w=Math.floor(w);h=Math.floor(h);const blocks=pc(w,h);
 return {w,h,detail:'original',blocks,tokens:Math.ceil(blocks*(v.perBlock||1.2)),why};
}
// Resolution: fixed, or Auto = the DPI at which the smallest text in the PDF is about 16 px tall (100–200 DPI).
// Coordinates come from the vector lines, so the image only has to be legible.
function chooseDpi(t,tc,vp1){
 const o=CF.opt.dpi;if(o&&o!=='auto')return {dpi:+o,why:''};
 const h=(tc&&tc.items||[]).filter(i=>i.str&&i.str.trim().length>=2).map(i=>{const m=pdfjs.Util.transform(vp1.transform,i.transform);return Math.hypot(m[2],m[3])}).filter(v=>v>.5).sort((a,b)=>a-b);
 if(h.length<5)return {dpi:CF_DPI,why:`${CF_DPI} DPI: no text layer to size from`};
 const small=h[Math.floor(h.length*.1)],dpi=Math.max(100,Math.min(CF_DPI,Math.round(16*72/small/5)*5));
 return {dpi,why:`Auto ${dpi} DPI: smallest text ${(small*25.4/72).toFixed(1)} mm`};
}
const blobUrl=c=>new Promise((res,rej)=>c.toBlob(b=>{if(!b)return rej(new Error('The sheet image could not be created (too large for this browser)'));const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=rej;fr.readAsDataURL(b)},'image/jpeg',.9));
async function cfSheet(t,j){
 const s=sheetOf(j.p),page=await pageOf(s),vp1=page.getViewport({scale:1}),W=vp1.width,H=vp1.height;
 let tc=null;try{tc=await page.getTextContent()}catch(e){}
 const dp=chooseDpi(t,tc,vp1);
 // analysis area (area.js): only the box is rendered and sent; the server maps the answer back onto the sheet
 const a=t.areas&&t.areas[j.p],X0=a?a.x*W:0,Y0=a?a.y*H:0,CW=a?a.w*W:W,CH=a?a.h*H:H;
 const tg=imageTarget(t.model,t.detail,CW*dp.dpi/72,CH*dp.dpi/72);t.detailSent=tg.detail;
 const k=Math.min(tg.w/CW,tg.h/CH,16000/Math.max(CW,CH),Math.sqrt(180e6/(CW*CH)));      // + browser canvas limits for very large sheets
 const vp=page.getViewport({scale:k,offsetX:-X0*k,offsetY:-Y0*k});const c=document.createElement('canvas');c.width=Math.min(tg.w,Math.floor(CW*k));c.height=Math.min(tg.h,Math.floor(CH*k));
 const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);
 await page.render({canvasContext:x,viewport:vp}).promise;
 // rooms found by the app (rooms.js): their numbers go on the image, the outlines and door swings with the request
 const fr=t.rooms?await findRooms(j.p,a):null;if(fr){drawRoomTags(c,fr.rooms,W,H,X0,Y0,k);j.roomN=fr.rooms.length;j.doorN=fr.doors}
 const image=await blobUrl(c);
 j.pw=W;j.ph=H;j.img={w:c.width,h:c.height,dpi:Math.round(k*72),blocks:tg.blocks,tokens:tg.tokens,why:dp.why?[dp.why,...tg.why]:tg.why,assumed:tg.assumed};
 try{j.vec=await vectorIndex(page)}catch(e){j.vec=null;console.warn('vector index',e)}   // drawn lines, for snapping (vector.js)
 j.mb=image.length*.75/1048576;c.width=c.height=0;
 let text=[];
 if(t.text&&tc){try{
  text=tc.items.filter(i=>i.str&&i.str.trim()).map(i=>{const [a,b,,,e,f]=pdfjs.Util.transform(vp1.transform,i.transform);const r=Math.round(Math.atan2(b,a)*180/Math.PI);return {s:i.str.trim(),x:+(e/W*1000).toFixed(1),y:+(f/H*1000).toFixed(1),r:Math.abs(r)>1?r:0}})
   .sort((p,q)=>p.y-q.y||p.x-q.x).slice(0,4000)}catch(e){}}
 j.textN=text.length;
 // text positions in page units (door / window tags are placed exactly on their text, finishes.js tagPoint)
 j.texts=tc?tc.items.filter(i=>i.str&&i.str.trim()).map(i=>{const m=pdfjs.Util.transform(vp1.transform,i.transform),h=Math.hypot(m[2],m[3]);return {s:i.str,cx:m[4]+(i.width||0)/2,cy:m[5]-h/2}}):null;
 const m=s.meta;
 const region=a?[a.x,a.y,a.x+a.w,a.y+a.h].map(v=>Math.round(v*1e5)/100):null;   // the area in the sheet's 0–1000 coordinates
 const lines=t.lines?await linesIn(j.p,a):undefined;j.area=a||null;j.lineN=lines?lines.length:0;
 return {image,text,region,lines,rooms:fr?fr.rooms:undefined,sheet:{name:sname(s),number:m.label,title:m.title,scale:m.scale,level:s.floor,file:s.file.name,page:s.page,paperW_mm:W/72*25.4,paperH_mm:H/72*25.4,imgW:j.img.w,imgH:j.img.h,dpi:j.img.dpi,...(a?{area_mm:[a.x*W,a.y*H,(a.x+a.w)*W,(a.y+a.h)*H].map(v=>Math.round(v/72*25.4))}:{})}};
}
// Parallel parts (lanes) of a run: item, state, thinking and elements added, per lane number.
const laneOf=(r,n)=>{r.lanes=r.lanes||{};return r.lanes[n]=r.lanes[n]||{n,item:'',think:'',added:0,st:'run',k:0}};
const thinkText=r=>r.think+Object.values(r.lanes||{}).map(L=>L.think?`\n\n**— Part ${L.n}: ${L.item} —**\n\n${L.think}`:'').join('');
/* ---------- AI answer → elements with quantities ---------- */
/* Sheet scale (real mm per paper mm): the printed scale, checked against the printed dimensions the model pointed at.
   Shared by every tool. Sets j.scale and returns { k, warn } (warn = the sheet's warnings plus any scale problem). */
function sheetScale(j,R,s){
 const PW=j.pw/72*25.4,PH=j.ph/72*25.4,pm=(a,b)=>Math.hypot((b[0]-a[0])/1000*PW,(b[1]-a[1])/1000*PH);
 const printed=scaleDen(R.sheet.scale)||scaleDen(s.meta.scale);
 const cal=R.calibration.map(c=>c.length_mm/pm(c.p1,c.p2)).filter(v=>isFinite(v)&&v>1);
 const kc=median(cal);let k=null,ksrc='',warn=[...R.warnings];
 if(printed&&kc&&Math.abs(kc/printed-1)>.15){k=kc;ksrc=`1:${Math.round(kc)} from ${cal.length} printed dimension${cal.length>1?'s':''}`;warn.unshift(`Printed scale is 1:${printed} but the printed dimensions measure as 1:${Math.round(kc)}; the sheet may have been printed at another paper size. Used 1:${Math.round(kc)}.`)}
 else if(printed){k=printed;ksrc=`1:${printed} printed${kc?`, checked against ${cal.length} dimension${cal.length>1?'s':''} (1:${Math.round(kc)})`:''}`}
 else if(kc){k=kc;ksrc=`1:${Math.round(kc)} from ${cal.length} printed dimension${cal.length>1?'s':''} (no printed scale)`}
 else if(R.elements.length)warn.unshift('No scale found: lengths and areas that are not dimensioned on the drawing could not be measured.');   // schedules / details have nothing to measure
 j.scale={k,src:ksrc};
 return {k,warn};
}
// Raw dimensions of a drawn shape: each side of a polygon (E1, E2…) or each segment of a line (S1…), real length in m.
function dimsOf(j,k,pts,closed,snap){
 const PW=j.pw/72*25.4,PH=j.ph/72*25.4,n=pts.length,m=closed?n:n-1,out=[];
 for(let i=0;i<m;i++){const p=pts[i],q=pts[(i+1)%n];
  out.push({lab:(closed?'E':'S')+(i+1),L:k?Math.hypot((q[0]-p[0])/1000*PW,(q[1]-p[1])/1000*PH)*k/1000:0,mid:[(p[0]+q[0])/2/1000*j.pw,(p[1]+q[1])/2/1000*j.ph],snapped:snap?snap[i].snapped:null,amb:snap?snap[i].ambiguous:false,type:'wall'})}
 return out;
}
const dimsExpr=(D,k)=>k?D.map(d=>`${r3(d.L)}${I_(d.lab+(d.snapped===false?' AI position':d.amb?' check: two lines close':''))}`).join(' · ')+(D.length>1&&D[0].lab[0]==='S'?` · total ${r3(D.reduce((a,d)=>a+d.L,0))} m`:'')+' (m, at the sheet scale)':'No scale: lengths unknown';
function snapNote(D,note,j,method){
 if(method==='lines')return note.push('geometry from the PDF lines named by the AI (exact)');
 if(method==='room')return note.push('outline found by the app in the drawing and snapped onto its wall lines');
 if(!j.vec)return note.push('no vector lines in this PDF: AI positions used');
 if(method==='shape')return note.push('outline = the drawn shape in the PDF (exact)');
 if(method==='none')return note.push('no drawn shape found: AI outline kept (approximate)');
 const s=D.filter(d=>d.snapped!==null),off=s.filter(d=>!d.snapped).length;
 if(off)note.push(`${off} of ${s.length} edges have no drawn line nearby: AI position kept`);
}
function cfBuild(t,j,R){
 if(!R)throw new Error('no answer for this sheet');j.result=R;const G=t.run.result,idx=t.jobs.indexOf(j);
 const s=sheetOf(j.p),pw=j.pw,ph=j.ph,PW=pw/72*25.4,PH=ph/72*25.4;
 const P=([x,y])=>[x/1000*pw,y/1000*ph];                                  // → page units (what the viewer draws in)
 const pm=(a,b)=>Math.hypot((b[0]-a[0])/1000*PW,(b[1]-a[1])/1000*PH);      // → paper mm
 const sc=sheetScale(j,R,s),k=sc.k,warn=sc.warn;
 const lenMm=pts=>{if(!k)return null;let L=0;for(let i=1;i<pts.length;i++)L+=pm(pts[i-1],pts[i]);return L*k};
 const paperXY=pts=>pts.map(([x,y])=>[x/1000*PW,y/1000*PH]);
 const areaM2=pts=>{if(!k||pts.length<3)return null;const q=paperXY(pts);let a=0;for(let i=0;i<q.length;i++){const [x1,y1]=q[i],[x2,y2]=q[(i+1)%q.length];a+=x1*y2-x2*y1}return Math.abs(a)/2*k*k/1e6};
 const perimM=pts=>{if(!k)return null;let L=0;for(let i=0;i<pts.length;i++)L+=pm(pts[i],pts[(i+1)%pts.length]);return L*k/1000};
 const types={};G.types.forEach(ty=>{if(ty.mark)types[ty.mark.toLowerCase()+'|'+ty.kind]=ty});
 const typeOf=a=>types[a.mark.toLowerCase()+'|'+a.kind]||types[a.mark.toLowerCase()+'|'+(a.kind==='pile_cap'?'footing':a.kind)]||null;
 const slabT=R.elements.filter(a=>a.kind==='slab').map(a=>a.thickness_mm??typeOf(a)?.thickness_mm);
 const TS=R.sheet.typical_slab_thickness_mm||median(slabT)||median(G.types.filter(x=>x.kind==='slab').map(x=>x.thickness_mm))||null;
 const FH=R.sheet.floor_height_mm||null,FH0=4000;
 const bwMed=median(R.elements.filter(a=>a.kind==='beam').map(a=>a.width_mm??typeOf(a)?.width_mm));
 // columns at beam ends: this sheet's, or (if it has none) those of another sheet in the set with the same level and paper size,
 // e.g. the column plan of the same floor, which shares the drawing frame
 const lv=x=>String(x||'').toLowerCase().replace(/[\s.]/g,'');
 const cols=R.elements.filter(a=>a.kind==='column'&&a.pts.length>=3).map(c=>({...c,from:''}));
 if(!cols.length)G.sheets.forEach((x,i)=>{const o=t.jobs[i];if(i===idx||!o||!o.pw||Math.abs(o.pw-pw)>2||Math.abs(o.ph-ph)>2||!lv(x.sheet.level)||lv(x.sheet.level)!==lv(R.sheet.level))return;
  x.elements.forEach(c=>{if(c.kind==='column'&&c.pts.length>=3)cols.push({...c,from:` (sheet ${i+1})`})})});
 const floor=s.floor||normFloor(R.sheet.level)||R.sheet.level||'—',grade=R.sheet.concrete_grade||'—',sl=shLabel(j.p);
 const ptw=mm=>k&&mm?mm/k/25.4*72:2.4;                                      // real mm → page units
 const out=[],L=t.bySrc[j.p]=[];
 for(const a0 of R.elements){
  if(!t.kinds.includes(a0.kind)&&!(a0.kind==='other'&&t.kinds.length>3))continue;
  // outlines built from the PDF lines the AI named (PDF lines mode) are exact already; others are snapped onto the drawn lines
  const sn=a0.lines?{pts:a0.pts,edges:null,method:'lines'}:a0.shape!=='polyline'&&a0.pts.length>=3?snapNorm(j,a0.pts,true):{pts:a0.pts,edges:null},a={...a0,pts:sn.pts};
  const ty=typeOf(a),pick=(f,...alt)=>a[f]??alt.map(x=>ty&&ty[x]).find(v=>v!=null)??null;
  const why=[],note=[];if(a.needs_review&&a.review_reason)why.push(reasonText(a.review_reason));
  const kk=KIND_KEY[a.kind],page=a.pts.map(P),isLine=a.shape==='polyline'||a.pts.length<3;
  const e={kind:kk,aiKind:a.kind,tag:a.id,type:TYPE_NAME[a.kind],name:a.mark||'(no mark)',loc:a.grid_ref||'—',grade,raw:a0,src:a.label_source,conf:Math.round(a.confidence*100),
   status:a.needs_review?'rv':'ok',sheet:j.p,sheetLabel:sl,floor,id:`${t.id}.${j.p}-${a.id}`,job:j.p,q:{v:0,fw:0,fs:0},len:0,attrs:[],expr:[]};
  const M=v=>v==null?'?':r3(v/1000),need=(v,what)=>{if(v==null){why.push(`${what} not read`);return false}return true};
  if(a.kind==='column'){
   let b=pick('width_mm','width_mm'),h=pick('depth_mm','depth_mm');const round=a.pts.length>=7;
   if((b==null||h==null)&&k&&a.pts.length>=3){const xs=a.pts.map(p=>p[0]/1000*PW),ys=a.pts.map(p=>p[1]/1000*PH);
    const mb=Math.round((Math.max(...xs)-Math.min(...xs))*k/25)*25,mh=Math.round((Math.max(...ys)-Math.min(...ys))*k/25)*25;
    if(b==null){b=mb;note.push('width measured from the outline')}if(h==null){h=mh;note.push('depth measured from the outline')}}
   const H=a.height_mm||FH||FH0;if(!a.height_mm&&!FH)note.push(`height ${FH0/1000} m assumed (not on this sheet)`);
   e.poly=page;e.sec=round?`Ø${b}`:`${b}×${h}`;e.len=H/1000;
   if(need(b,'Section size')&&h!=null){const A=round?Math.PI*b*b/4/1e6:b*h/1e6,per=round?Math.PI*b/1000:2*(b+h)/1000;
    e.q={v:A*H/1000,fw:per*H/1000,fs:0};
    e.expr=[['Volume',round?`π*${M(b)}²/4${I_('Diameter')}*${M(H)}${I_('Height')}=${r3(e.q.v)}m3`:`${M(b)}${I_('Width')}*${M(h)}${I_('Depth')}*${M(H)}${I_(a.height_mm?'Height':FH?'Floor height':'Assumed height')}=${r3(e.q.v)}m3`],
     ['Area of formwork',`${r2(per)}${I_('Perimeter')}*${M(H)}${I_('Height')}=${r2(e.q.fw)}m2`]]}
   e.attrs=[['Section (mm)',e.sec],['Height (mm)',H+(a.height_mm?'':FH?' (sheet)':' (assumed)')]];
  }else if(a.kind==='beam'||a.kind==='wall'){
   const w=a.kind==='wall'?(a.width_mm??a.thickness_mm??ty?.width_mm??ty?.thickness_mm??null):pick('width_mm','width_mm'),d=pick('depth_mm','depth_mm');
   const pts=isLine?a.pts:longAxis(a.pts);
   const Lg=lenMm(pts),Lcc=a.length_mm||Lg;
   e.line=pts.map(P);e.poly=isLine?strokePoly(e.line,ptw(w)):page;
   if(a.kind==='beam'){
    let ded=0,dn=[];if(k&&pts.length>=2){[[pts[0],pts[1]],[pts[pts.length-1],pts[pts.length-2]]].forEach(([q,nb])=>{const c=cols.find(c=>near(q,c.pts));if(!c)return;
     const ux=(nb[0]-q[0])/1000*PW,uy=(nb[1]-q[1])/1000*PH,n=Math.hypot(ux,uy)||1,pr=paperXY(c.pts).map(([x,y])=>(x*ux+y*uy)/n);const half=(Math.max(...pr)-Math.min(...pr))/2*k;ded+=half;dn.push(`${c.mark||c.id}${c.from} ${Math.round(half)}`)})}
    const Ln=Lcc!=null?Math.max(0,Lcc-ded):null,ts=TS||0,dd=d!=null?Math.max(0,d-ts):null;
    e.sec=`${w??'?'}×${d??'?'}`;e.len=Ln?Ln/1000:0;
    if(need(w,'Width')&&need(d,'Depth')&&need(Ln,'Length')){e.q={v:w*dd*Ln/1e9,fw:(2*dd+w)*Ln/1e6,fs:w*Ln/1e6};
     e.expr=[['Volume',`${M(w)}${I_('Width')}*(${M(d)}${I_('Depth')}-${M(ts)}${I_(TS?'Slab thickness':'No slab')})*${r2(Ln/1000)}${I_('Net length')}=${r3(e.q.v)}m3`],
      ['Area of formwork',`(2*${M(dd)}${I_('Side below slab')}+${M(w)}${I_('Soffit')})*${r2(Ln/1000)}${I_('Net length')}=${r2(e.q.fw)}m2`],
      ['Area of formwork to soffit',`${M(w)}*${r2(Ln/1000)}=${r2(e.q.fs)}m2`],
      ['Net length',`${r2(Lcc/1000)}${I_(a.length_mm?'Printed dimension':'Measured c/c at '+(j.scale.src.split(' ')[0]))}-${r2(ded/1000)}${I_(dn.length?'Deduct column '+dn.join(', '):'No column at ends')}=${r2(Ln/1000)}m`]]}
    e.attrs=[['Structure Category',/^(G|BI|BALOK INDUK)/i.test(a.mark)?'Main beam':/^(B|BA)/i.test(a.mark)?'Secondary beam':'Beam'],['Width (mm)',w??'—'],['Depth (mm)',d??'—'],['Length c/c (m)',Lcc!=null?r2(Lcc/1000):'—'],['Net length (m)',Ln!=null?r2(Ln/1000):'—']];
    if(a.length_mm&&Lg&&Math.abs(Lg/a.length_mm-1)>.2)why.push(`Printed length ${a.length_mm} differs from the drawn length ${Math.round(Lg)} by more than 20%`);
   }else{
    const H=a.height_mm||FH||FH0;if(!a.height_mm&&!FH)note.push(`height ${FH0/1000} m assumed`);
    e.sec=`${w??'?'} thk`;e.len=Lcc?Lcc/1000:0;
    if(need(w,'Thickness')&&need(Lcc,'Length')){e.q={v:w*Lcc*H/1e9,fw:2*Lcc*H/1e6,fs:0};
     e.expr=[['Volume',`${M(w)}${I_('Thickness')}*${r2(Lcc/1000)}${I_('Length')}*${M(H)}${I_('Height')}=${r3(e.q.v)}m3`],['Area of formwork',`2*${r2(Lcc/1000)}*${M(H)}=${r2(e.q.fw)}m2`]]}
    e.attrs=[['Thickness (mm)',w??'—'],['Length (m)',Lcc?r2(Lcc/1000):'—'],['Height (mm)',H]];
   }
  }else{ // slab, footing, pile cap, stair, other: outline × thickness
   const A=areaM2(a.pts),per=perimM(a.pts);e.poly=page;
   const tt=a.kind==='slab'?(a.thickness_mm??ty?.thickness_mm??TS):['footing','pile_cap'].includes(a.kind)?(a.depth_mm??a.thickness_mm??ty?.depth_mm??ty?.thickness_mm??null):(a.thickness_mm??ty?.thickness_mm??null);
   if(a.kind==='slab'&&a.thickness_mm==null&&!ty?.thickness_mm&&TS)note.push('typical slab thickness used');
   e.sec=tt?`${tt} ${['footing','pile_cap'].includes(a.kind)?'deep':'thk'}`:'? thk';e.len=A||0;
   if(need(A,'Area (no scale)')&&need(tt,'Thickness')){
    if(['footing','pile_cap'].includes(a.kind)){e.q={v:A*tt/1000,fw:per*tt/1000,fs:0};
     e.expr=[['Volume',`${r2(A)}${I_('Plan area')}*${M(tt)}${I_('Depth')}=${r3(e.q.v)}m3`],['Area of formwork',`${r2(per)}${I_('Perimeter')}*${M(tt)}${I_('Depth')}=${r2(e.q.fw)}m2`]]}
    else{const ded=a.kind==='slab'&&bwMed?per*bwMed/2000:0,fw=Math.max(0,A-ded);e.q={v:A*tt/1000,fw,fs:fw};
     e.expr=[['Volume',`${r2(A)}${I_('Area to beam centrelines')}*${M(tt)}${I_('Thickness')}=${r3(e.q.v)}m3`],
      ['Area of formwork',`${r2(A)}${I_('Area')}-${r2(ded)}${I_(ded?`Half of ${bwMed} mm beam soffits along ${r2(per)} m edge`:'No beams')}=${r2(fw)}m2`]]}}
   if(['stair','other'].includes(a.kind)&&e.status!=='rv'){e.status='rv';why.push('Stairs and other items are measured on plan only; check the waist and landings')}
   e.attrs=[[a.kind==='slab'?'Slab type':'Mark',a.mark||'—'],['Thickness (mm)',tt??'—'],['Plan area (m²)',A!=null?r2(A):'—'],['Perimeter (m)',per!=null?r2(per):'—']];
  }
  e.dims=dimsOf(j,k,a.pts,!isLine,sn.edges);if(!isLine||a.lines)snapNote(e.dims,note,j,sn.method);e.snap=sn.method;if(a.lines)e.attrs.push(['PDF lines',a.lines]);
  e.expr.push(['Dimensions',dimsExpr(e.dims,k)]);
  e.expr.push(['Quantity','1pc']);
  if(why.length&&!(a.needs_review&&why.length===1))e.status='rv';
  e.why=why.join(' · ');e.note=note.join(' · ');
  e.attrs.push(['Concrete Grade',grade],['Label read',a.label_text||'—']);
  if(a.ref_sheet&&t.jobs[a.ref_sheet-1])e.attrs.push(['Info from sheet',shName(t.jobs[a.ref_sheet-1].p)]);
  L.push(e);out.push(e);
 }
 j.warn=warn;j.n=out.length;j.rv=out.filter(e=>e.status==='rv').length;
 if(!t.srcs.includes(j.p))t.srcs.push(j.p);
 t.elements.push(...out);t.res=summary(t);
}
function near(q,poly){if(inPoly(q[0],q[1],poly))return true;const xs=poly.map(p=>p[0]),ys=poly.map(p=>p[1]),t=3;return q[0]>Math.min(...xs)-t&&q[0]<Math.max(...xs)+t&&q[1]>Math.min(...ys)-t&&q[1]<Math.max(...ys)+t}
function longAxis(pts){const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);return x1-x0>=y1-y0?[[x0,(y0+y1)/2],[x1,(y0+y1)/2]]:[[(x0+x1)/2,y0],[(x0+x1)/2,y1]]}
function beamPoly(x1,y1,x2,y2,w){const L=Math.hypot(x2-x1,y2-y1)||1,nx=-(y2-y1)/L*w/2,ny=(x2-x1)/L*w/2;return [[x1+nx,y1+ny],[x2+nx,y2+ny],[x2-nx,y2-ny],[x1-nx,y1-ny]]}
function strokePoly(P,w){
 if(P.length===2)return beamPoly(P[0][0],P[0][1],P[1][0],P[1][1],w);
 const nrm=(a,b)=>{const L=Math.hypot(b[0]-a[0],b[1]-a[1])||1;return [-(b[1]-a[1])/L,(b[0]-a[0])/L]};
 const left=[],right=[];
 P.forEach((p,i)=>{const n1=i>0?nrm(P[i-1],p):null,n2=i<P.length-1?nrm(p,P[i+1]):null;let n=n1&&n2?[n1[0]+n2[0],n1[1]+n2[1]]:(n1||n2);const L=Math.hypot(n[0],n[1])||1;n=[n[0]/L*w/2,n[1]/L*w/2];left.push([p[0]+n[0],p[1]+n[1]]);right.push([p[0]-n[0],p[1]-n[1]])});
 return left.concat(right.reverse());
}

const ktok=n=>n==null?'—':n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e3?(n/1e3).toFixed(1)+'k':String(n);
