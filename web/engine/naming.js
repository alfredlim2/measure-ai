/* Measure.AI engine — AI sheet naming payload. Extracted from the measuring code; no page layout or DOM here. */
/* ---------- payload ---------- */
async function renderRegion(page,{scale,offsetX=0,offsetY=0,w,h},quality=.82){
 const c=document.createElement('canvas');c.width=Math.round(w);c.height=Math.round(h);
 const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);
 await page.render({canvasContext:x,viewport:page.getViewport({scale,offsetX,offsetY})}).promise;
 return c.toDataURL('image/jpeg',quality);
}
async function buildPayload(s,whole){
 const page=await pageOf(s);const vp=page.getViewport({scale:1});const W=vp.width,H=vp.height;
 const images=[],R=null;
 if(R){   // the title-block box only (fractions of the page, top-left origin)
  const x=R.x*W,y=R.y*H,w=R.w*W,h=R.h*H,k=regionScale(w,h);
  images.push(await renderRegion(page,{scale:k,offsetX:-x*k,offsetY:-y*k,w:w*k,h:h*k},.9));
 }else{
  const k0=1500/Math.max(W,H);images.push(await renderRegion(page,{scale:k0,w:W*k0,h:H*k0}));
  const k1=2000/H;images.push(await renderRegion(page,{scale:k1,offsetX:-W*.78*k1,w:W*.22*k1,h:H*k1}));      // right strip
  const k2=2000/W;images.push(await renderRegion(page,{scale:k2,offsetY:-H*.8*k2,w:W*k2,h:H*.2*k2}));      // bottom strip
 }
 let text=[];
 if(APP.cfg&&APP.cfg.demo){try{const tc=await page.getTextContent();   // demo mode reads only the text layer
  text=tc.items.filter(i=>i.str&&i.str.trim()).map(i=>{const [a,b,cc,d,e,f]=pdfjs.Util.transform(vp.transform,i.transform);return {s:i.str.trim(),x:Math.max(0,Math.min(1,e/W)),y:Math.max(0,Math.min(1,f/H)),h:Math.hypot(cc,d)}})
   .filter(t=>!R||(t.x>=R.x&&t.x<=R.x+R.w&&t.y>=R.y&&t.y<=R.y+R.h)).sort((p,q)=>p.y-q.y||p.x-q.x).slice(0,600)}catch(e){}}
 return {fileName:s.file.name,page:s.page,pageCount:s.file.pages,images,text,region:R?{x:R.x,y:R.y,w:R.w,h:R.h}:null};
}

// write an AI naming answer onto a sheet (number, title, scale, type, discipline, level)
function applyName(s,j){
 const m=s.meta,single=s.file.pages===1;
 if(!single){m.label=j.drawing_number||'';m.title=j.title||''}
 if(j.scale)m.scale=j.scale;m.type=j.sheet_type||'';m.discipline=j.discipline||'';
 const named=single||!!(m.label||m.title);
 if(named)setGroup(s);else{m.group='Not named yet';m.kind=kindOf(m)}
 const fl=normFloor(j.level);if(fl)s.floor=fl;
 s.ai={status:named?'done':'notfound'};
}
