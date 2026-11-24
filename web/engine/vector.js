/* ================= Vector snapping: exact geometry from the PDF's own linework =================
   The AI places points by eye on an image, so its outlines are close but not exact. CAD-exported PDFs contain the
   real lines, so each outline edge is snapped onto the drawn line it follows and the corners are recomputed as the
   intersections of the snapped edges. Coordinates are page units at scale 1 (the viewer's space), y down.
   Each edge reports whether it snapped and how far it moved; an edge with no line nearby keeps the AI position. */
const VEC_TOL_MM=1.5;          // paper mm: how far the AI edge may be from the drawn line (1.5 mm = 150 mm at 1:100)
const VEC_ANGLE=1.5;           // degrees
const ptMm=v=>v*25.4/72;

// All straight segments of the page (lines, polylines, rectangles; curves are skipped), in viewport space.
// Each segment: [x1,y1,x2,y2,w,d] with w = line weight in paper mm and d = 1 for a dashed line (from the graphics state).
// curves: each run of curve pieces (door swings, circles, arcs) as a flattened polyline {pts,w,d}; not used for snapping.
async function pageSegments(page){
 const OPS=pdfjs.OPS,ol=await page.getOperatorList(),vp=page.getViewport({scale:1}),U=pdfjs.Util;
 let ctm=[1,0,0,1,0,0],lw=0,dash=0;const stack=[],segs=[],polys=[],curves=[];let run=null;
 const bez=(a,b,c,d)=>{for(let t=1;t<=8;t++){const u=t/8,v=1-u;run.push([v*v*v*a[0]+3*v*v*u*b[0]+3*v*u*u*c[0]+u*u*u*d[0],v*v*v*a[1]+3*v*v*u*b[1]+3*v*u*u*c[1]+u*u*u*d[1]])}};
 const flush=()=>{if(run&&run.length>2)curves.push({pts:run,w:wmm(),d:dash});run=null};
 const wmm=()=>{const m=U.transform(vp.transform,ctm);return Math.round(lw*Math.sqrt(Math.abs(m[0]*m[3]-m[1]*m[2]))*25.4/72*100)/100};
 const addPoly=P=>{if(P.length<3||P.length>64)return;const xs=P.map(p=>p[0]),ys=P.map(p=>p[1]),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys);if(w<.3||h<.3)return;
  let a=0;P.forEach((p,i)=>{const q=P[(i+1)%P.length];a+=p[0]*q[1]-q[0]*p[1]});polys.push({pts:P,cx:(Math.max(...xs)+Math.min(...xs))/2,cy:(Math.max(...ys)+Math.min(...ys))/2,w,h,area:Math.abs(a)/2})};
 const map=(x,y)=>U.applyTransform(U.applyTransform([x,y],ctm),vp.transform);
 const add=(a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1];if(dx*dx+dy*dy>.04)segs.push([a[0],a[1],b[0],b[1],wmm(),dash])};
 for(let i=0;i<ol.fnArray.length;i++){
  const fn=ol.fnArray[i],args=ol.argsArray[i];
  if(fn===OPS.save)stack.push([ctm,lw,dash]);
  else if(fn===OPS.restore){const st=stack.pop();if(st&&Array.isArray(st[0])){[ctm,lw,dash]=st}else ctm=st||[1,0,0,1,0,0]}
  else if(fn===OPS.setLineWidth)lw=+args[0]||0;
  else if(fn===OPS.setDash)dash=Array.isArray(args[0])&&args[0].some(v=>v>0)?1:0;
  else if(fn===OPS.setGState&&Array.isArray(args[0]))args[0].forEach(([k,v])=>{if(k==='LW')lw=+v||0;else if(k==='D')dash=Array.isArray(v)&&Array.isArray(v[0])&&v[0].some(x=>x>0)?1:0});
  else if(fn===OPS.transform)ctm=U.transform(ctm,args);
  else if(fn===OPS.paintFormXObjectBegin){stack.push(ctm);if(args[0])ctm=U.transform(ctm,args[0])}
  else if(fn===OPS.paintFormXObjectEnd){const st=stack.pop();if(st&&Array.isArray(st[0])){[ctm,lw,dash]=st}else ctm=st||[1,0,0,1,0,0]}
  else if(fn===OPS.constructPath){
   const ops=args[0],c=args[1];let k=0,cur=null,start=null,sub=[];
   const endSub=()=>{if(sub.length>=4&&Math.hypot(sub[0][0]-sub[sub.length-1][0],sub[0][1]-sub[sub.length-1][1])<.05)addPoly(sub.slice(0,-1));sub=[]};
   for(const op of ops){
    const isCurve=op===OPS.curveTo||op===OPS.curveTo2||op===OPS.curveTo3;if(!isCurve)flush();
    if(op===OPS.moveTo){endSub();cur=map(c[k],c[k+1]);start=cur;sub=[cur];k+=2}
    else if(op===OPS.lineTo){const p=map(c[k],c[k+1]);if(cur)add(cur,p);cur=p;sub.push(p);k+=2}
    else if(op===OPS.curveTo){const a=cur||map(c[k+4],c[k+5]),b=map(c[k],c[k+1]),cc=map(c[k+2],c[k+3]),d=map(c[k+4],c[k+5]);if(!run)run=[a];bez(a,b,cc,d);cur=d;sub=[];k+=6}
    else if(op===OPS.curveTo2){const a=cur||map(c[k+2],c[k+3]),cc=map(c[k],c[k+1]),d=map(c[k+2],c[k+3]);if(!run)run=[a];bez(a,a,cc,d);cur=d;sub=[];k+=4}
    else if(op===OPS.curveTo3){const a=cur||map(c[k+2],c[k+3]),b=map(c[k],c[k+1]),d=map(c[k+2],c[k+3]);if(!run)run=[a];bez(a,b,d,d);cur=d;sub=[];k+=4}
    else if(op===OPS.rectangle){const x=c[k],y=c[k+1],w=c[k+2],h=c[k+3];const q=[map(x,y),map(x+w,y),map(x+w,y+h),map(x,y+h)];for(let n=0;n<4;n++)add(q[n],q[(n+1)%4]);addPoly(q);cur=q[0];start=q[0];sub=[];k+=4}
    else if(op===OPS.closePath){if(cur&&start)add(cur,start);if(sub.length>=3)addPoly(sub.slice());sub=[];cur=start}
   }
   flush();endSub();
  }
 }
 return {segs,polys,curves};
}
async function vectorIndex(page){
 const {segs,polys}=await pageSegments(page);
 // collinear segments (dashed lines, broken walls) are merged into one "line": angle, offset, extent along it
 const G=new Map();
 for(const [x1,y1,x2,y2] of segs){
  let th=Math.atan2(y2-y1,x2-x1)*180/Math.PI;if(th<0)th+=180;if(th>=180)th-=180;
  const r=th*Math.PI/180,dx=Math.cos(r),dy=Math.sin(r),off=-x1*dy+y1*dx,t1=x1*dx+y1*dy,t2=x2*dx+y2*dy;
  const key=Math.round(th*10)+'|'+Math.round(off*5);
  let g=G.get(key);if(!g){g={th,off,min:Infinity,max:-Infinity,len:0};G.set(key,g)}
  g.min=Math.min(g.min,t1,t2);g.max=Math.max(g.max,t1,t2);g.len+=Math.abs(t2-t1);
 }
 const lines=[...G.values()],byAngle=new Map();
 lines.forEach(g=>{const a=Math.round(g.th)%180;(byAngle.get(a)||byAngle.set(a,[]).get(a)).push(g)});
 // closed shapes, bucketed by centre (20 pt cells) for nearby search
 const cells=new Map();polys.forEach(p=>{const key=Math.floor(p.cx/20)+','+Math.floor(p.cy/20);(cells.get(key)||cells.set(key,[]).get(key)).push(p)});
 return {lines,byAngle,segments:segs.length,polys:polys.length,cells};
}
// Snap a closed polygon (page units) onto the drawn lines. tol in page units.
function snapPolygon(P,idx,tol){
 const n=P.length,edges=[];
 const lineOf=(a,b)=>{let th=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;if(th<0)th+=180;if(th>=180)th-=180;const r=th*Math.PI/180;return {th,dx:Math.cos(r),dy:Math.sin(r)}};
 for(let i=0;i<n;i++){
  const A=P[i],B=P[(i+1)%n],L=lineOf(A,B),len=Math.hypot(B[0]-A[0],B[1]-A[1]);
  const offA=-A[0]*L.dy+A[1]*L.dx,offB=-B[0]*L.dy+B[1]*L.dx,tA=A[0]*L.dx+A[1]*L.dy,tB=B[0]*L.dx+B[1]*L.dy;
  let best=null,second=null;
  if(idx&&len>0)for(let a=Math.round(L.th)-2;a<=Math.round(L.th)+2;a++){
   for(const g of idx.byAngle.get(((a%180)+180)%180)||[]){
    let dth=Math.abs(g.th-L.th);dth=Math.min(dth,180-dth);if(dth>VEC_ANGLE)continue;
    // distance of the AI edge (both ends) from this drawn line, measured with the line's own normal
    const gr=g.th*Math.PI/180,gx=Math.cos(gr),gy=Math.sin(gr);
    const dA=Math.abs(-A[0]*gy+A[1]*gx-g.off),dB=Math.abs(-B[0]*gy+B[1]*gx-g.off),d=Math.max(dA,dB);if(d>tol)continue;
    const a1=Math.min(A[0]*gx+A[1]*gy,B[0]*gx+B[1]*gy),a2=Math.max(A[0]*gx+A[1]*gy,B[0]*gx+B[1]*gy),ov=Math.max(0,Math.min(a2,g.max)-Math.max(a1,g.min));
    if(ov<.5*len)continue;                                       // must run along at least half of the edge
    const c={g,d:(dA+dB)/2};
    if(!best||c.d<best.d){second=best;best=c}else if(!second||c.d<second.d)second=c;
   }
  }
  edges.push(best?{snapped:true,line:best.g,d:best.d,ambiguous:!!(second&&second.d-best.d<.25*tol)}:{snapped:false,line:null,d:0,A,B});
 }
 // corners = intersections of consecutive snapped edges
 const ln=e=>{if(e.line){const r=e.line.th*Math.PI/180;return {dx:Math.cos(r),dy:Math.sin(r),off:e.line.off}}const L=lineOf(e.A,e.B);return {dx:L.dx,dy:L.dy,off:-e.A[0]*L.dy+e.A[1]*L.dx}};
 const out=P.map((p,i)=>{
  const e1=edges[(i-1+n)%n],e2=edges[i];if(!e1.snapped&&!e2.snapped)return p;
  const l1=ln(e1),l2=ln(e2),det=l1.dx*l2.dy-l1.dy*l2.dx;
  let q;
  if(Math.abs(det)<Math.sin(5*Math.PI/180)){const l=e2.snapped?l2:l1,t=p[0]*l.dx+p[1]*l.dy;q=[t*l.dx-l.off*l.dy,t*l.dy+l.off*l.dx]}   // nearly straight corner: project
  else{ // point on line: x*(-dy)+y*dx=off
   const a1=-l1.dy,b1=l1.dx,a2=-l2.dy,b2=l2.dx,D=a1*b2-a2*b1;q=[(l1.off*b2-l2.off*b1)/D,(a1*l2.off-a2*l1.off)/D]}
  return Math.hypot(q[0]-p[0],q[1]-p[1])>3*tol?p:q;                 // never move a corner far: keep the AI point
 });
 return {pts:out,edges:edges.map(e=>({snapped:e.snapped,d:e.d,ambiguous:!!e.ambiguous}))};
}
// A drawn closed shape matching a small AI outline (e.g. a column drawn as a rectangle): same place, similar size.
function matchShape(P,idx){
 const xs=P.map(p=>p[0]),ys=P.map(p=>p[1]),cx=(Math.max(...xs)+Math.min(...xs))/2,cy=(Math.max(...ys)+Math.min(...ys))/2,w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys);
 const R=Math.max(w,h)*.6+2;let best=null;
 for(let gx=Math.floor((cx-R)/20);gx<=Math.floor((cx+R)/20);gx++)for(let gy=Math.floor((cy-R)/20);gy<=Math.floor((cy+R)/20);gy++)for(const q of idx.cells.get(gx+','+gy)||[]){
  const d=Math.hypot(q.cx-cx,q.cy-cy);if(d>R)continue;
  const rw=q.w/w,rh=q.h/h,ra=q.area/(w*h);if(rw<.35||rw>2.8||rh<.35||rh>2.8||ra<.15||ra>3)continue;   // the AI box is rough, but not that rough
  const score=d/Math.max(w,h)+Math.abs(Math.log(q.w*q.h/(w*h)))*.3;
  if(!best||score<best.score)best={q,score};
 }
 return best&&best.q;
}
// Snap an open centreline (steel member, page units): each segment onto the drawn line it follows, each end onto the
// nearest crossing of that line with another drawn line (grid line, the member it frames into), within tol.
// Inner bends = intersections of consecutive snapped segments. Ends with no crossing nearby are projected onto the
// snapped line (or kept). Returns { pts, ends: [startSnapped, endSnapped], segs: [{snapped}] }.
function snapLine(P,idx,tol){
 const n=P.length,dirOf=(a,b)=>{let th=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;if(th<0)th+=180;if(th>=180)th-=180;const r=th*Math.PI/180;return {th,dx:Math.cos(r),dy:Math.sin(r)}};
 const geo=g=>{const r=g.th*Math.PI/180;return {th:g.th,dx:Math.cos(r),dy:Math.sin(r),off:g.off}};
 const cross=(l1,l2)=>{const a1=-l1.dy,b1=l1.dx,a2=-l2.dy,b2=l2.dx,D=a1*b2-a2*b1;if(Math.abs(D)<Math.sin(10*Math.PI/180))return null;return [(l1.off*b2-l2.off*b1)/D,(a1*l2.off-a2*l1.off)/D]};
 // each segment: the drawn line along it (parallel, within tol at both ends, running along at least half of it)
 const segs=[];
 for(let i=0;i+1<n;i++){
  const A=P[i],B=P[i+1],L=dirOf(A,B),len=Math.hypot(B[0]-A[0],B[1]-A[1]);let best=null;
  if(len>0)for(let a=Math.round(L.th)-2;a<=Math.round(L.th)+2;a++)for(const g of idx.byAngle.get(((a%180)+180)%180)||[]){
   let dth=Math.abs(g.th-L.th);dth=Math.min(dth,180-dth);if(dth>VEC_ANGLE)continue;
   const G=geo(g),dA=Math.abs(-A[0]*G.dy+A[1]*G.dx-g.off),dB=Math.abs(-B[0]*G.dy+B[1]*G.dx-g.off);if(Math.max(dA,dB)>tol)continue;
   const a1=Math.min(A[0]*G.dx+A[1]*G.dy,B[0]*G.dx+B[1]*G.dy),a2=Math.max(A[0]*G.dx+A[1]*G.dy,B[0]*G.dx+B[1]*G.dy);if(Math.max(0,Math.min(a2,g.max)-Math.max(a1,g.min))<.5*len)continue;
   if(!best||(dA+dB)/2<best.d)best={g,d:(dA+dB)/2};
  }
  segs.push(best?{snapped:true,l:geo(best.g),g:best.g}:{snapped:false,l:{...L,off:-A[0]*L.dy+A[1]*L.dx}});
 }
 if(!segs.length)return {pts:P,ends:[false,false],segs:[]};
 // an end: the nearest crossing of its segment's line with another drawn line that reaches that spot
 const endPt=(p,s)=>{let best=null;
  for(const g of idx.lines){
   let dth=Math.abs(g.th-s.l.th);dth=Math.min(dth,180-dth);if(dth<10)continue;
   const G=geo(g);if(Math.abs(-p[0]*G.dy+p[1]*G.dx-g.off)>tol)continue;
   const t=p[0]*G.dx+p[1]*G.dy;if(t<g.min-tol||t>g.max+tol)continue;
   const q=cross(s.l,G);if(!q)continue;const d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<=tol&&(!best||d<best.d))best={q,d};
  }
  if(best)return {q:best.q,ok:true};
  if(s.snapped){const t=p[0]*s.l.dx+p[1]*s.l.dy;return {q:[t*s.l.dx-s.l.off*s.l.dy,t*s.l.dy+s.l.off*s.l.dx],ok:false}}
  return {q:p,ok:false}};
 const a=endPt(P[0],segs[0]),b=endPt(P[n-1],segs[segs.length-1]);
 const out=P.map((p,i)=>{
  if(i===0)return a.q;if(i===n-1)return b.q;
  const s1=segs[i-1],s2=segs[i];if(!s1.snapped&&!s2.snapped)return p;const q=cross(s1.l,s2.l);
  return q&&Math.hypot(q[0]-p[0],q[1]-p[1])<=3*tol?q:p});
 return {pts:out,ends:[a.ok,b.ok],segs:segs.map(s=>({snapped:s.snapped}))};
}
// Steel members in normalized 0–1000 coordinates (see snapLine). method: 'line' = both ends on drawn crossings.
function snapLineNorm(j,pts){
 if(!j.vec||pts.length<2)return {pts,ends:null,method:'none'};
 const toP=([x,y])=>[x/1000*j.pw,y/1000*j.ph],toN=([x,y])=>[x/j.pw*1000,y/j.ph*1000],r=snapLine(pts.map(toP),j.vec,VEC_TOL_MM*72/25.4);
 return {pts:r.pts.map(toN),ends:r.ends,segs:r.segs,method:r.ends[0]&&r.ends[1]?'line':r.segs.some(s=>s.snapped)?'partial':'none'};
}
// Snap an element given in normalized 0–1000 image coordinates. Returns new normalized points and per-edge info.
// Small shapes (shortest side under 5 mm on paper): take the drawn closed shape around them if there is one,
// else keep the AI outline (marked approximate): edge-snapping tiny shapes can jump to neighbouring lines.
// Otherwise snap edge by edge, with a tolerance that is never more than a third of the element's own shortest side.
// Room outline found by the app (rooms.js): already within ~0.4 mm of the wall faces, so every edge long enough is
// snapped with a tight tolerance (no minimum side, no shape matching); short steps keep their traced position.
function snapRoom(j,pts){
 if(!j.vec||pts.length<3)return {pts,edges:null,method:'none'};
 const toP=([x,y])=>[x/1000*j.pw,y/1000*j.ph],toN=([x,y])=>[x/j.pw*1000,y/j.ph*1000],r=snapPolygon(pts.map(toP),j.vec,.8*72/25.4);
 return {pts:r.pts.map(toN),edges:r.edges,method:'room'};
}
function snapNorm(j,pts,closed){
 if(!j.vec||!closed||pts.length<3)return {pts,edges:null,method:'none'};
 const toP=([x,y])=>[x/1000*j.pw,y/1000*j.ph],toN=([x,y])=>[x/j.pw*1000,y/j.ph*1000],P=pts.map(toP);
 const sides=P.map((p,i)=>Math.hypot(P[(i+1)%P.length][0]-p[0],P[(i+1)%P.length][1]-p[1])),minSide=Math.min(...sides),mm=72/25.4;
 if(minSide<5*mm){const q=matchShape(P,j.vec);if(q)return {pts:q.pts.map(toN),edges:q.pts.map(()=>({snapped:true,d:0,ambiguous:false})),method:'shape'};
  return {pts,edges:P.map(()=>({snapped:false,d:0,ambiguous:false})),method:'none'}}   // too small to edge-snap safely: keep the AI outline, marked approximate
 const r=snapPolygon(P,j.vec,Math.min(VEC_TOL_MM*mm,minSide/3));
 return {pts:r.pts.map(toN),edges:r.edges,method:'edges'};
}
