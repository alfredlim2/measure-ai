/* ================= Rooms found by the app (Finishes) =================
   The app finds the rooms itself; the AI only names them and reads their finishes.
   1. The PDF's own lines inside the area are drawn onto a black-and-white grid (4 px per paper mm): solid lines only.
      Dashed lines (grids, hidden lines) are left out, so they cannot cut a room in two.
   2. Door swings (quarter-circle arcs) are found in the PDF's curves. Each doorway is closed with a straight line where
      the door shuts, and the swing arc and the open leaf are left out, so a room keeps its full floor and does not run
      into the next one through the door.
   3. Every enclosed space is filled (flood fill). Spaces touching the area edge are outside; tiny ones (inside letters,
      symbols) and thin ones (between the two faces of a wall) are dropped.
   4. Each space's boundary is traced and simplified into an outline (later snapped onto the PDF lines like any room).
   The rooms are numbered (R1, R2…) on the image sent to the AI, which answers per number. No AI is used here. */
const ROOMS_CACHE=new Map();
const RM_PX=4,RM_MAXPX=12e6;            // grid resolution: px per paper mm, and at most this many pixels
const RM_MIN_M2=1.2,RM_MIN_W=0.7;       // smallest room (m²) and smallest mean width (m) kept
let RM_PEN=1.6;                          // px: line thickness on the grid; thicker closes small gaps where lines do not quite meet
const MM_PT=25.4/72;

// A circular arc in a flattened curve (page units): centre, radius, the two ends and the angle swept.
function arcOf(P){
 if(P.length<5)return null;const a=P[0],b=P[Math.floor(P.length/2)],c=P[P.length-1];
 const d=2*(a[0]*(b[1]-c[1])+b[0]*(c[1]-a[1])+c[0]*(a[1]-b[1]));if(Math.abs(d)<1e-9)return null;
 const A=a[0]*a[0]+a[1]*a[1],B=b[0]*b[0]+b[1]*b[1],C=c[0]*c[0]+c[1]*c[1];
 const cx=(A*(b[1]-c[1])+B*(c[1]-a[1])+C*(a[1]-b[1]))/d,cy=(A*(c[0]-b[0])+B*(a[0]-c[0])+C*(b[0]-a[0]))/d,r=Math.hypot(a[0]-cx,a[1]-cy);
 if(!(r>0)||P.some(q=>Math.abs(Math.hypot(q[0]-cx,q[1]-cy)-r)>r*.03))return null;
 let sw=0;for(let i=1;i<P.length;i++){let x=Math.atan2(P[i][1]-cy,P[i][0]-cx)-Math.atan2(P[i-1][1]-cy,P[i-1][0]-cx);while(x>Math.PI)x-=2*Math.PI;while(x<-Math.PI)x+=2*Math.PI;sw+=x}
 return {c:[cx,cy],r,e1:a,e2:c,sweep:Math.abs(sw)*180/Math.PI};
}
// Douglas–Peucker, then drop spikes (a line poking into the room traced out and back) and repeated points.
function simplifyRing(P,eps){
 const dp=(a,b)=>{let best=0,ix=-1;const A=P[a],B=P[b],dx=B[0]-A[0],dy=B[1]-A[1],L=Math.hypot(dx,dy)||1;
  for(let i=a+1;i<b;i++){const d=Math.abs((P[i][0]-A[0])*dy-(P[i][1]-A[1])*dx)/L;if(d>best){best=d;ix=i}}
  return best>eps?[...dp(a,ix).slice(0,-1),...dp(ix,b)]:[A,B]};
 let far=0,fd=-1;P.forEach((q,i)=>{const d=Math.hypot(q[0]-P[0][0],q[1]-P[0][1]);if(d>fd){fd=d;far=i}});
 let R=[...dp(0,far).slice(0,-1),...(far<P.length-1?dp(far,P.length-1):[P[far]]).slice(0,-1)];
 if(R.length<3)return R;
 for(let pass=0;pass<6;pass++){let ch=false;const out=[];
  for(let i=0;i<R.length;i++){const p=R[(i-1+R.length)%R.length],q=R[i],n=R[(i+1)%R.length];
   const u=[q[0]-p[0],q[1]-p[1]],v=[n[0]-q[0],n[1]-q[1]],lu=Math.hypot(...u),lv=Math.hypot(...v);
   if(lu<.5||lv<.5||(u[0]*v[0]+u[1]*v[1])/(lu*lv)<-.9){ch=true;continue}   // repeated point or spike tip
   if(Math.abs(u[0]*v[1]-u[1]*v[0])/(lu*lv)<.02&&(u[0]*v[0]+u[1]*v[1])>0){ch=true;continue}   // straight through
   out.push(q)}
  R=out;if(!ch||R.length<3)break}
 // small steps left by the grid (a jog of a pixel or two, a corner cut by a text stroke): drop the corner that changes
 // the outline least while it is a small step (triangle under 3 px², or under 30 px² next to an edge shorter than 5 px)
 const tri=(p,q,n)=>Math.abs((q[0]-p[0])*(n[1]-p[1])-(n[0]-p[0])*(q[1]-p[1]))/2;
 for(let guard=0;R.length>3&&guard<5000;guard++){let bi=-1,ba=1e9;
  for(let i=0;i<R.length;i++){const p=R[(i-1+R.length)%R.length],q=R[i],n=R[(i+1)%R.length],a=tri(p,q,n),sh=Math.min(Math.hypot(q[0]-p[0],q[1]-p[1]),Math.hypot(n[0]-q[0],n[1]-q[1]));
   if((a<3||(sh<5&&a<30))&&a<ba){ba=a;bi=i}}
  if(bi<0)break;R.splice(bi,1)}
 return R;
}
// Outer boundary of a labelled component (Moore-neighbour tracing from its top-left pixel).
function traceRing(lab,w,h,id,sx,sy){
 const N=[[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]],at=(x,y)=>x>=0&&y>=0&&x<w&&y<h&&lab[y*w+x]===id;
 const ring=[[sx,sy]];let x=sx,y=sy,dir=6,guard=0;
 do{let found=false;
  for(let k=0;k<8;k++){const d=(dir+6+k)%8,nx=x+N[d][0],ny=y+N[d][1];if(at(nx,ny)){x=nx;y=ny;dir=d;found=true;break}}
  if(!found)break;ring.push([x,y]);
 }while(!(x===sx&&y===sy)&&++guard<4e6);
 return ring;
}

// Rooms on one sheet (inside the area, or the whole sheet). Page 0–1000 coordinates. Cached per sheet and area.
async function findRooms(p,a){
 const key=p+'|'+RM_PEN+'|'+(a?[a.x,a.y,a.w,a.h].map(v=>v.toFixed(4)).join(','):'all');if(ROOMS_CACHE.has(key))return ROOMS_CACHE.get(key);
 const {segs,curves,W,H}=await segsOf(p),s=sheetOf(p),k=scaleDen(s.meta.scale)||100;
 const r=a?[a.x*W,a.y*H,(a.x+a.w)*W,(a.y+a.h)*H]:[0,0,W,H],wMM=(r[2]-r[0])*MM_PT,hMM=(r[3]-r[1])*MM_PT;
 const ppm=Math.min(RM_PX,Math.sqrt(RM_MAXPX/(wMM*hMM))),cw=Math.ceil(wMM*ppm),ch=Math.ceil(hMM*ppm),sc=ppm*MM_PT;   // sc: px per page unit
 const X=x=>(x-r[0])*sc,Y=y=>(y-r[1])*sc;
 // door swings: a quarter-ish arc of 0.45–1.6 m radius (at the sheet scale); its open leaf is the straight line from the hinge
 const doors=[],skip=new Set(),tol=.5/MM_PT;
 for(const cu of curves){if(cu.d)continue;const ar=arcOf(cu.pts);if(!ar||ar.sweep<60||ar.sweep>120)continue;const rm=ar.r*MM_PT*k;if(rm<450||rm>1600)continue;
  let open=null;segs.forEach((g,i)=>{if(g[5])return;const A=[g[0],g[1]],B=[g[2],g[3]],L=Math.hypot(B[0]-A[0],B[1]-A[1]);if(Math.abs(L-ar.r)>ar.r*.15)return;
   for(const [h,e] of [[A,B],[B,A]])if(Math.hypot(h[0]-ar.c[0],h[1]-ar.c[1])<tol){const d1=Math.hypot(e[0]-ar.e1[0],e[1]-ar.e1[1]),d2=Math.hypot(e[0]-ar.e2[0],e[1]-ar.e2[1]);if(Math.min(d1,d2)<tol*1.5){skip.add(i);open=d1<d2?'e1':'e2'}}});
  doors.push({...ar,rm,shut:open==='e1'?ar.e2:open==='e2'?ar.e1:null,curve:cu})}
 const doorCurves=new Set(doors.map(d=>d.curve));
 // draw the solid lines (and closed doorways) onto the grid
 const cv=document.createElement('canvas');cv.width=cw;cv.height=ch;const x=cv.getContext('2d');
 x.fillStyle='#fff';x.fillRect(0,0,cw,ch);x.strokeStyle='#000';x.lineWidth=RM_PEN;x.lineCap='round';x.beginPath();
 const inR=(x1,y1,x2,y2)=>!(Math.max(x1,x2)<r[0]||Math.min(x1,x2)>r[2]||Math.max(y1,y2)<r[1]||Math.min(y1,y2)>r[3]);
 segs.forEach((g,i)=>{if(g[5]||skip.has(i)||!inR(g[0],g[1],g[2],g[3]))return;x.moveTo(X(g[0]),Y(g[1]));x.lineTo(X(g[2]),Y(g[3]))});
 for(const cu of curves){if(cu.d||doorCurves.has(cu))continue;cu.pts.forEach((q,i)=>i?x.lineTo(X(q[0]),Y(q[1])):x.moveTo(X(q[0]),Y(q[1])))}
 for(const d of doors)for(const e of d.shut?[d.shut]:[d.e1,d.e2]){x.moveTo(X(d.c[0]),Y(d.c[1]));x.lineTo(X(e[0]),Y(e[1]))}
 x.stroke();
 const img=x.getImageData(0,0,cw,ch).data,n=cw*ch,lab=new Int32Array(n);
 for(let i=0;i<n;i++)if(img[i*4]<200)lab[i]=-2;   // a line
 cv.width=cv.height=0;
 // fill: everything reachable from the area edge is outside (-1); every other enclosed space gets its own number
 const q=new Int32Array(n);
 const fill=(start,id)=>{let h=0,t=0,cnt=0,sx=0,sy=0,minY=1e9,top=start,x0=1e9,x1=-1,y1=-1;q[t++]=start;lab[start]=id;
  while(h<t){const i=q[h++],px=i%cw,py=(i-px)/cw;cnt++;sx+=px;sy+=py;if(px<x0)x0=px;if(px>x1)x1=px;if(py>y1)y1=py;if(py<minY||(py===minY&&i<top)){minY=py;top=i}
   if(px>0&&lab[i-1]===0){lab[i-1]=id;q[t++]=i-1}if(px<cw-1&&lab[i+1]===0){lab[i+1]=id;q[t++]=i+1}
   if(py>0&&lab[i-cw]===0){lab[i-cw]=id;q[t++]=i-cw}if(py<ch-1&&lab[i+cw]===0){lab[i+cw]=id;q[t++]=i+cw}}
  return {cnt,cx:sx/cnt,cy:sy/cnt,top,bw:x1-x0,bh:y1-minY}};
 for(let px=0;px<cw;px++){if(!lab[px])fill(px,-1);if(!lab[(ch-1)*cw+px])fill((ch-1)*cw+px,-1)}
 for(let py=0;py<ch;py++){if(!lab[py*cw])fill(py*cw,-1);if(!lab[py*cw+cw-1])fill(py*cw+cw-1,-1)}
 const pxM2=Math.pow(k/ppm/1000,2),rooms=[];let id=0;
 for(let i=0;i<n;i++){if(lab[i])continue;id++;const c=fill(i,id),m2=c.cnt*pxM2;
  if(m2<RM_MIN_M2||c.cnt>n*.6)continue;
  if(c.bw>cw*.8||c.bh>ch*.8)continue;   // spans nearly the whole area: the sheet frame, not a room
  const tx=c.top%cw,ty=(c.top-tx)/cw,ring=simplifyRing(traceRing(lab,cw,ch,id,tx,ty),2);if(ring.length<3)continue;
  let A=0,Pm=0;ring.forEach((p0,j)=>{const p1=ring[(j+1)%ring.length];A+=p0[0]*p1[1]-p1[0]*p0[1];Pm+=Math.hypot(p1[0]-p0[0],p1[1]-p0[1])});
  const mw=2*m2/(Pm/ppm*k/1000);if(mw<RM_MIN_W)continue;   // the gap between two wall faces, a thin strip
  // label point: the middle of the longest run of this space on its centre row
  let ly=Math.round(c.cy),best=null;for(let px=0,st=-1;px<=cw;px++){const on=px<cw&&lab[ly*cw+px]===id;if(on&&st<0)st=px;if(!on&&st>=0){if(!best||px-st>best[1]-best[0])best=[st,px];st=-1}}
  const lx=best?(best[0]+best[1])/2:c.cx;
  const toN=([u,v])=>[(r[0]+u/sc)/W*1000,(r[1]+v/sc)/H*1000];
  rooms.push({pts:ring.map(toN),area_m2:Math.round(m2*100)/100,label:toN([lx,ly]),_id:id})}
 // number top to bottom, left to right; give each room the door swings at its walls
 rooms.sort((u,v)=>Math.round(u.label[1]/25)-Math.round(v.label[1]/25)||u.label[0]-v.label[0]);
 const PW=W*MM_PT,PH=H*MM_PT,near=.45/k*1000;   // 0.45 m at the sheet scale, in paper mm
 rooms.forEach((rm,i)=>{rm.id='R'+(i+1);rm.doors=[];
  for(const d of doors){const hN=[d.c[0]/W*1000,d.c[1]/H*1000],sh=d.shut||d.e1,mid=[(d.c[0]+sh[0])/2/W*1000,(d.c[1]+sh[1])/2/H*1000];
   let dist=1e9;rm.pts.forEach((p0,j)=>{const p1=rm.pts[(j+1)%rm.pts.length],a0=[p0[0]/1000*PW,p0[1]/1000*PH],a1=[p1[0]/1000*PW,p1[1]/1000*PH],m=[mid[0]/1000*PW,mid[1]/1000*PH],dx=a1[0]-a0[0],dy=a1[1]-a0[1],L2=dx*dx+dy*dy||1,u=Math.max(0,Math.min(1,((m[0]-a0[0])*dx+(m[1]-a0[1])*dy)/L2));dist=Math.min(dist,Math.hypot(a0[0]+u*dx-m[0],a0[1]+u*dy-m[1]))});
   if(dist<near)rm.doors.push({at:mid.map(v=>Math.round(v*100)/100),w_paper_mm:Math.round(d.r*MM_PT*1000)/1000})}
  delete rm._id});
 const out={rooms,doors:doors.length,scale:k,px:[cw,ch]};ROOMS_CACHE.set(key,out);return out;
}
// Room numbers drawn onto the image sent to the AI (canvas c shows the area at `kpx` px per page unit, offset X0/Y0).
function drawRoomTags(c,rooms,W,H,X0,Y0,kpx){
 const x=c.getContext('2d'),fs=Math.max(14,Math.round(2.2/MM_PT*kpx));
 x.font=`bold ${fs}px Arial`;x.textAlign='center';x.textBaseline='middle';x.lineJoin='round';
 for(const rm of rooms){const px=(rm.label[0]/1000*W-X0)*kpx,py=(rm.label[1]/1000*H-Y0)*kpx,t=rm.id,tw=x.measureText(t).width;
  x.fillStyle='rgba(255,255,255,.85)';x.fillRect(px-tw/2-3,py-fs/2-2,tw+6,fs+4);x.strokeStyle='#c00000';x.lineWidth=1.5;x.strokeRect(px-tw/2-3,py-fs/2-2,tw+6,fs+4);
  x.fillStyle='#c00000';x.fillText(t,px,py)}
}
