/* Measure.AI engine — finishes build. Extracted from the measuring code; no page layout or DOM here. */
const FIN_DEDUCT_WINDOWS=true;    // windows are deducted from wall finish like doors (frame size, from their sill up)
const FIN_CH0=3000;               // mm: ceiling height assumed when nothing in the set gives one (shown in the expression)
const FIN_CATS=[['floor','Floor finish','m²'],['wall','Wall finish','m²'],['skirt','Skirting','m'],['susp','Suspended ceiling','m²'],['ceil','Ceiling finish','m²'],['wp','Waterproofing','m²']];
const OPN={door:{kind:'door',type:'Door',lab:'Door'},window:{kind:'win',type:'Window',lab:'Window'},opening:{kind:'opn',type:'Opening',lab:'Opening'}};
Object.assign(LABEL_SRC,{room_tag:'Room tag on the plan',finish_plan:'Finish plan',legend:'Legend on the sheet',note:'Note on the sheet'});

// Area of polygon (normalized pts) in m², and the overlap of a polygon with a convex one (Sutherland–Hodgman clip).
function polyArea(pts,PW,PH,k){let s=0;pts.forEach((p,i)=>{const q=pts[(i+1)%pts.length];s+=(p[0]/1000*PW)*(q[1]/1000*PH)-(q[0]/1000*PW)*(p[1]/1000*PH)});return Math.abs(s)/2*k*k/1e6}
function convexHull(P){const p=[...P].sort((a,b)=>a[0]-b[0]||a[1]-b[1]),cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),lo=[],up=[];
 for(const q of p){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],q)<=0)lo.pop();lo.push(q)}
 for(const q of p.reverse()){while(up.length>=2&&cr(up[up.length-2],up[up.length-1],q)<=0)up.pop();up.push(q)}
 return lo.slice(0,-1).concat(up.slice(0,-1))}
function clipConvex(subject,clip){
 const C=convexHull(clip);let out=subject;
 for(let i=0;i<C.length&&out.length;i++){const a=C[i],b=C[(i+1)%C.length],inn=p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])>=0,inp=out;out=[];
  const X=(p,q)=>{const d1=(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]),d2=(b[0]-a[0])*(q[1]-a[1])-(b[1]-a[1])*(q[0]-a[0]),t=d1/(d1-d2);return [p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]};
  inp.forEach((p,k)=>{const q=inp[(k+1)%inp.length];if(inn(q)){if(!inn(p))out.push(X(p,q));out.push(q)}else if(inn(p))out.push(X(p,q))})}
 return out;
}
// Door / window tag: the AI's point, moved onto the matching text in the PDF text layer when there is one nearby.
function tagPoint(j,mark,at){
 if(!at||!mark||!j.texts)return at;const m=mark.trim().toLowerCase(),r=6/25.4*72;let best=null;
 for(const x of j.texts){if(x.s.trim().toLowerCase()!==m)continue;const d=Math.hypot(x.cx-at[0]/1000*j.pw,x.cy-at[1]/1000*j.ph);if(d<r&&(!best||d<best.d))best={x,d}}
 return best?[best.x.cx/j.pw*1000,best.x.cy/j.ph*1000]:at;
}

function finBuild(t,j,R){
 if(!R)throw new Error('no answer for this sheet');j.result=R;const G=t.run.result;
 const s=sheetOf(j.p),pw=j.pw,ph=j.ph,PW=pw/72*25.4,PH=ph/72*25.4;
 const P=([x,y])=>[x/1000*pw,y/1000*ph];
 const pm=(a,b)=>Math.hypot((b[0]-a[0])/1000*PW,(b[1]-a[1])/1000*PH);
 const {k,warn}=sheetScale(j,R,s),want=new Set(t.kinds);
 const types={};G.types.forEach(x=>{if(x.mark)types[x.mark.toLowerCase()+'|'+x.kind]=x});
 const typ=(m,kind)=>m?types[m.toLowerCase()+'|'+kind]||null:null;
 const floor=s.floor||normFloor(R.sheet.level)||R.sheet.level||'—',sl=shLabel(j.p);
 const out=[],L=t.bySrc[j.p]=[],M=mm=>r3(mm/1000);
 const zero=()=>({floor:0,wall:0,skirt:0,susp:0,ceil:0,wp:0});
 for(const a0 of R.elements){
  const sn=a0.lines?{pts:a0.pts,edges:null,method:'lines'}:a0.region?snapRoom(j,a0.pts):snapNorm(j,a0.pts,true),a={...a0,pts:sn.pts};   // from the named PDF lines (exact), else snapped onto the drawn wall lines
  const n=a.pts.length,why=[],note=[];if(a.needs_review&&a.review_reason)why.push(reasonText(a.review_reason));
  const rid=`${t.id}.${j.p}-${a.id}`,rname=[a.number,a.name].filter(Boolean).join(' ')||'(room)';
  const base={floor,sheet:j.p,sheetLabel:sl,loc:a.grid_ref||'—',grade:'—',src:a.info_source,conf:Math.round(a.confidence*100),roomId:rid,roomName:rname};
  if(!k)why.push('No scale on this sheet: lengths and areas could not be measured');
  if(a.edgesGuessed)why.push('Edge types were missing; every edge is treated as a wall');
  const edges=a.pts.map((p,i)=>{const q=a.pts[(i+1)%n];return {i,lab:'E'+(i+1),type:a.edges[i]||'wall',L:k?pm(p,q)*k/1000:0,a:p,b:q,mid:P([(p[0]+q[0])/2,(p[1]+q[1])/2]),snapped:sn.edges?sn.edges[i].snapped:null,amb:sn.edges?sn.edges[i].ambiguous:false}});
  snapNote(edges,note,j,sn.method);if(sn.method!=='room'&&sn.edges&&sn.edges.some(x=>!x.snapped))why.push('Some outline edges are not on a drawn line (AI position kept): check the area');
  if(sn.method==='room'){const off=edges.filter(e=>e.snapped===false&&e.L>.3);if(off.length)note.push(`${off.length} edge${off.length>1?'s':''} over 0.3 m not on a single drawn line (traced position kept)`)}
  const wallE=edges.filter(e=>e.type==='wall'),Pw=wallE.reduce((x,e)=>x+e.L,0),A=k?polyArea(a.pts,PW,PH,k):0;
  // elements standing on the slab inside the room: snapped to their drawn shape, only the part inside the room counts
  const obs=(a.obstructions||[]).map((o,i)=>{const sn2=snapNorm(j,o.pts,true),pts=sn2.pts,ov=k&&pts.length>=3?polyArea(clipConvex(a.pts,pts),PW,PH,k):0;
   return {...o,pts,poly:pts.map(P),method:sn2.method,area:ov,lab:`${o.kind==='column'?'Column':o.kind==='wall'?'Wall':o.kind==='shaft'?'Shaft':o.kind==='duct'?'Duct':'Element'} ${o.mark||i+1}`}}).filter(o=>o.area>0);
  const Aobs=obs.reduce((x,o)=>x+o.area,0),Anet=Math.max(0,A-Aobs);
  // doors / windows: size and frame from the plan or the schedule, deducted from the wall edge they sit in
  // rooms found by the app: each door swing on this room's walls is a door at its exact place, as wide as its swing
  // (at the sheet scale). It takes the mark, height and frame of the AI's door of about the same width (within 150 mm).
  let opn=a.openings;
  if(a.doors_found&&a.doors_found.length&&k){
   const aiD=opn.filter(o=>o.type==='door'),rest=opn.filter(o=>o.type!=='door'),used=new Set();
   const found=a.doors_found.map(d=>{const w=Math.round(d.w_paper_mm*k/10)*10;let m=-1,bd=1e9;
    aiD.forEach((o,i)=>{if(used.has(i))return;const ow=o.width_mm??typ(o.mark,'door')?.width_mm;const dd=ow!=null?Math.abs(ow-w):1e9;if(dd<bd){bd=dd;m=i}});
    const o=m>=0&&bd<=150?(used.add(m),aiD[m]):null,ty=o?typ(o.mark,'door'):null;
    return {...(o||{mark:'',frame_width_mm:null,frame_height_mm:null}),type:'door',width_mm:w,height_mm:o?.height_mm??ty?.height_mm??2100,sill_mm:0,at:d.at,edge:null,found:true,assumedH:!(o?.height_mm??ty?.height_mm)}});
   opn=[...found,...rest,...aiD.filter((o,i)=>!used.has(i)).map(o=>({...o,noSwing:true}))];
  }
  const ops=opn.map((o,i)=>{const ty=typ(o.mark,o.type==='window'?'window':'door');
   let e=o.edge;if(e==null&&o.at){let best=1e9;a.pts.forEach((p,i2)=>{const q=a.pts[(i2+1)%n],dx=q[0]-p[0],dy=q[1]-p[1],L2=dx*dx+dy*dy||1,u=Math.max(0,Math.min(1,((o.at[0]-p[0])*dx+(o.at[1]-p[1])*dy)/L2)),d=Math.hypot(p[0]+u*dx-o.at[0],p[1]+u*dy-o.at[1]);if(d<best){best=d;e=i2}})}
   const w=o.width_mm??ty?.width_mm??null,h=o.height_mm??ty?.height_mm??null,fw=o.frame_width_mm??ty?.frame_width_mm??null,fh=o.frame_height_mm??ty?.frame_height_mm??null;
   const dw=fw??w,dh=o.type==='opening'?null:(fh??h),sill=o.sill_mm??(o.type==='window'?null:0);
   const at=tagPoint(j,o.mark,o.at||(e!=null?[(a.pts[e][0]+a.pts[(e+1)%n][0])/2,(a.pts[e][1]+a.pts[(e+1)%n][1])/2]:null));
   return {...o,i,edge:e,w,h,fw,fh,dw,dh,sill,frame:fw!=null||fh!=null,onWall:e!=null&&edges[e]&&edges[e].type==='wall',at,lab:`${OPN[o.type].lab} ${o.mark||'?'}`,ded:[]}});
  const CH=a.ceiling.height_mm||R.sheet.typical_ceiling_height_mm||null,soffit=a.slab_soffit_mm||null;
  const topDef=['direct','exposed','none'].includes(a.ceiling.type)?(soffit||CH):(CH||soffit);
  const topSrc=topDef==null?'assumed height':topDef===a.ceiling.height_mm?'ceiling height':topDef===soffit?'slab soffit':'typical ceiling height';
  const top0=topDef||FIN_CH0;if(!topDef&&want.has('wall'))note.push(`wall finish height ${FIN_CH0/1000} m assumed (no ceiling height in the set)`);
  const edgeSum=E=>E.map(e=>`${r3(e.L)}${I_(e.lab)}`).join('+')||'0';
  const status=W=>W.length?'rv':'ok';
  /* --- the room: horizontal finishes --- */
  const q=zero(),items=[],expr=[];
  const add=(key,code,name,v,ex)=>{q[key]+=v;items.push({cat:key,code,name,qty:v});expr.push(ex)};
  const obsTxt=obs.map(o=>`-${r3(o.area)}${I_(o.lab+(o.method==='shape'?'':' ≈'))}`).join('');
  const areaTxt=`${areaExpr(edges,a.pts)}${obs.length?`${obsTxt}`:''}`;
  if(want.has('floor')&&(a.floor_finish.code||a.floor_finish.name))add('floor',a.floor_finish.code,a.floor_finish.name,Anet,[`Floor finish ${a.floor_finish.code}`.trim(),`${areaTxt}=${r3(Anet)}m2`]);
  if(a.printed_area_m2&&A&&Math.abs(A/a.printed_area_m2-1)>.08&&Math.abs(Anet/a.printed_area_m2-1)>.08)why.push(`Outline area ${r2(A)} m² differs from the printed ${a.printed_area_m2} m²`);
  if(obs.some(o=>o.method!=='shape'))note.push('some deducted elements are not matched to a drawn shape (≈)');
  if(want.has('skirting')&&(a.skirting.code||a.skirting.name))add('skirt',a.skirting.code,a.skirting.name,Pw,[`Skirting ${a.skirting.code||a.skirting.name}`.trim(),`${edgeSum(wallE)}${I_('Wall edges')}=${r3(Pw)}m`]);
  if(a.ceiling.type==='unknown'&&(want.has('suspended_ceiling')||want.has('ceiling_paint')))why.push('Ceiling type not stated');
  if(want.has('suspended_ceiling')&&a.ceiling.type==='suspended')add('susp',a.ceiling.code,a.ceiling.name,Anet,[`Suspended ceiling ${a.ceiling.code}`.trim(),`${areaTxt}=${r3(Anet)}m2`]);
  if(want.has('ceiling_paint')&&a.ceiling.type==='direct')add('ceil',a.ceiling.code,a.ceiling.name,Anet,[`Ceiling finish ${a.ceiling.code}`.trim(),`${areaTxt}=${r3(Anet)}m2`]);
  const wp=a.waterproofing;
  if(want.has('waterproofing')&&(wp.floor||wp.upturn_mm)){const up=(wp.upturn_mm||0)/1000,fl=wp.floor?Anet:0,ua=Pw*up;
   add('wp',wp.code,wp.name||'Waterproofing',fl+ua,['Waterproofing',`${wp.floor?`${r3(Anet)}${I_('Floor')}`:'0'}+${r3(Pw)}${I_('Wall edges')}*${r3(up)}${I_('Upturn')}=${r3(fl+ua)}m2`])}
  /* --- wall finish: one line item per wall edge --- */
  const walls=[];
  if(want.has('wall')&&a.wall_finishes.length)for(const g of wallE){
   const wq=zero(),wit=[],wex=[],wwhy=[];
   for(const l of a.wall_finishes){
    const bot=l.bottom_mm??0,top=l.top_mm??top0,hh=Math.max(0,top-bot)/1000,gross=g.L*hh;
    const ded=ops.filter(o=>o.edge===g.i&&o.onWall&&(o.type!=='window'||FIN_DEDUCT_WINDOWS)&&o.dw!=null&&(o.type!=='window'||o.sill!=null)).map(o=>{
     const s0=o.sill??0,oh=o.dh??(top-s0),ov=Math.max(0,Math.min(top,s0+oh)-Math.max(bot,s0))/1000,ar=o.dw/1000*ov;
     return {o,ar,txt:`${M(o.dw)}*${r3(ov)}${I_(`${o.lab} ${o.frame?'frame':'size'}${ov*1000<(o.dh??0)?' (part in this band)':''}`)}`}}).filter(x=>x.ar>0);
    ded.forEach(d=>d.o.ded.push({edge:g.lab,code:l.code||l.name,ar:d.ar}));
    const net=Math.max(0,gross-ded.reduce((x,d)=>x+d.ar,0));wq.wall+=net;wit.push({cat:'wall',code:l.code,name:l.name,qty:net});
    wex.push([`Wall finish ${l.code||l.name}`,`${r3(g.L)}${I_(g.lab+' length'+(g.snapped===false?' ≈':''))}*${r3(hh)}${I_(`${l.bottom_mm!=null?M(bot)+' m':'floor'} to ${l.top_mm!=null?M(top)+' m':topSrc+(topDef?'':' '+M(top0)+' m')}`)}${ded.map(d=>`-${d.txt}`).join('')}=${r3(net)}m2`]);
   }
   ops.filter(o=>o.edge===g.i&&o.onWall&&(o.type!=='window'||FIN_DEDUCT_WINDOWS)&&o.dw==null).forEach(o=>wwhy.push(`${o.lab}: size not read, not deducted`));
   if(FIN_DEDUCT_WINDOWS)ops.filter(o=>o.edge===g.i&&o.onWall&&o.type==='window'&&o.dw!=null&&o.sill==null).forEach(o=>wwhy.push(`${o.lab}: sill height not read, not deducted`));
   if(g.snapped===false&&(sn.method!=='room'||g.L>.3))wwhy.push('Edge not on a drawn line: length approximate');
   walls.push({...base,kind:'wfin',type:'Wall finish',name:`${rname} · ${g.lab}`,sec:a.wall_finishes.map(l=>l.code||l.name).join('/'),id:`${rid}-${g.lab}`,tag:`${a.id}.${g.lab}`,
    line:[P(g.a),P(g.b)],poly:beamPoly(...P(g.a),...P(g.b),1.5),dims:[{lab:g.lab,L:g.L,mid:g.mid,snapped:g.snapped,type:'wall'}],q:wq,items:wit,len:g.L,raw:{edge:g.i,room:a.id,wall_finishes:a.wall_finishes},
    expr:[...wex,['Quantity','1 wall']],why:wwhy.join(' · '),note:'',status:status(wwhy),
    attrs:[['Room',rname],['Edge',`${g.lab} · ${r3(g.L)} m${g.snapped===false?' (approximate)':''}`],['Layers',a.wall_finishes.map(l=>`${l.code||l.name} ${l.bottom_mm??0}–${l.top_mm??top0}`).join(', ')],['Height source',topSrc],['Doors on this wall',ops.filter(o=>o.edge===g.i).map(o=>o.lab).join(', ')||'—']]});
  }
  /* --- doors / windows: points at their tag --- */
  const pts=ops.map(o=>{const T=OPN[o.type],ar=o.ded.reduce((x,d)=>x+d.ar,0),own=[];
   if(o.dw==null)own.push('Size not read');if(o.at==null)own.push('Position not given');
   if(o.found&&!o.mark)own.push('Door swing found in the drawing; no door of this width in the AI\'s list (mark unknown)');
   if(o.found&&o.assumedH)own.push('Height not read: 2100 mm assumed');
   if(o.noSwing)own.push('Listed by the AI, but no door swing was found for it');
   const c=P(o.at||a.pts[0]),r=1.2;
   return {...base,kind:T.kind,type:T.type,name:`${o.mark||'?'} · ${rname}`,sec:o.w?`${o.w}×${o.h??'?'}`:'',id:`${rid}-O${o.i+1}`,tag:`${a.id}.${o.mark||'O'+(o.i+1)}`,
    pt:c,poly:[[c[0]-r,c[1]-r],[c[0]+r,c[1]-r],[c[0]+r,c[1]+r],[c[0]-r,c[1]+r]],q:zero(),items:[],len:0,raw:o,
    expr:[[o.frame?'Frame':'Size',`${o.dw!=null?M(o.dw):'?'}${I_(o.frame?'frame width':'width')}*${o.dh!=null?M(o.dh):'?'}${I_(o.frame?'frame height':'height')}=${o.dw!=null&&o.dh!=null?r3(o.dw*o.dh/1e6):'?'}m2`],
     ['Deducted',o.ded.length?o.ded.map(d=>`${r3(d.ar)}${I_(`${d.code} on ${d.edge}`)}`).join('+')+`=${r3(ar)}m2`:(o.type==='window'&&!FIN_DEDUCT_WINDOWS?'not deducted (windows are listed only)':o.type==='window'&&o.sill==null?'not deducted: sill height not read':o.onWall?'nothing':'not on a wall edge')]],
    why:own.join(' · '),note:'',status:status(own),
    attrs:[['Mark',o.mark||'—'],['Type',T.type],['Size (mm)',`${o.w??'?'} × ${o.h??'?'}`],['Frame (mm)',o.frame?`${o.fw??'?'} × ${o.fh??'?'}`:'not given (size used)'],['Sill (mm)',o.sill??'—'],['Room',rname],['Wall edge',o.edge!=null?'E'+(o.edge+1):'—'],['Deducted (m²)',r3(ar)]]};
  });
  const room={...base,kind:'room',type:'Room',name:rname,sec:a.floor_finish.code||'',raw:a0,id:rid,tag:a.id,status:a.needs_review||why.length>(a.needs_review&&a.review_reason?1:0)?'rv':'ok',
   poly:a.pts.map(P),edgesInfo:edges,dims:edges,obs,ops,q,items,len:A,expr,why:why.join(' · '),note:note.join(' · ')};
  room.expr.unshift(['Dimensions',dimsExpr(edges,k)]);
  if(obs.length)room.expr.splice(1,0,['Deducted elements',obs.map(o=>`${r3(o.area)}${I_(o.lab+(o.method==='shape'?' (drawn shape)':' ≈'))}`).join('+')+`=${r3(Aobs)}m2`]);
  room.expr.push(['Quantity','1 room']);
  room.attrs=[['Room no.',a.number||'—'],['Room name',a.name||'—'],['Outline area (m²)',r3(A)+(a.printed_area_m2?` (printed ${a.printed_area_m2})`:'')],['Less elements (m²)',r3(Aobs)],['Net floor (m²)',r3(Anet)],['Wall edges (m)',r3(Pw)],
   ['Ceiling',`${a.ceiling.type}${a.ceiling.code?' '+a.ceiling.code:''}${CH?` · ${CH} mm`:''}`],['Floor finish',[a.floor_finish.code,a.floor_finish.name].filter(Boolean).join(' ')||'—'],
   ['Wall finish',a.wall_finishes.map(l=>l.code||l.name).join(' / ')||'—'],['Skirting',[a.skirting.code,a.skirting.name].filter(Boolean).join(' ')||'—'],
   ['Waterproofing',wp.floor||wp.upturn_mm?`${wp.floor?'floor':''}${wp.upturn_mm?` + ${wp.upturn_mm} upturn`:''}`:'—'],['Walls / doors',`${walls.length} wall lines · ${pts.length} doors & windows`],['Schedule text',a.schedule_text||'—']];
  if(a.ref_sheet&&t.jobs[a.ref_sheet-1])room.attrs.push(['Info from sheet',shName(t.jobs[a.ref_sheet-1].p)]);
  for(const e of [room,...walls,...pts]){L.push(e);out.push(e)}
 }
 j.warn=warn;j.n=out.filter(e=>e.kind==='room').length;j.rv=out.filter(e=>e.kind==='room'&&e.status==='rv').length;
 if(!t.srcs.includes(j.p))t.srcs.push(j.p);
 t.elements.push(...out);
}
// Area expression: a rectangle shows length × width; any other outline shows its edges and the coordinate (shoelace) area.
function areaExpr(edges,pts){
 if(edges.length===4){const [a,b,c,d]=edges.map(e=>e.L);if(Math.abs(a-c)<.002*a&&Math.abs(b-d)<.002*b)return `${r3(a)}${I_('E1')}*${r3(b)}${I_('E2')}`}
 return `${I_(`Shoelace area of the ${edges.length}-edge outline: ${edges.map(e=>r3(e.L)).join(', ')} m`)}`;
}
const finRooms=E=>E.filter(e=>e.kind==='room');
function finSummary(t){const E=t.elements,s=k=>E.reduce((a,e)=>a+e.q[k],0);
 return [{v:finRooms(E).length,l:'Rooms'},{v:fx(s('floor'),0)+' m²',l:'Floor finish'},{v:fx(s('wall'),0)+' m²',l:'Wall finish'},{v:E.filter(e=>e.status==='rv').length,l:'Need review'}]}
function drawRoomDetail(c,list){
 for(const e of list)if(e.kind==='room'&&e.obs)for(const o of e.obs){
  c.beginPath();o.poly.forEach(([x,y],i)=>{const [sx,sy]=toScreen(x,y);i?c.lineTo(sx,sy):c.moveTo(sx,sy)});c.closePath();
  c.fillStyle='rgba(220,38,38,.28)';c.fill();c.lineWidth=1;c.strokeStyle='#dc2626';c.setLineDash(o.method==='shape'?[]:[3,2]);c.stroke();c.setLineDash([])}
 const S=list.filter(e=>e.dims&&selEls.has(e.id));if(!S.length)return;
 const fs=Math.min(12,Math.max(9,V.s*2.6));c.font=`600 ${fs}px Segoe UI,Arial`;c.textAlign='center';c.textBaseline='middle';
 for(const e of S)for(const g of e.dims){const [x,y]=toScreen(g.mid[0],g.mid[1]);const tx=`${g.lab} ${g.snapped===false?'≈':''}${g.L.toFixed(3)}`;const w=c.measureText(tx).width+8;
  c.fillStyle=g.snapped===false?'#c77700':g.type!=='wall'?'#6b7280':'#1a6fe0';c.fillRect(x-w/2,y-fs*.7,w,fs*1.4);c.fillStyle='#fff';c.fillText(tx,x,y)}
}

