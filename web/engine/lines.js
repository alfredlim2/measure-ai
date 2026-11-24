/* Measure.AI engine — PDF lines and analysis areas. Extracted from the measuring code; no page layout or DOM here. */
// a sheet's analysis area (fractions of the page, top-left origin) is kept on the sheet itself (saved with the drawing)
function areaOf(p){const s=sheetOf(p);const a=s&&s.area;return a&&a.w>.005&&a.h>.005?a:null}
// Every straight segment of a page, as drawn (vector.js pageSegments), cached per sheet.
const SEG_CACHE=new Map(),LINE_N=new Map();
function segsOf(p){if(!SEG_CACHE.has(p))SEG_CACHE.set(p,(async()=>{const pg=await pageOf(sheetOf(p)),v=pg.getViewport({scale:1});const {segs,curves}=await pageSegments(pg);return {segs,curves,W:v.width,H:v.height}})().catch(e=>{SEG_CACHE.delete(p);throw e}));return SEG_CACHE.get(p)}
// Liang–Barsky: the part of a segment inside the rectangle r = [x0,y0,x1,y1], or null.
function clipSeg(x1,y1,x2,y2,r){let t0=0,t1=1;const dx=x2-x1,dy=y2-y1;
 for(const [p,q] of [[-dx,x1-r[0]],[dx,r[2]-x1],[-dy,y1-r[1]],[dy,r[3]-y1]]){if(p===0){if(q<0)return null;continue}const t=q/p;if(p<0){if(t>t1)return null;if(t>t0)t0=t}else{if(t<t0)return null;if(t<t1)t1=t}}
 return [x1+t0*dx,y1+t0*dy,x1+t1*dx,y1+t1*dy]}
// Lines inside the area (whole sheet if none), page 0–1000 coordinates: [x1,y1,x2,y2,weight mm,dashed]. A line drawn twice
// at exactly the same place counts once; nothing else is combined.
async function linesIn(p,a){
 const {segs,W,H}=await segsOf(p),r=a?[a.x*W,a.y*H,(a.x+a.w)*W,(a.y+a.h)*H]:[0,0,W,H],out=[],seen=new Set();
 for(const s of segs){const c=clipSeg(s[0],s[1],s[2],s[3],r);if(!c||Math.hypot(c[2]-c[0],c[3]-c[1])<.3)continue;   // < 0.1 mm: a dot
  const L=[c[0]/W*1000,c[1]/H*1000,c[2]/W*1000,c[3]/H*1000].map(v=>Math.round(v*100)/100),k=L.join(','),k2=[L[2],L[3],L[0],L[1]].join(',');
  if(seen.has(k)||seen.has(k2))continue;seen.add(k);out.push([...L,s[4]||0,s[5]||0])}
 LINE_N.set(p,out.length);return out}
const lineTokens=n=>Math.round(n*9.5);   // "123: y430 x168–311 w35" ≈ 9–10 tokens per line

/* ---- setup panel: how many lines each selected drawing would send ---- */
const LINES_MAX=25000;   // per sheet: ~240k tokens; bigger areas are refused before the run
