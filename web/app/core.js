/* Measure.AI app core: API calls, icons, toasts, dialogs, routing. */
const APP={cfg:null,user:null,route:'',view:null};

// every state-changing call carries the app header (the server refuses it otherwise)
async function api(path,{method='GET',body,raw,headers={}}={}){
 const opt={method,headers:{'X-Measure-AI':'1',...headers},credentials:'same-origin'};
 if(raw){opt.body=raw}else if(body!==undefined){opt.body=JSON.stringify(body);opt.headers['Content-Type']='application/json'}
 const r=await fetch('/api/'+path,opt);
 const j=await r.json().catch(()=>({error:'The server sent an unexpected answer.'}));
 if(r.status===401&&j.code==='signed_out'&&!path.startsWith('auth/')){APP.user=null;go('/login')}
 if(!r.ok)throw Object.assign(new Error(j.error||('Error '+r.status)),{code:j.code,status:r.status});
 return j;
}

// icons (24×24 line icons)
const IC={
 plus:'<path d="M12 5v14M5 12h14"/>',upload:'<path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
 folder:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
 cube:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
 room:'<path d="M4 4h16v16H4z"/><path d="M4 12h7v8M14 4v6h6"/>',
 beam:'<path d="M3 7h18M3 17h18M7 7v10M17 7v10"/>',
 coins:'<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 14v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-4c0-1.6-2.4-2.9-5.5-3"/>',
 back:'<path d="M15 18 9 12l6-6"/>',x:'<path d="M18 6 6 18M6 6l12 12"/>',fit:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
 zin:'<circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M20 20l-4-4"/>',zout:'<circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-4-4"/>',
 check:'<path d="m5 12 5 5 9-10"/>',area:'<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M9 9h6v6H9z"/>',
 doc:'<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',download:'<path d="M12 4v12m0 0 4-4m-4 4-4-4"/><path d="M4 20h16"/>',
 trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 ruler:'<path d="m3 17 14-14 4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',layers:'<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
 eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
 bolt:'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',shield:'<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
};
const icon=(n,cls='')=>`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${IC[n]||''}</svg>`;
const BRAND=`<span class="brand"><img src="/app/icon.svg" alt=""><span>Measure<b>.AI</b></span></span>`;
const GOOGLE_G='<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

// toasts
function toast(msg,{action,label='View',ms=4000,bad=false}={}){
 const el=document.createElement('div');el.className='toast'+(bad?' bad':'');el.append(msg);
 if(action){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{action();el.remove()};el.append(b)}
 $('#toasts').append(el);setTimeout(()=>el.remove(),ms);
}
const errToast=e=>toast(e&&e.message||String(e),{bad:true,ms:6000});

// dialogs: open(html) → {el, close}; buttons with data-x close; returns a promise of the value passed to close
function dialog(html,{wide=false,onOpen}={}){
 return new Promise(resolve=>{
  const ov=document.createElement('div');ov.className='modal';ov.innerHTML=`<div class="dlg${wide?' wide':''}" role="dialog">${html}</div>`;
  document.body.append(ov);
  const close=v=>{document.removeEventListener('keydown',key,true);ov.remove();resolve(v)};
  const key=e=>{if(e.key==='Escape'){e.preventDefault();close(null)}};document.addEventListener('keydown',key,true);
  ov.addEventListener('mousedown',e=>{if(e.target===ov)close(null)});
  ov.querySelectorAll('[data-x]').forEach(b=>b.onclick=()=>close(null));
  if(onOpen)onOpen(ov.firstElementChild,close);
 });
}
function confirmDlg(title,text,{ok='Confirm',danger=false}={}){
 return dialog(`<header><div><h2>${esc(title)}</h2><p>${esc(text)}</p></div></header><footer><button class="btn" data-x>Cancel</button><button class="btn ${danger?'danger':'pri'}" id="cOk">${esc(ok)}</button></footer>`,
  {onOpen:(d,close)=>{d.querySelector('#cOk').onclick=()=>close(true)}});
}
function promptDlg(title,{label='',value='',ok='Save',placeholder=''}={}){
 return dialog(`<header><div><h2>${esc(title)}</h2></div></header><div class="body"><div class="field"><label>${esc(label)}</label><input class="input" id="pIn" value="${esc(value)}" placeholder="${esc(placeholder)}"></div></div><footer><button class="btn" data-x>Cancel</button><button class="btn pri" id="pOk">${esc(ok)}</button></footer>`,
  {onOpen:(d,close)=>{const i=d.querySelector('#pIn');i.focus();i.select();const go=()=>close(i.value.trim());d.querySelector('#pOk').onclick=go;i.onkeydown=e=>{if(e.key==='Enter')go()}}});
}
const fmtDate=t=>t?new Date(t).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):'—';
const fmtTime=t=>t?new Date(t).toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
const plural=(n,w,ws)=>`${n} ${n===1?w:(ws||w+'s')}`;

// routing: #/login, #/projects, #/p/12, #/account, #/admin
function go(path){if(location.hash!=='#'+path)location.hash=path;else route()}
// test mode: which AI key the server uses (masked) and the run cap
async function testInfo(){let d;try{d=await api('test/info')}catch(e){return errToast(e)}
 const row=(k,v)=>`<tr><td style="width:40%">${k}</td><td>${v}</td></tr>`;
 dialog(`<header><div><h2>Test mode</h2><p>Sign-in, credits and top-up are off on this server.</p></div><div class="sp"></div><button class="btn ghost sm" data-x>${icon('x')}</button></header>
  <div class="body"><table class="q">${row('AI key',d.key.set?`<code>${esc(d.key.hint)}</code> · ${d.key.length} characters · from ${esc(d.key.source||'?')}`:'<b>Not set</b>')}${row('AI',d.ready?'Ready':'Not available')}${row('Spending cap per run',d.cap?'$'+d.cap:'None')}${row('Open to',d.remote?'Other computers too':'This computer only')}</table>
  <div class="small muted" style="margin-top:10px">The full key stays on the server and is never sent to the browser. To change it, edit ai-settings.json (or OPENAI_API_KEY in .env) and restart the server.</div></div>
  <footer><button class="btn pri" data-x>OK</button></footer>`)}
function setCredits(n){if(APP.user){APP.user.credits=n;const c=$('#credN');if(c)c.textContent=n.toLocaleString()}}
function shell(active,inner){
 const u=APP.user,init=(u.name||u.email||'?').trim()[0].toUpperCase();
 return `<header class="top">${BRAND}<nav><a href="#/projects" class="${active==='projects'?'on':''}">Projects</a>${u.role==='admin'?`<a href="#/admin" class="${active==='admin'?'on':''}">Admin</a>`:''}</nav><div class="sp"></div>
  ${APP.cfg.testMode?'<button class="credits" onclick="testInfo()" title="Test mode: sign-in and credits are off. Click for the AI key in use.">TEST MODE</button>':`<button class="credits" onclick="go('/account')" title="Your credits">${icon('coins')}<span id="credN">${(u.credits||0).toLocaleString()}</span><span class="cl">credits</span></button>`}
  <button class="avatar" id="avBtn" title="Account">${esc(init)}</button></header>${inner}`;
}
document.addEventListener('click',e=>{
 const av=e.target.closest('#avBtn'),m=$('.menu');
 if(av){if(m){m.remove();return}const u=APP.user,d=document.createElement('div');d.className='menu';
  d.innerHTML=`<div class="who"><b>${esc(u.name||'Your account')}</b><div class="small muted">${esc(u.email)}</div></div>${APP.cfg.testMode?'<button data-m="projects">Projects</button>':'<button data-m="account">Account & credits</button><button data-m="projects">Projects</button><button data-m="logout">Sign out</button>'}`;
  document.body.append(d);d.onclick=async ev=>{const b=ev.target.closest('[data-m]');if(!b)return;d.remove();
   if(b.dataset.m==='logout'){await api('auth/logout',{method:'POST'}).catch(()=>{});APP.user=null;go('/login')}else go('/'+b.dataset.m)};return}
 if(m&&!e.target.closest('.menu'))m.remove();
});
