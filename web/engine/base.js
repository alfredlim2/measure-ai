/* Measure.AI engine — helpers, sheets and floors. Extracted from the measuring code; no page layout or DOM here. */
const $=s=>document.querySelector(s);
const pdfjs=window.pdfjsLib;
if(pdfjs){pdfjs.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.min.js'}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const r2=v=>Math.round(v*100)/100, r3=v=>Math.round(v*1000)/1000;
const fx=(v,d=2)=>(+v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pad2=n=>String(n).padStart(2,'0');
// Review reasons come from the AI as short codes (lib/takeoff.js REASON_CODES), optionally "code: a few words"; shown as text.
const REASON_TXT={no_size:'Size / profile not found in the set',no_detail:'Detail not in the set',mark_unclear:'Mark unreadable or inferred',geometry_unclear:'Position or outline unclear',hidden:'Hidden or overlapped by other linework',conflict:'Sources in the set disagree',count_unsure:'Number of repeats uncertain',scale_unsure:'Scale of this view uncertain',level_unsure:'Levels / heights not found',other:'Other'};
const reasonText=r=>{r=String(r||'').trim();const m=r.match(/^([a-z_]+)\s*(?::\s*(.*))?$/);if(!m||!REASON_TXT[m[1]])return r;return m[2]?(m[1]==='other'?m[2]:`${REASON_TXT[m[1]]}: ${m[2]}`):REASON_TXT[m[1]]};
// Needs-review items grouped by their first reason (numbers ignored, so "spacing 0 vs @6000" and "spacing 0 vs @5000" group)
const whyShow=e=>((e.why||'').split(' · ')[0]||'No reason given').split(': ')[0];
const whyKey=e=>whyShow(e).replace(/[\d.,]+/g,'#');
function rvGroups(E){const G=new Map();E.forEach(e=>{const k=whyKey(e);const g=G.get(k)||{k,label:whyShow(e),n:0,types:new Set(),items:[]};g.n++;g.types.add(e.type);g.items.push(e);G.set(k,g)});return [...G.values()].sort((a,b)=>b.n-a.n)}
/* overlay */
// Colours per item type, chosen to stand out on the white canvas with the drawing in grey.
const COLORS={col:'#9333ea',beam:'#d97706',slab:'#0d9488',wall:'#2563eb',fdn:'#dc2626',stair:'#65a30d',oth:'#64748b',
 room:'#16a34a',wfin:'#2563eb',door:'#ea580c',win:'#0891b2',opn:'#7c3aed',
 scol:'#9333ea',sbeam:'#d97706',sbrc:'#dc2626',spur:'#0891b2',struss:'#65a30d',ssec:'#64748b',sjoint:'#be185d'};   // steel
const KIND_ORDER={room:-1,slab:0,fdn:1,stair:2,oth:3,wall:4,beam:5,col:6,wfin:7,opn:8,win:8,door:8,struss:4,spur:5,ssec:5,sbrc:6,sbeam:7,scol:9,sjoint:10};   // draw order; hit-test prefers the reverse
const KIND_LBL=[['col','Column'],['beam','Beam'],['slab','Slab'],['wall','Wall'],['fdn','Footing / pile cap'],['stair','Stair'],['oth','Other'],['room','Floor area'],['wfin','Wall finish'],['door','Door'],['win','Window'],['opn','Opening'],
 ['scol','Steel column'],['sbeam','Steel beam'],['sbrc','Bracing'],['spur','Purlin / girt'],['struss','Rafter / truss'],['ssec','Secondary steel'],['sjoint','Connection']];
function inPoly(x,y,P){let ins=false;for(let i=0,j=P.length-1;i<P.length;j=i++){const [xi,yi]=P[i],[xj,yj]=P[j];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))ins=!ins}return ins}
function nearLine(x,y,P,t){for(let i=0;i+1<P.length;i++){const [ax,ay]=P[i],[bx,by]=P[i+1];const dx=bx-ax,dy=by-ay,L=dx*dx+dy*dy||1;let u=((x-ax)*dx+(y-ay)*dy)/L;u=Math.max(0,Math.min(1,u));if(Math.hypot(ax+u*dx-x,ay+u*dy-y)<t)return true}return false}   // open polyline
function nearPoly(x,y,P,t){for(let i=0;i<P.length;i++){const [ax,ay]=P[i],[bx,by]=P[(i+1)%P.length];const dx=bx-ax,dy=by-ay,L=dx*dx+dy*dy||1;let u=((x-ax)*dx+(y-ay)*dy)/L;u=Math.max(0,Math.min(1,u));if(Math.hypot(ax+u*dx-x,ay+u*dy-y)<t)return true}return false}
const GROUP_ORDER=['Plans','Sections','Elevations','Standard details','Schedules','Others','Drawings','Not named yet'];
const TYPE_GROUP={plan:'Plans',section:'Sections',elevation:'Elevations',detail:'Standard details',schedule:'Schedules',other:'Others'};
/* AI tags: discipline + drawing type (set in naming.js from the AI answer, or by hand in Attribute Editor) */
const DISC_TAG={structural:{n:'Structural',k:'S'},architectural:{n:'Architectural',k:'A'},other:{n:'Other',k:'O'}};
const TYPE_TAG={plan:{n:'Plan',k:'Plan'},section:{n:'Section',k:'Sect'},elevation:{n:'Elevation',k:'Elev'},detail:{n:'Standard details',k:'Detail'},schedule:{n:'Schedule',k:'Sched'},other:{n:'Others',k:'Other'}};
const tagged=s=>!!(s.meta.type||s.meta.discipline);
function tagText(m){return [DISC_TAG[m.discipline]?.n,TYPE_TAG[m.type]?.n].filter(Boolean).join(' · ')}
function setGroup(s){const m=s.meta;m.group=m.type?(TYPE_GROUP[m.type]||'Others'):s.file.pages===1?'Drawings':'Not named yet';m.kind=kindOf(m)}
const baseName=n=>String(n).replace(/\.pdf$/i,'').trim();
const pad3=n=>String(n).padStart(3,'0');
function pageOf(sh){return sh.file.pdf.getPage(sh.page)}
function sname(s){const m=s.meta;return [m.label,m.title].filter(Boolean).join(' ')||m.placeholder}
function kindOf(m){const t=`${m.title} ${m.label}`;if(m.type!=='plan'||m.discipline==='architectural')return '';if(/kolom|column/i.test(t))return 'colplan';if(/balok|beam|plat|slab|framing/i.test(t))return 'beamplan';return ''}

const fmtDur=s=>{s=Math.max(0,Math.round(s));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),ss=s%60;return h?`${h}:${pad2(m)}:${pad2(ss)}`:`${m}:${pad2(ss)}`};
/* ================= stages ================= */
function sheetOf(p){return DOC.sheets.find(s=>s.p===p)}
function summary(t){if(t.toolId==='fin')return finSummary(t);if(t.toolId==='steel')return stlSummary(t);const E=t.elements,s=k=>E.reduce((a,e)=>a+e.q[k],0);
 return [{v:E.length,l:'Elements'},{v:fx(s('v'),1)+' m³',l:'Concrete'},{v:fx(s('fw'),0)+' m²',l:'Formwork'},{v:E.filter(e=>e.status==='rv').length,l:'Need review'}]}

function groupsOf(E,keyf){const G={};E.forEach(e=>{const k=keyf(e);const g=(G[k]=G[k]||{k,floor:e.floor,grade:e.grade,type:e.type,name:e.name,sec:e.sec,n:0,rv:0,ids:[],sheet:e.sheet,v:0,fw:0,fs:0});g.n++;g.ids.push(e.id);if(e.status==='rv')g.rv++;g.v+=e.q.v;g.fw+=e.q.fw;g.fs+=e.q.fs});return Object.values(G)}
const TYPE_ORDER={'Column':0,'Beam':1,'In-situ Slab':2,'Wall':3,'Footing':4,'Pile Cap':5,'Stair':6,'Other concrete':7};
// The open project's drawings: files (loaded PDFs) and sheets (one per imported page). Filled by the app (web/app/).
let DOC={files:[],sheets:[]};
// Floors are kept as the drawing names them; they sort basement → ground → numbered levels → roof.
const FLOORS=[];
function floorRank(f){const s=String(f||'').toLowerCase();if(!s||s==='—')return 999;
 if(/basement|lower ground|semi|^b\d|bawah/.test(s)){const n=+((s.match(/\d+/)||[1])[0]);return 100-n}
 if(/ground|dasar|^g\b|^gf|^l0\b|^level 0/.test(s))return 200;if(/roof|atap|top/.test(s))return 900;
 const n=s.match(/(\d+)/);return n?200+ +n[1]:500}
const FI=floorRank;
function normFloor(v){return String(v||'').trim()}
