/* Measure.AI engine — steel build. Extracted from the measuring code; no page layout or DOM here. */
const STL_TOOL='Steel Measure';
const STL_KIND={column:'scol',beam:'sbeam',bracing:'sbrc',purlin:'spur',girt:'spur',rafter:'struss',truss:'struss',sag_rod:'ssec',tie_rod:'ssec',stair:'ssec',handrail:'ssec',other:'ssec'};
const STL_TYPE={column:'Steel column',beam:'Steel beam',bracing:'Bracing',purlin:'Purlin',girt:'Girt',rafter:'Rafter',truss:'Truss member',sag_rod:'Sag rod',tie_rod:'Tie rod',stair:'Steel stair',handrail:'Handrail',other:'Other steel'};
const STL_TYPE_ORDER=Object.values(STL_TYPE);
const CONN_NAME={base_plate:'Base plate',end_plate:'End plate',fin_plate:'Fin plate',splice:'Splice',gusset:'Gusset plate',cap_plate:'Cap plate',stiffener:'Stiffener',cleat:'Cleat',other:'Connection'};
const FAMILY_NAME={wf:'WF / H',channel:'Channel',lip_channel:'Lip channel',z:'Z section',angle:'Angle',tee:'Tee',chs:'CHS (pipe)',rhs:'RHS',shs:'SHS',rod:'Rod / bar',flat:'Flat bar',plate:'Plate',other:'Other'};

function stlBuild(t,j,R){
 if(!R)throw new Error('no answer for this sheet');j.result=R;const G=t.run.result;
 const s=sheetOf(j.p),pw=j.pw,ph=j.ph,PW=pw/72*25.4,PH=ph/72*25.4;
 const P=([x,y])=>[x/1000*pw,y/1000*ph];
 const pm=(a,b)=>Math.hypot((b[0]-a[0])/1000*PW,(b[1]-a[1])/1000*PH);   // paper mm
 const {k,warn}=sheetScale(j,R,s),want=new Set(t.kinds);
 const types={};G.types.forEach(x=>{if(x.mark){types[x.mark.toLowerCase()+'|'+x.kind]=x;types[x.mark.toLowerCase()]=types[x.mark.toLowerCase()]||x}});
 const ctypes={};(G.connection_types||[]).forEach(x=>{if(x.mark)ctypes[x.mark.toLowerCase()]=x});
 const floor=s.floor||normFloor(R.sheet.level)||R.sheet.level||'—',sl=shLabel(j.p),grade=R.sheet.steel_grade||'—';
 const out=[],L=t.bySrc[j.p]=[],M=mm=>mm==null?'?':r3(mm/1000);
 const status=(W,a)=>W.length||a.needs_review?'rv':'ok';
 /* --- members (pat = {q, i, n, why, meas} for a member generated from a pattern) --- */
 const addMember=(a,pat)=>{
  if(want.size&&!want.has(a.kind)&&!(a.kind==='other'&&['sag_rod','tie_rod','stair','handrail'].some(x=>want.has(x))))return;
  const why=[],note=[];if(a.needs_review&&a.review_reason)why.push(reasonText(a.review_reason));if(pat)why.push(...pat.why);
  const ty=a.mark?(types[a.mark.toLowerCase()+'|'+a.kind]||types[a.mark.toLowerCase()]):null;
  const profile=a.profile||ty?.profile||'',fam=a.family!=='other'?a.family:(ty?.family||'other'),dims=Object.values(a.dims).some(v=>v!=null)?a.dims:(ty?.dims||a.dims);
  if(!profile&&!/^no_size/.test(a.review_reason))why.push('Profile not read');
  const kv=scaleDen(a.view_scale)||k,kSrc=a.view_scale&&scaleDen(a.view_scale)?`view scale ${a.view_scale}`:j.scale.src?j.scale.src.split(' ')[0]:'';
  const isPt=a.shape==='point'||a.pts.length<2;
  // centreline ends moved onto the drawn crossings (grid lines, supporting members) in the PDF (vector.js)
  // members named by their PDF lines (PDF lines mode, lib/region.js) are exact already: no snapping
  const fromL=!!a.lines,sn=isPt||fromL?null:snapLineNorm(j,a.pts),pts=sn?sn.pts:a.pts;
  if(pat&&sn&&j.vec&&sn.method==='none')why.push('No drawn line at this position: check the run\'s count or its first / last member');
  if(sn&&j.vec&&sn.method!=='line')note.push(sn.method==='none'?'no drawn line along this member: AI position kept (approximate)':'an end is not on a drawn crossing: AI position kept there (approximate)');
  const hasLv=a.top_level_m!=null&&a.bottom_level_m!=null,H=hasLv?Math.abs(a.top_level_m-a.bottom_level_m):null;
  let len=null,lenEx='';
  const Lg=!isPt&&kv?pts.slice(1).reduce((x,p,i)=>x+pm(pts[i],p),0)*kv/1000:null;   // drawn centreline, m
  if(a.kind==='column'&&hasLv){len=H;lenEx=`${r3(a.top_level_m)}${I_('Top level')}-${r3(a.bottom_level_m)}${I_('Bottom level')}=${r3(H)}m`;if(Lg&&Math.abs(Lg/H-1)>.2)why.push(`Drawn length ${r2(Lg)} m differs from the levels (${r2(H)} m)`)}
  else if(isPt){why.push(a.kind==='column'?'Top / bottom level not read: height unknown':'Shown as a point: length unknown')}
  else if(a.length_mm){len=a.length_mm/1000;lenEx=`${r3(len)}${I_('Printed dimension')}=${r3(len)}m`;if(Lg&&Math.abs(Lg/len-1)>.2)why.push(`Printed length ${a.length_mm} differs from the drawn length ${Math.round(Lg*1000)} by more than 20%`)}
  else if(Lg!=null){len=Lg;lenEx=`${r3(Lg)}${I_(fromL?`PDF lines ${a.lines} at ${kSrc||'the sheet scale'}`:`Drawn centreline at ${kSrc||'the sheet scale'}${sn&&sn.method==='line'?', ends on drawn crossings':sn&&j.vec?' (approximate)':''}`)}=${r3(Lg)}m`}
  else why.push('No scale on this sheet: length unknown');
  if(len!=null&&a.slope_deg&&!isPt&&a.view==='plan'){const tl=len/Math.cos(a.slope_deg*Math.PI/180);lenEx=`${lenEx.replace(/=[^=]*$/,'')}/cos(${a.slope_deg}°${I_('Roof pitch')})=${r3(tl)}m`;len=tl}
  const tot=len!=null?len*a.qty:0;
  const kk=STL_KIND[a.kind]||'ssec',id=`${t.id}.${j.p}-${a.id}`;
  const e={kind:kk,aiKind:a.kind,stl:true,tag:a.id,type:STL_TYPE[a.kind]||'Other steel',name:a.mark||profile||'(no mark)',sec:profile,loc:a.grid_ref||'—',grade,raw:pat?pat.q:a,pat:pat?pat.q.id:'',src:a.label_source,conf:Math.round(a.confidence*100),
   sheet:j.p,sheetLabel:sl,floor,id,job:j.p,q:{len:tot,n:a.qty,bolts:0,pa:0,pv:0},len:tot,profile,family:fam,attrs:[],expr:[]};
  if(isPt){const c=P(a.pts[0]),r=1.4;e.pt=c;e.ptTxt='C';e.poly=[[c[0]-r,c[1]-r],[c[0]+r,c[1]-r],[c[0]+r,c[1]+r],[c[0]-r,c[1]+r]]}
  else{e.line=pts.map(P);e.lineOnly=true;e.poly=strokePoly(e.line,1.5);e.snap=sn&&sn.method}
  e.expr=[['Length',lenEx||'not measured'],['Total length',`${len!=null?r3(len):'?'}${I_('Length')}*${a.qty}${I_(a.qty>1?(a.qty_note||'identical members'):'member')}=${r3(tot)}m`]];
  if(!isPt){e.dims=dimsOf(j,kv,pts,false,sn&&sn.segs&&sn.method!=='none'?sn.segs:null);e.expr.push(['Dimensions',dimsExpr(e.dims,kv)])}
  if(a.qty>1)note.push(`${a.qty} identical members: ${a.qty_note||'repeat stated on the drawing'}`);
  if(pat){const q=pat.q;e.expr.unshift(['Pattern',`member ${pat.i} of ${pat.n} of ${q.id}${I_(`placed evenly between the run's first and last member${q.spacing_mm?`, printed @${q.spacing_mm}`:''}${pat.meas?`, measured spacing ${Math.round(pat.meas)} mm`:''}; then snapped onto its drawn line`)}`])}
  const dd=dims||{},dimTxt=[['d',dd.d_mm],['b',dd.b_mm],['tw',dd.tw_mm],['tf',dd.tf_mm],['t',dd.t_mm],['Ø',dd.dia_mm]].filter(x=>x[1]!=null).map(([n,v])=>`${n} ${v}`).join(' · ');
  e.attrs=[['Profile',profile||'—'],['Family',FAMILY_NAME[fam]||fam],['Dimensions (mm)',dimTxt||'—'],['Measured in',`${a.view}${a.view_scale?` (${a.view_scale})`:''}`],['Length each (m)',len!=null?r3(len):'—'],['Number',a.qty],['Total length (m)',r3(tot)],
   ['Levels',hasLv?`${a.top_level_m} / ${a.bottom_level_m}`:'—'],['Levels from',a.level_ref||'—'],['Roof pitch',a.slope_deg?a.slope_deg+'°':'—'],['Steel grade',grade],['Label read',a.label_text||'—']];
  if(a.ref_sheet&&t.jobs[a.ref_sheet-1])e.attrs.push(['Info from sheet',shName(t.jobs[a.ref_sheet-1].p)]);
  if(fromL)e.attrs.push(['PDF lines',a.lines]);
  if(pat)e.attrs.unshift(['Pattern',`${pat.q.id} · member ${pat.i} of ${pat.n}${pat.q.spacing_mm?` · @${pat.q.spacing_mm}`:''}`]);
  e.status=status(why,a);e.why=why.join(' · ');e.note=note.join(' · ');
  L.push(e);out.push(e);
 };
 for(const a of R.elements)addMember(a);
 /* --- patterns: each run expanded into its members --- */
 const lerp=(a,b,u)=>[a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u],mmXY=([x,y])=>[x/1000*PW,y/1000*PH];
 for(const q of (R.patterns||[])){
  const same=q.first.length===q.last.length,F=same?q.first:[q.first[0],q.first[q.first.length-1]],La=same?q.last:[q.last[0],q.last[q.last.length-1]],n=q.count,pwhy=[];
  // spacing check: step from one member to the next = distance between the first and the last member's midpoints (on paper)
  // at scale ÷ (count − 1). Works for side-by-side runs (purlins) and for runs end to end (beam bays along one line).
  const kv=scaleDen(q.view_scale)||k;let meas=null;
  if(kv&&n>1){const a0=mmXY(F[0]),a1=mmXY(F[F.length-1]),b0=mmXY(La[0]),b1=mmXY(La[La.length-1]);
   meas=Math.hypot((b0[0]+b1[0])/2-(a0[0]+a1[0])/2,(b0[1]+b1[1])/2-(a0[1]+a1[1])/2)*kv/(n-1);
   if(q.spacing_mm&&Math.abs(meas/q.spacing_mm-1)>.1)pwhy.push(`Spacing measured ${Math.round(meas)} mm vs printed @${q.spacing_mm}: check the count or the first / last member`)}
  for(let i=0;i<n;i++){const u=n>1?i/(n-1):0;
   addMember({...q,id:`${q.id}-${i+1}`,shape:'line',pts:F.map((pp,m)=>lerp(pp,La[m],u)),qty:1,qty_note:'',top_level_m:null,bottom_level_m:null,level_ref:''},{q,i:i+1,n,why:pwhy,meas})}
 }
 /* --- connections --- */
 const addJoint=(c,rule)=>{
  const why=[],note=[];if(c.needs_review&&c.review_reason)why.push(reasonText(c.review_reason));
  const ct=c.type_mark?ctypes[c.type_mark.toLowerCase()]:null;
  const plates=c.plates.length?c.plates:(ct?.plates||[]),bo=c.bolts&&(c.bolts.count!=null||!ct)?c.bolts:(ct?.bolts||c.bolts||{});
  if(c.type_mark&&!ct&&!c.plates.length)why.push(`Detail ${c.type_mark} not found in the set`);
  if(!plates.length&&bo.count==null)why.push('No plates or bolts read for this joint');
  const okP=plates.filter(p=>p.length_mm&&p.width_mm),bad=plates.filter(p=>!p.length_mm||!p.width_mm);
  if(bad.length)why.push(`${bad.length} plate${bad.length>1?'s':''} without length / width`);
  const noT=okP.filter(p=>!p.thickness_mm);if(noT.length)why.push('Plate thickness not read: volume incomplete');
  const pa1=okP.reduce((x,p)=>x+p.length_mm*p.width_mm*p.count/1e6,0),pv1=okP.reduce((x,p)=>x+(p.thickness_mm?p.length_mm*p.width_mm*p.thickness_mm*p.count/1e9:0),0);
  const nb1=bo.count||0,q=c.qty;
  const name=c.type_mark||CONN_NAME[c.kind],kind=CONN_NAME[c.kind],id=`${t.id}.${j.p}-${c.id}`,pc=P(c.at),r=1.4;
  const boltTxt=bo.count!=null?`${bo.count}${I_(`${bo.dia_mm?'M'+bo.dia_mm:'bolts'}${bo.grade?' '+bo.grade:''}${bo.type==='anchor'?' anchor':''} per joint`)}`:'?';
  const e={kind:'sjoint',stl:true,tag:c.id,type:'Connection',name,sec:kind,loc:'—',grade,raw:c,src:ct?'schedule':'inferred',conf:Math.round(c.confidence*100),sheet:j.p,sheetLabel:sl,floor,id,job:j.p,
   pt:pc,ptTxt:'J',ptOff:true,poly:[[pc[0]-r,pc[1]-r],[pc[0]+r,pc[1]-r],[pc[0]+r,pc[1]+r],[pc[0]-r,pc[1]+r]],q:{len:0,n:q,bolts:nb1*q,pa:pa1*q,pv:pv1*q},len:0,
   boltSpec:bo.count!=null?`${bo.dia_mm?'M'+bo.dia_mm:'?'}${bo.grade?' '+bo.grade:''}${bo.type==='anchor'?' anchor':''}`:'',
   expr:[['Plate area',okP.length?`(${okP.map(p=>`${M(p.length_mm)}*${M(p.width_mm)}*${p.count}${I_(p.name||'plate')}`).join('+')})*${q}${I_(q>1?'identical joints':'joint')}=${r3(pa1*q)}m2`:'no plates'],
    ['Plate volume',okP.length?`(${okP.map(p=>`${M(p.length_mm)}*${M(p.width_mm)}*${M(p.thickness_mm)}*${p.count}${I_(p.name||'plate')}`).join('+')})*${q}=${r3(pv1*q)}m3`:'no plates'],
    ['Bolts',`${boltTxt}*${q}${I_(q>1?'identical joints':'joint')}=${nb1*q} nos`]],
   attrs:[['Connection',kind],['Detail',c.type_mark||'—'],['Detail from',ct&&ct.sheet_no&&t.jobs[ct.sheet_no-1]?shName(t.jobs[ct.sheet_no-1].p):'—'],
    ['Plates per joint',plates.map(p=>`${p.count}× ${p.name||'plate'} ${p.length_mm??'?'}×${p.width_mm??'?'}×${p.thickness_mm??'?'}`).join(', ')||'—'],
    ['Bolts per joint',bo.count!=null?`${bo.count} × ${e0(bo)}`:'—'],['Number of joints',q],['Plate area (m²)',r3(pa1*q)],['Plate volume (m³)',r3(pv1*q)],['Bolts (nos)',nb1*q],['Joins',c.members.join(', ')||'—']]};
  if(q>1)note.push(`${q} identical joints`);
  if(rule){const r=rule.r,wh=r.where==='each_end'?`each end of every ${r.applies_to_kind}`:r.where==='each_base'?`every ${r.applies_to_kind} base`:r.where==='each_member'?`every ${r.applies_to_kind}`:`every crossing of a ${r.applies_to_kind} with a ${r.crossing_kind}`;
   e.raw=r;e.rule=`R${rule.ri+1}`;e.expr.unshift(['Location',`${rule.k} of ${rule.n}${I_(`rule R${rule.ri+1}: ${r.type_mark||CONN_NAME[r.kind]} at ${wh}${r.applies_to_mark?` (${r.applies_to_mark})`:''}; location found from the members on the drawing`)}`]);
   e.attrs.unshift(['Rule',`R${rule.ri+1} · ${wh}${r.per_location>1?` · ${r.per_location} per location`:''}`]);if(r.text)e.attrs.push(['Rule based on',r.text])}
  e.status=status(why,c);e.why=why.join(' · ');e.note=note.join(' · ');
  L.push(e);out.push(e);
 };
 if(!want.size||want.has('connection')){
  for(const c of (R.connections||[]))addJoint(c);
  /* --- connection rules: one joint per location found on this sheet --- */
  const mem=out.filter(e=>e.stl&&e.kind!=='sjoint'),tol=1.5*72/25.4;   // 1.5 mm on paper, in page units
  const mid=Ln=>{const i=Math.floor((Ln.length-1)/2);return lerp(Ln[i],Ln[i+1]||Ln[i],.5)};
  const cross=(a,b,c,d)=>{const r=[b[0]-a[0],b[1]-a[1]],s2=[d[0]-c[0],d[1]-c[1]],den=r[0]*s2[1]-r[1]*s2[0];if(Math.abs(den)<1e-9)return null;
   const tt=((c[0]-a[0])*s2[1]-(c[1]-a[1])*s2[0])/den,uu=((c[0]-a[0])*r[1]-(c[1]-a[1])*r[0])/den,ea=tol/(Math.hypot(...r)||1),ec=tol/(Math.hypot(...s2)||1);
   return tt>=-ea&&tt<=1+ea&&uu>=-ec&&uu<=1+ec?[a[0]+tt*r[0],a[1]+tt*r[1]]:null};
  (G.connection_rules||[]).forEach((r,ri)=>{
   const sel=mem.filter(e=>e.aiKind===r.applies_to_kind&&(!r.applies_to_mark||String((e.raw&&e.raw.mark)||'').toLowerCase()===r.applies_to_mark.toLowerCase()));if(!sel.length)return;
   const locs=[],add=(pp,ids)=>{const ex=locs.find(l=>Math.hypot(l.p[0]-pp[0],l.p[1]-pp[1])<tol);if(ex){ids.forEach(i=>{if(!ex.ids.includes(i))ex.ids.push(i)});return}locs.push({p:pp,ids:[...ids]})};
   if(r.where==='each_end')sel.forEach(e=>{if(e.line){add(e.line[0],[e.tag]);add(e.line[e.line.length-1],[e.tag])}else if(e.pt)add(e.pt,[e.tag])});
   else if(r.where==='each_base')sel.forEach(e=>add(e.pt||e.line[0],[e.tag]));
   else if(r.where==='each_member')sel.forEach(e=>add(e.pt||mid(e.line),[e.tag]));
   else{const oth=mem.filter(e=>e.aiKind===r.crossing_kind&&e.line);
    sel.forEach(e=>{if(!e.line)return;oth.forEach(o=>{for(let a2=0;a2+1<e.line.length;a2++)for(let b2=0;b2+1<o.line.length;b2++){const x=cross(e.line[a2],e.line[a2+1],o.line[b2],o.line[b2+1]);if(x)add(x,[e.tag,o.tag])}})})}
   locs.forEach((l,k2)=>addJoint({id:`R${ri+1}-${k2+1}`,type_mark:r.type_mark,kind:r.kind,at:[l.p[0]/pw*1000,l.p[1]/ph*1000],members:l.ids,qty:r.per_location,plates:r.plates,bolts:r.bolts,confidence:r.confidence,needs_review:r.needs_review,review_reason:r.review_reason},{r,ri,k:k2+1,n:locs.length}));
  });
 }
 j.warn=warn;j.n=out.length;j.rv=out.filter(e=>e.status==='rv').length;
 if(!t.srcs.includes(j.p))t.srcs.push(j.p);
 t.elements.push(...out);
}
const e0=b=>`${b.dia_mm?'M'+b.dia_mm:'?'}${b.grade?' '+b.grade:''}${b.type==='anchor'?' anchor':''}`;
const stlMembers=E=>E.filter(e=>e.stl&&e.kind!=='sjoint'),stlJoints=E=>E.filter(e=>e.kind==='sjoint');
function stlSummary(t){const E=t.elements,s=k=>E.reduce((a,e)=>a+(e.q[k]||0),0);
 return [{v:stlMembers(E).reduce((a,e)=>a+e.q.n,0),l:'Members'},{v:fx(s('len'),0)+' m',l:'Steel length'},{v:s('bolts'),l:'Bolts'},{v:E.filter(e=>e.status==='rv').length,l:'Need review'}]}
