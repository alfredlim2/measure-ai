/* Measure.AI engine — annotated PDF report. Extracted from the measuring code; no page layout or DOM here. */
const SRC_LIBS=new Map();
async function srcLib(file){if(!SRC_LIBS.has(file.fid))SRC_LIBS.set(file.fid,await window.PDFLib.PDFDocument.load(file.bytes.slice(0),{ignoreEncryption:true,updateMetadata:false}));return SRC_LIBS.get(file.fid)}
const repOf=t=>REPORTS[t.toolId||'conc']||REPORTS.conc;
const XW=1095,sumQ=(L,k)=>L.reduce((a,e)=>a+(e.q[k]||0),0),cntRv=L=>L.filter(e=>e.status==='rv').length;
const xFill=(cols)=>{const s=cols.slice(0,-1).reduce((a,c)=>a+c.w,0);cols[cols.length-1].w=XW-s;return cols};
const REPORTS={
 conc:{
  short:'Conc & Fwk',name:'Concrete & Formwork',cover:'Concrete & Formwork Takeoff',fillNote:'Column, beam and slab in their legend colours',catNote:'Floor › grade › element type › section',schedName:'Element schedule',
  tiles:E=>[['Concrete volume',fx(sumQ(E,'v'),1),'m³'],['Formwork',fx(sumQ(E,'fw'),0),'m²'],['Elements measured',String(E.length),`${E.filter(e=>e.kind==='col').length} col · ${E.filter(e=>e.kind==='beam').length} beam · ${E.filter(e=>e.kind==='slab').length} slab`]],
  floors:{title:'Concrete volume by floor',cols:[['Floor',130],['Column m³',110],['Beam m³',110],['Slab m³',110],['Other m³',110],['Total m³',115],['Formwork m²',140],['Elements',100],['Review',170]],
   row:L=>{const k=kk=>sumQ(L.filter(e=>e.kind===kk),'v');return [fx(k('col'),1),fx(k('beam'),1),fx(k('slab'),1),fx(sumQ(L,'v')-k('col')-k('beam')-k('slab'),1),fx(sumQ(L,'v'),1),fx(sumQ(L,'fw'),0),String(L.length),String(cntRv(L))]}},
  basis:['Geometry: outlines and centrelines traced by the AI on the sheet image, snapped onto the PDF\'s own drawn lines where possible, and converted with the sheet scale (checked against printed dimensions). Printed span dimensions win over measured lengths.',
   'Beams: one element per span, support centre to support centre, less half of any column at each end; measured below the slab (overall depth minus slab thickness). Formwork = 2 sides below slab + soffit.',
   'Columns: section x height; height from the sheet if printed, otherwise 4.0 m assumed (shown in each expression). Formwork = perimeter x height.',
   'Slabs: panel area to the centrelines of the surrounding beams x thickness. Soffit formwork deducts half the typical beam width along the panel edge.',
   'Marks and sizes are read by the AI from labels, schedules and notes across the set. Items marked Needs review were inferred or missing a size; check them before issuing.',
   'Not included unless measured above: openings, drops, haunches, kickers, beam-to-beam deductions, reinforcement.'],
  category:t=>{const E=t.elements,C=XC;
   const G=groupsOf(E,e=>`${e.floor}|${e.grade}|${e.type}|${e.name}|${e.sec}`).sort((a,b)=>FI(a.floor)-FI(b.floor)||String(a.grade).localeCompare(String(b.grade))||TYPE_ORDER[a.type]-TYPE_ORDER[b.type]||a.name.localeCompare(b.name)||a.sec.localeCompare(b.sec));
   const rows=[];let lf=null,lg=null;
   G.forEach((g,k)=>{const newF=g.floor!==lf,newG=newF||g.grade!==lg;const r=[newF?g.floor:'',newG?String(g.grade):'',g.type,`${g.name} ${g.sec}`,String(g.n),fx(g.v,3),fx(g.fw,2),fx(g.fs,2),g.rv?String(g.rv):''];r._color={8:C.warn};rows.push(r);lf=g.floor;lg=g.grade;
    const nx=G[k+1];if(!nx||nx.floor!==g.floor){const S=G.filter(x=>x.floor===g.floor),s=q=>S.reduce((a,x)=>a+x[q],0);const r2=['',`Subtotal ${g.floor}`,'','',String(s('n')),fx(s('v'),3),fx(s('fw'),2),fx(s('fs'),2),s('rv')?String(s('rv')):''];r2._sub=1;rows.push(r2)}});
   const tr=['Total','','','',String(E.length),fx(sumQ(E,'v'),3),fx(sumQ(E,'fw'),2),fx(sumQ(E,'fs'),2),String(cntRv(E))];tr._tot=1;rows.push(tr);
   return {cols:xFill([{l:'Floor',w:110},{l:'Concrete grade',w:110},{l:'Element type',w:130},{l:'Name / section',w:200},{l:'Count',w:80,align:'right'},{l:'Volume (m³)',w:120,align:'right'},{l:'Area of formwork (m²)',w:150,align:'right'},{l:'Formwork to soffit (m²)',w:150,align:'right'},{l:'Review',w:0,align:'right'}]),rows}},
  schedule:t=>{const C=XC,S=t.elements.slice().sort((a,b)=>FI(a.floor)-FI(b.floor)||a.sheet-b.sheet||TYPE_ORDER[a.type]-TYPE_ORDER[b.type]||a.tag.localeCompare(b.tag));
   return {cols:xFill([{l:'Sheet / ID',w:120,bold:true},{l:'Floor',w:75},{l:'Grid',w:125},{l:'Type',w:95},{l:'Name / section',w:140},{l:'Length / area',w:100,align:'right'},{l:'Volume (m³)',w:100,align:'right'},{l:'Formwork (m²)',w:105,align:'right'},{l:'Conf.',w:60,align:'right'},{l:'Status',w:0}]),
    rows:S.map(e=>{const r=[`${e.sheetLabel} / ${e.tag}`,e.floor,e.loc,e.type,`${e.name} ${e.sec}`,e.kind==='slab'?fx(e.q.fs,2)+' m²':fx(e.len,2)+' m',fx(e.q.v,3),fx(e.q.fw,2),e.conf+'%',stTxt(e)];r._color={9:stCol(e)};return r})}},
  band:L=>({legend:['col','beam','slab','wall','fdn'].map(k=>{const n=L.filter(e=>e.kind===k);return n.length&&[k,KIND_LBL.find(x=>x[0]===k)[1],`${n.length} · ${fx(sumQ(n,'v'),1)} m³ · ${fx(sumQ(n,'fw'),0)} m² fwk`]}).filter(Boolean),total:['Total concrete',`${fx(sumQ(L,'v'),1)} m³`]}),
  tag:e=>e.kind==='slab'?`${e.tag} ${e.name}`:e.tag,
 },
 fin:{
  short:'Finishes',name:'Finishes',cover:'Finishes Takeoff',fillNote:'Rooms, wall-finish lines, doors and windows in their legend colours',catNote:'Floor › finish › code',schedName:'Room schedule',
  tiles:E=>[['Floor finish',fx(sumQ(E,'floor'),1),'m²'],['Wall finish',fx(sumQ(E,'wall'),1),'m²'],['Rooms measured',String(finRooms(E).length),`${E.filter(e=>e.kind==='door').length} doors · ${E.filter(e=>e.kind==='win').length} windows`]],
  floors:{title:'Finish quantities by floor',cols:[['Floor',130],['Floor fin. m²',115],['Wall fin. m²',115],['Skirting m',105],['Susp. ceiling m²',125],['Ceiling fin. m²',120],['Waterproof. m²',125],['Rooms',90],['Review',170]],
   row:L=>[fx(sumQ(L,'floor'),1),fx(sumQ(L,'wall'),1),fx(sumQ(L,'skirt'),1),fx(sumQ(L,'susp'),1),fx(sumQ(L,'ceil'),1),fx(sumQ(L,'wp'),1),String(finRooms(L).length),String(cntRv(L))]},
  basis:['Geometry: room outlines traced by the AI and snapped onto the PDF\'s own drawn wall lines; lengths and areas measured at the sheet scale (checked against printed dimensions).',
   'Floor finish, suspended ceiling and ceiling finish: room area (shoelace) less the footprint of columns, walls and other elements standing inside the room.',
   'Wall finish: wall-edge length x layer height (floor to ceiling, or the layer\'s own band), less door, window and opening frames on that edge for the part inside each band. Windows need a sill height to be deducted.',
   'Skirting: total length of the wall edges. Waterproofing: floor area + wall edges x upturn height.',
   'Finish codes, heights and door / window sizes come from the room finish schedule, legends and room tags; each item records where it was read.',
   'Not included unless measured above: reveals, door and window linings, finishes to free-standing columns, stair finishes not scheduled as rooms.'],
  category:t=>{const E=t.elements,catOf=k=>FIN_CATS.find(c=>c[0]===k),G={};
   E.forEach(e=>e.items.forEach(it=>{const key=`${e.floor}|${it.cat}|${it.code}|${it.name}`;const g=G[key]=G[key]||{floor:e.floor,cat:it.cat,code:it.code,name:it.name,qty:0,rooms:new Set(),rv:new Set()};g.qty+=it.qty;g.rooms.add(e.roomId||e.id);if(e.status==='rv')g.rv.add(e.id)}));
   const ord=Object.fromEntries(FIN_CATS.map((c,i)=>[c[0],i])),L=Object.values(G).sort((a,b)=>FI(a.floor)-FI(b.floor)||ord[a.cat]-ord[b.cat]||String(a.code).localeCompare(String(b.code)));
   const rows=[];let lf=null;
   L.forEach((g,i)=>{const c=catOf(g.cat),r=[g.floor!==lf?g.floor:'',c[1],g.code||'—',g.name||'',String(g.rooms.size),fx(g.qty,2),c[2],g.rv.size?String(g.rv.size):''];r._color={7:XC.warn};rows.push(r);lf=g.floor;
    const nx=L[i+1];if(!nx||nx.floor!==g.floor)FIN_CATS.forEach(([k,l,u])=>{const S=L.filter(x=>x.floor===g.floor&&x.cat===k);if(S.length){const r2=['',`Subtotal ${g.floor} · ${l}`,'','','',fx(S.reduce((a,x)=>a+x.qty,0),2),u,''];r2._sub=1;rows.push(r2)}})});
   FIN_CATS.forEach(([k,l,u])=>{const S=L.filter(x=>x.cat===k);if(S.length){const r=[`Total · ${l}`,'','','','',fx(S.reduce((a,x)=>a+x.qty,0),2),u,''];r._tot=1;rows.push(r)}});
   return {cols:xFill([{l:'Floor',w:110},{l:'Finish',w:150},{l:'Code',w:90},{l:'Description',w:345},{l:'Rooms',w:75,align:'right'},{l:'Quantity',w:120,align:'right'},{l:'Unit',w:60},{l:'Review',w:0,align:'right'}]),rows}},
  schedule:t=>{const E=t.elements,R=finRooms(E).slice().sort((a,b)=>FI(a.floor)-FI(b.floor)||a.sheet-b.sheet||String(a.name).localeCompare(String(b.name)));
   const sumR=r=>{const q={};FIN_CATS.forEach(([k])=>q[k]=0);E.filter(e=>e.roomId===r.id).forEach(e=>FIN_CATS.forEach(([k])=>q[k]+=e.q[k]||0));return q};
   return {cols:xFill([{l:'Sheet / ID',w:115,bold:true},{l:'Floor',w:70},{l:'Room',w:185},...FIN_CATS.map(([,l,u])=>({l:`${l.replace(' finish',' fin.').replace('Suspended','Susp.')} (${u})`,w:95,align:'right'})),{l:'Conf.',w:55,align:'right'},{l:'Status',w:0}]),
    rows:R.map(e=>{const q=sumR(e),rv=e.status==='rv'||E.some(x=>x.roomId===e.id&&x.status==='rv'),r=[`${e.sheetLabel} / ${e.tag}`,e.floor,e.name,...FIN_CATS.map(([k])=>q[k]?fx(q[k],2):''),e.conf+'%',rv?'Needs review':e.status==='ck'?'Checked':'Recognized'];r._color={[4+FIN_CATS.length]:rv?XC.warn:e.status==='ck'?XC.ok:XC.ink2};return r})}},
  band:L=>({legend:[['room','Rooms',`${finRooms(L).length} · floor ${fx(sumQ(L,'floor'),1)} m²`],['wfin','Wall finish',`${L.filter(e=>e.kind==='wfin').length} lines · ${fx(sumQ(L,'wall'),1)} m²`],['door','Doors',String(L.filter(e=>e.kind==='door').length)],['win','Windows',String(L.filter(e=>e.kind==='win').length)]].filter(x=>L.some(e=>e.kind===x[0])),
   total:['Floor finish',`${fx(sumQ(L,'floor'),1)} m²`]}),
  tag:e=>e.kind==='room'?e.name:e.pt?(e.raw&&e.raw.mark||''):'',
 },
 steel:{
  short:'Steel',name:'Structural Steel',cover:'Structural Steel Takeoff',fillNote:'Members, columns and connections in their legend colours',catNote:'Floor › member type › profile; connections by detail',schedName:'Member & connection schedule',
  tiles:E=>[['Steel length',fx(sumQ(E,'len'),1),'m (weights from kg/m to follow)'],['Members',String(stlMembers(E).reduce((a,e)=>a+e.q.n,0)),`${stlJoints(E).reduce((a,e)=>a+e.q.n,0)} connections`],['Connections',`${sumQ(E,'bolts')}`,`bolts · plates ${fx(sumQ(E,'pa'),2)} m² / ${fx(sumQ(E,'pv'),3)} m³`]],
  floors:{title:'Steel length by floor (m)',cols:[['Floor',120],['Columns',95],['Beams',95],['Bracing',90],['Purlin/girt',100],['Rafter/truss',105],['Secondary',95],['Total m',100],['Plates m²',100],['Bolts',85],['Review',110]],
   row:L=>{const k=kk=>fx(sumQ(L.filter(e=>e.kind===kk),'len'),1);return [k('scol'),k('sbeam'),k('sbrc'),k('spur'),k('struss'),k('ssec'),fx(sumQ(L,'len'),1),fx(sumQ(L,'pa'),2),String(sumQ(L,'bolts')),String(cntRv(L))]}},
  basis:['Geometry: member centrelines traced by the AI and snapped onto the drawn crossings in the PDF (grid lines, supporting members); lengths at the view\'s scale. Printed lengths win over measured ones.',
   'Columns on plans: top level - bottom level read from sections, elevations or schedules; the source is recorded for every column.',
   'Sloping members shown on plan: plan length / cos(roof pitch). Repeats stated on the drawing are counted with the quoted note. Each physical member is measured once, in the view where its length is true.',
   'Connections: plates and bolts from the connection details. Plate area = length x width, volume = length x width x thickness, per joint x number of joints.',
   'Weights are not included yet: lengths are grouped by profile, ready for the kg/m of each profile to be applied.',
   'Not included unless measured above: welds, holes, cleats and stiffeners not shown in the details, painting and galvanizing.'],
  category:t=>{const E=t.elements,G={};
   E.forEach(e=>{const j=e.kind==='sjoint',key=j?`${e.floor}|Connection|${e.name}|${e.boltSpec}`:`${e.floor}|${e.type}|${e.profile}`;
    const g=G[key]=G[key]||{floor:e.floor,type:e.type,name:j?e.name:(e.profile||'(profile not read)'),sec:j?`${e.sec}${e.boltSpec?' · '+e.boltSpec:''}`:'',j,len:0,n:0,pa:0,pv:0,bolts:0,rv:0};
    g.len+=e.q.len;g.n+=e.q.n;g.pa+=e.q.pa;g.pv+=e.q.pv;g.bolts+=e.q.bolts;if(e.status==='rv')g.rv++});
   const ord=x=>x.j?99:STL_TYPE_ORDER.indexOf(x.type),L=Object.values(G).sort((a,b)=>FI(a.floor)-FI(b.floor)||ord(a)-ord(b)||String(a.name).localeCompare(String(b.name)));
   const rows=[];let lf=null;const s=(S,q)=>S.reduce((a,x)=>a+x[q],0);
   L.forEach((g,i)=>{const r=[g.floor!==lf?g.floor:'',g.type,g.name+(g.sec?'  '+g.sec:''),g.len?fx(g.len,2):'',String(g.n),g.pa?fx(g.pa,3):'',g.pv?fx(g.pv,4):'',g.bolts?String(g.bolts):'',g.rv?String(g.rv):''];r._color={8:XC.warn};rows.push(r);lf=g.floor;
    const nx=L[i+1];if(!nx||nx.floor!==g.floor){const S=L.filter(x=>x.floor===g.floor),r2=['',`Subtotal ${g.floor}`,'',fx(s(S,'len'),2),String(s(S,'n')),fx(s(S,'pa'),3),fx(s(S,'pv'),4),String(s(S,'bolts')),s(S,'rv')?String(s(S,'rv')):''];r2._sub=1;rows.push(r2)}});
   const tr=['Total','','',fx(s(L,'len'),2),String(s(L,'n')),fx(s(L,'pa'),3),fx(s(L,'pv'),4),String(s(L,'bolts')),String(cntRv(E))];tr._tot=1;rows.push(tr);
   return {cols:xFill([{l:'Floor',w:100},{l:'Item',w:130},{l:'Profile / detail',w:290},{l:'Length (m)',w:110,align:'right'},{l:'Number',w:80,align:'right'},{l:'Plate area (m²)',w:120,align:'right'},{l:'Plate vol. (m³)',w:120,align:'right'},{l:'Bolts',w:70,align:'right'},{l:'Review',w:0,align:'right'}]),rows}},
  schedule:t=>{const S=t.elements.slice().sort((a,b)=>FI(a.floor)-FI(b.floor)||a.sheet-b.sheet||(a.kind==='sjoint')-(b.kind==='sjoint')||STL_TYPE_ORDER.indexOf(a.type)-STL_TYPE_ORDER.indexOf(b.type)||String(a.tag).localeCompare(String(b.tag)));
   return {cols:xFill([{l:'Sheet / ID',w:115,bold:true},{l:'Floor',w:65},{l:'Grid',w:85},{l:'Type',w:95},{l:'Mark',w:65},{l:'Profile / detail',w:170},{l:'Each (m)',w:70,align:'right'},{l:'No.',w:45,align:'right'},{l:'Total (m)',w:80,align:'right'},{l:'Plates (m²)',w:80,align:'right'},{l:'Bolts',w:55,align:'right'},{l:'Conf.',w:50,align:'right'},{l:'Status',w:0}]),
    rows:S.map(e=>{const j=e.kind==='sjoint',r=[`${e.sheetLabel} / ${e.tag}`,e.floor,e.loc,e.type,j?e.name:(e.raw.mark||'—'),j?e.sec:(e.profile||'—'),j||!e.q.n?'':fx(e.q.len/e.q.n,3),String(e.q.n),j?'':fx(e.q.len,3),j?fx(e.q.pa,3):'',j?String(e.q.bolts):'',e.conf+'%',stTxt(e)];r._color={12:stCol(e)};return r})}},
  band:L=>({legend:[...KIND_LBL.filter(([k])=>k[0]==='s'&&k!=='sjoint'&&L.some(e=>e.kind===k)).map(([k,l])=>{const n=L.filter(e=>e.kind===k);return [k,l,`${n.reduce((a,e)=>a+e.q.n,0)} · ${fx(sumQ(n,'len'),1)} m`]}),
   ...(L.some(e=>e.kind==='sjoint')?[['sjoint','Connections',`${stlJoints(L).reduce((a,e)=>a+e.q.n,0)} · ${sumQ(L,'bolts')} bolts`]]:[])],total:['Steel length',`${fx(sumQ(L,'len'),1)} m`]}),
  tag:e=>e.kind==='sjoint'?'':e.name,
 },
};
const stTxt=e=>e.status==='rv'?'Needs review':e.status==='ck'?'Checked':'Recognized';
let XC={};const stCol=e=>e.status==='rv'?XC.warn:e.status==='ck'?XC.ok:XC.ink2;

/* ---- pdf-lib drawing ---- */
const WIN=s=>String(s).replace(/−/g,'-').replace(/[≥]/g,'>=').replace(/[≤]/g,'<=').replace(/[✓]/g,'v').replace(/[⚠]/g,'!').replace(/[≈]/g,'~').replace(/[Ø]/g,'O').replace(/[^\x20-\x7E -ÿ–—‘’“”•…€]/g,'?');
async function generatePdf(t,{opt:o0,sheets:SH,onProgress}={}){
 const xState={opt:{fill:true,tags:true,review:true,band:true,summary:true,category:true,reviewList:true,schedule:true,...(o0||{})},sheets:SH||new Set(t.srcs)};
 const xmsg=(m,p)=>{if(onProgress)onProgress(m,p)};
 const Lb=window.PDFLib;if(!Lb)throw new Error('The PDF writer could not load.');
 const {PDFDocument,rgb,StandardFonts,degrees}=Lb;
 const o=xState.opt,R=repOf(t);
 try{
 xmsg('Reading source drawing…',.05);await sleep(20);
 const files=[...new Set(t.srcs.map(s=>sheetOf(s)).filter(Boolean).map(s=>s.file))];const fileNames=files.map(f=>f.name).join(', ');
 for(const f of files)await srcLib(f);
 const out=await PDFDocument.create({updateMetadata:false});out.setCreationDate(new Date());out.setTitle(`${R.name} takeoff - ${fileNames}`);out.setAuthor('Measure.AI');out.setCreator('Measure.AI');out.setProducer('Measure.AI');
 const F=await out.embedFont(StandardFonts.Helvetica),FB=await out.embedFont(StandardFonts.HelveticaBold);
 const W=1191,H=842,M=48;
 const C={ink:rgb(.12,.14,.16),ink2:rgb(.3,.33,.37),ink3:rgb(.55,.58,.62),line:rgb(.84,.86,.89),acc:rgb(.1,.44,.88),acc2:rgb(.91,.95,.99),warn:rgb(.78,.47,0),red:rgb(.86,.18,.18),ok:rgb(.12,.62,.33),zebra:rgb(.965,.97,.98),sub:rgb(.93,.945,.96)};
 XC=C;
 const h2r=h=>rgb(parseInt(h.slice(1,3),16)/255,parseInt(h.slice(3,5),16)/255,parseInt(h.slice(5,7),16)/255);
 const TC=Object.fromEntries(Object.entries(COLORS).map(([k,v])=>[k,h2r(v)]));   // same colours as the canvas legend
 const dark=c=>rgb(c.red*.62,c.green*.62,c.blue*.62);
 const now=new Date();const dateTxt=now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})+' '+now.toTimeString().slice(0,5);
 const txt=(pg,s,x,y,size=9,font=F,color=C.ink,opts={})=>{s=WIN(s);if(opts.maxW){while(font.widthOfTextAtSize(s,size)>opts.maxW&&s.length>3)s=s.slice(0,-2)+'…'}const w=font.widthOfTextAtSize(s,size);if(opts.align==='right')x-=w;if(opts.align==='center')x-=w/2;pg.drawText(s,{x,y,size,font,color,...(opts.rotate!=null?{rotate:degrees(opts.rotate)}:{})});return w};
 const reportPages=[];
 const newReport=(title)=>{const pg=out.addPage([W,H]);reportPages.push(pg);
  pg.drawRectangle({x:0,y:H-40,width:W,height:40,color:rgb(.97,.975,.985)});pg.drawLine({start:{x:0,y:H-40},end:{x:W,y:H-40},thickness:.6,color:C.line});
  txt(pg,'Measure.AI',M,H-25,11,FB,C.acc);txt(pg,`Quantity Takeoff · ${R.name}`,M+74,H-25,10,F,C.ink2);
  txt(pg,fileNames,W-M,H-25,10,F,C.ink2,{align:'right',maxW:520});
  if(title)txt(pg,title,M,H-84,20,FB,C.ink);
  return pg};
 const table=(cols,rows,{title,startY=H-110,rowH=15,head=10,size=8.5,zebra=true}={})=>{
  let pg=newReport(title);let y=startY;
  const drawHead=()=>{pg.drawRectangle({x:M,y:y-4,width:W-2*M,height:rowH+2,color:C.acc2});let x=M+4;cols.forEach(c=>{txt(pg,c.l,c.align==='right'?x+c.w-8:x,y,head,FB,C.ink2,{align:c.align,maxW:c.w-6});x+=c.w});y-=rowH+4};
  drawHead();
  rows.forEach((r,i)=>{
   if(y<M+30){pg=newReport(title?title+' (cont.)':'');y=startY;drawHead()}
   if(r._sub)pg.drawRectangle({x:M,y:y-4,width:W-2*M,height:rowH,color:C.sub});
   else if(r._tot)pg.drawRectangle({x:M,y:y-4,width:W-2*M,height:rowH,color:C.acc2});
   else if(zebra&&i%2)pg.drawRectangle({x:M,y:y-4,width:W-2*M,height:rowH,color:C.zebra});
   let x=M+4;cols.forEach((c,k)=>{const v=r[k];const fnt=(r._sub||r._tot||c.bold)?FB:F;const col=r._color&&r._color[k]?r._color[k]:C.ink;if(v!=null&&v!=='')txt(pg,v,c.align==='right'?x+c.w-8:x,y,size,fnt,col,{align:c.align,maxW:c.w-6});x+=c.w});
   y-=rowH;
  });
  return {pg,y};
 };
 const E=t.elements,floors=floorsOf(E),dpis=[...new Set(t.jobs.map(j=>j.img&&j.img.dpi).filter(Boolean))].join('/')||CF_DPI;
 let step=0;const steps=(o.summary?1:0)+(o.category?1:0)+(o.reviewList?1:0)+xState.sheets.size+(o.schedule?1:0);
 const prog=async m=>{step++;xmsg(m,.1+.85*step/Math.max(1,steps));await sleep(10)};

 /* summary */
 if(o.summary){await prog('Writing summary…');
  const pg=newReport('');
  txt(pg,R.cover,M,H-100,30,FB,C.ink);
  txt(pg,`Measured by AI from ${t.srcs.length} drawing sheet${t.srcs.length===1?'':'s'} · draft for QS review`,M,H-124,12,F,C.ink2);
  const info=[['Drawing set',`${fileNames} · ${files.reduce((a,f)=>a+(f.count||f.pages),0)} sheets`],['Sheets measured',t.srcs.map(s=>shLabel(s)).join(', ')],['Measurement',`${t.tool} · ${dpis} DPI image`],['Scale used',t.jobs.filter(j=>j.scale).map(j=>`${shLabel(j.p)} ${j.scale.k?'1:'+Math.round(j.scale.k):'none'}`).join(', ')||'—'],['Prepared',dateTxt]];
  let y=H-158;info.forEach(([k,v])=>{txt(pg,k,M,y,9,FB,C.ink3);txt(pg,v,M+130,y,9.5,F,C.ink,{maxW:W-2*M-140});y-=15});
  // KPI tiles: three from the tool, the fourth is always the review count
  const rv=cntRv(E),ckn=E.filter(e=>e.status==='ck').length;
  const tiles=[...R.tiles(E),['Needs review',String(rv),`${ckn} checked by QS`]];
  const tw=(W-2*M-36)/4;tiles.forEach(([l,v,u],i)=>{const x=M+i*(tw+12),yy=H-390,warn=i===3&&rv;pg.drawRectangle({x,y:yy,width:tw,height:96,borderColor:C.line,borderWidth:.8,color:warn?rgb(1,.97,.92):rgb(1,1,1)});
   txt(pg,l.toUpperCase(),x+14,yy+74,8,FB,C.ink3);txt(pg,v,x+14,yy+38,30,FB,warn?C.warn:C.ink,{maxW:tw-28});txt(pg,u,x+14,yy+16,9.5,F,C.ink2,{maxW:tw-28})});
  // totals by floor
  const FT=R.floors;y=H-430;txt(pg,FT.title,M,y,13,FB,C.ink);y-=22;
  pg.drawRectangle({x:M,y:y-4,width:W-2*M,height:17,color:C.acc2});let x=M+4;FT.cols.forEach(([l,w],i)=>{txt(pg,l,i?x+w-8:x,y,9,FB,C.ink2,{align:i?'right':undefined,maxW:w-6});x+=w});y-=19;
  const fl=floors.slice(0,Math.max(1,Math.floor((y-M-200)/18)));
  fl.forEach((f,i)=>{const vals=[f,...FT.row(E.filter(e=>e.floor===f))];if(i%2)pg.drawRectangle({x:M,y:y-5,width:W-2*M,height:18,color:C.zebra});
   let x=M+4;FT.cols.forEach(([l,w],j)=>{txt(pg,vals[j],j?x+w-8:x,y,9.5,F,C.ink,{align:j?'right':undefined,maxW:w-6});x+=w});y-=18});
  if(fl.length<floors.length){txt(pg,`+ ${floors.length-fl.length} more floors in Quantity by category`,M+4,y,8.5,F,C.ink3);y-=16}
  pg.drawLine({start:{x:M,y:y+12},end:{x:W-M,y:y+12},thickness:.8,color:C.ink3});
  const tv=['Total',...FT.row(E)];x=M+4;FT.cols.forEach(([l,w],j)=>{txt(pg,tv[j],j?x+w-8:x,y,10,FB,C.ink,{align:j?'right':undefined,maxW:w-6});x+=w});
  // basis
  y-=34;txt(pg,'Basis of measurement',M,y,13,FB,C.ink);y-=18;
  const wrap=(s,max,size)=>{const out=[];let line='';WIN(s).split(' ').forEach(w=>{const tr=line?line+' '+w:w;if(F.widthOfTextAtSize(tr,size)>max&&line){out.push(line);line=w}else line=tr});if(line)out.push(line);return out};
  R.basis.forEach(s=>{if(y<M+20)return;txt(pg,'•',M+2,y,9.5,F,C.ink2);wrap(s,W-2*M-20,9.5).forEach(l=>{if(y<M+20)return;txt(pg,l,M+14,y,9.5,F,C.ink2);y-=13});y-=3});
 }
 /* category */
 if(o.category){await prog('Writing quantity by category…');const {cols,rows}=R.category(t);table(cols,rows,{title:'Quantity by category',rowH:16})}
 /* review list */
 const RV=E.filter(e=>e.status==='rv');
 if(o.reviewList&&RV.length){await prog('Writing needs-review list…');
  // one row per reason (not per item): the reason, how many, which types, the first ids (each item's full reasons are in the app)
  table(xFill([{l:'Why it needs review',w:330,bold:true},{l:'Items',w:50,align:'right'},{l:'Types',w:190},{l:'Items (sheet / ID)',w:0}]),rvGroups(RV).map(g=>{const ids=g.items.map(e=>`${e.sheetLabel}/${e.tag}`);return [g.label,String(g.n),[...g.types].join(', '),ids.slice(0,10).join(', ')+(ids.length>10?` … +${ids.length-10} more`:'')]}),{title:`Needs review · ${RV.length} items by reason`,rowH:15,size:8});
 }
 /* annotated sheets */
 for(const s of t.srcs){if(!xState.sheets.has(s))continue;const sh=sheetOf(s);if(!sh)continue;await prog(`Annotating ${shName(s)}…`);
  const [pg]=await out.copyPages(await srcLib(sh.file),[sh.page-1]);out.addPage(pg);
  const PW=pg.getWidth(),PH=pg.getHeight(),tk=Math.max(1,Math.max(PW,PH)/1191);   // sheet size; tag text and marks grow with bigger sheets
  const band=o.band?64:0;
  if(band){pg.setMediaBox(0,-band,PW,PH+band);try{pg.setCropBox(0,-band,PW,PH+band)}catch(e){}}
  const L=(t.bySrc[s]||[]).slice().sort((a,b)=>KIND_ORDER[a.kind]-KIND_ORDER[b.kind]);
  const rvOn=e=>o.review&&e.status==='rv';
  for(const e of L){
   const col=TC[e.kind]||C.ink3;
   if(e.kind==='wfin'||e.lineOnly){   // lines: wall finish along the wall face, steel centrelines
    const path='M'+e.line.map(p=>`${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' L ');
    pg.drawSvgPath(path,{x:0,y:PH,borderColor:rvOn(e)?C.red:e.status==='ck'?C.ok:col,borderWidth:(e.kind==='wfin'?1.1:1.4)*tk,borderOpacity:o.fill||rvOn(e)?.9:.5,...(rvOn(e)?{borderDashArray:[2*tk,1.4*tk]}:{})});
   }else if(e.pt){                    // points: doors, windows, steel columns, connections
    const off=e.ptOff?3.2*tk:0,cx=e.pt[0]+off,cy=PH-e.pt[1]-off,r=2.3*tk,lab=e.ptTxt??(e.kind==='door'?'D':e.kind==='win'?'W':'');
    pg.drawCircle({x:cx,y:cy,size:r,color:o.fill?col:rgb(1,1,1),borderColor:rvOn(e)?C.red:o.fill?rgb(1,1,1):col,borderWidth:rvOn(e)?.8:.4});
    if(lab&&o.fill){const sz=r*1.15,w=FB.widthOfTextAtSize(lab,sz);pg.drawText(lab,{x:cx-w/2,y:cy-sz*.36,size:sz,font:FB,color:rgb(1,1,1)})}
   }else{                             // areas: concrete elements, rooms
    const path='M'+e.poly.map(p=>`${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' L ')+' Z',op={x:0,y:PH};
    if(o.fill)Object.assign(op,{color:col,opacity:['slab','fdn','stair','room'].includes(e.kind)?.15:e.kind==='beam'||e.kind==='wall'?.42:.55});
    if(rvOn(e))Object.assign(op,{borderColor:C.red,borderWidth:.6,borderDashArray:[1.6,1.1],borderOpacity:1});
    else if(e.status==='ck')Object.assign(op,{borderColor:C.ok,borderWidth:.5,borderOpacity:1});
    else if(o.fill)Object.assign(op,{borderColor:col,borderWidth:e.kind==='room'?.6:.25,borderOpacity:.9});
    pg.drawSvgPath(path,op);
   }
   if(o.tags){const label=WIN(R.tag(e)||'');if(!label)continue;
    let cx,cy,ang=0,size=(['slab','room'].includes(e.kind)?3.2:2.5)*tk;
    if(e.pt){cx=e.pt[0];cy=e.pt[1]-4*tk}
    else if(e.line&&e.line.length>=2){const i=Math.floor((e.line.length-1)/2),a=e.line[i],b=e.line[i+1];cx=(a[0]+b[0])/2;cy=(a[1]+b[1])/2;ang=-Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;if(ang>90)ang-=180;if(ang<-90)ang+=180}
    else{const xs=e.poly.map(p=>p[0]),ys=e.poly.map(p=>p[1]);cx=xs.reduce((a,b)=>a+b)/xs.length;cy=ys.reduce((a,b)=>a+b)/ys.length;if(e.kind==='slab')cy+=4}
    const w=F.widthOfTextAtSize(label,size),r=ang*Math.PI/180,X=cx-Math.cos(r)*w/2+Math.sin(r)*size*.35,Y=(PH-cy)-Math.sin(r)*w/2-Math.cos(r)*size*.35;
    pg.drawText(label,{x:X,y:Y,size,font:['slab','room'].includes(e.kind)?F:FB,color:rvOn(e)?C.red:dark(TC[e.kind]||C.ink),rotate:degrees(ang)})}
  }
  if(band){const by=-band,B=R.band(L);pg.drawRectangle({x:0,y:by,width:PW,height:band,color:rgb(1,1,1)});pg.drawLine({start:{x:0,y:0},end:{x:PW,y:0},thickness:.8,color:C.acc});
   pg.drawRectangle({x:0,y:by,width:6,height:band,color:C.acc});
   txt(pg,'Measure.AI takeoff',22,by+42,10,FB,C.acc);txt(pg,`${shName(s)} · ${(L[0]||{}).floor||''}`,22,by+27,9,F,C.ink,{maxW:330});txt(pg,`${t.tool} · ${dateTxt}`,22,by+13,8,F,C.ink3,{maxW:340});
   const items=[...B.legend,['rv','Needs review',`${cntRv(L)} items${L.some(e=>e.status==='ck')?` · ${L.filter(e=>e.status==='ck').length} checked`:''}`]];
   const step=Math.min(170,(PW-380-190)/items.length);let lx=380;
   items.forEach(([k,l,sub])=>{if(k==='rv')pg.drawRectangle({x:lx,y:by+36,width:12,height:9,borderColor:C.red,borderWidth:1,borderDashArray:[2,1.5]});else pg.drawRectangle({x:lx,y:by+36,width:12,height:9,color:TC[k]||C.ink3,opacity:['slab','room'].includes(k)?.35:.8});
    txt(pg,l,lx+17,by+37,9,FB,C.ink,{maxW:step-22});txt(pg,sub,lx+17,by+23,8,F,C.ink2,{maxW:step-22});lx+=step});
   txt(pg,B.total[0],PW-30,by+42,8,F,C.ink3,{align:'right'});txt(pg,B.total[1],PW-30,by+20,16,FB,C.ink,{align:'right'});
  }
 }
 /* schedule */
 if(o.schedule){await prog(`Writing ${R.schedName.toLowerCase()}…`);const {cols,rows}=R.schedule(t);if(rows.length)table(cols,rows,{title:`Appendix · ${R.schedName}`,rowH:13.4,size:7.8})}
 /* footers */
 const all=out.getPages();const N=all.length;
 all.forEach((pg,i)=>{if(!reportPages.includes(pg))return;pg.drawLine({start:{x:M,y:30},end:{x:W-M,y:30},thickness:.5,color:C.line});
  txt(pg,`Generated ${dateTxt} by Measure.AI · ${t.tool} · Source ${fileNames} · Check items marked Needs review`,M,18,7.5,F,C.ink3,{maxW:W-2*M-80});txt(pg,`Page ${i+1} of ${N}`,W-M,18,7.5,F,C.ink3,{align:'right'})});
 xmsg('Saving PDF…',.97);await sleep(10);
 const bytes=await out.save({useObjectStreams:true});
 return {bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),pages:N};
 }finally{}
}

