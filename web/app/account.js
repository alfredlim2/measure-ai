/* Account: profile, password, credits (balance, history, top-up) — and the administrators' accounts page. */
const LEDGER_KIND={topup:'Top-up',run:'Measurement',adjust:'Adjustment',bonus:'Welcome credits',refund:'Refund'};
async function accountPage(){
 $('#app').innerHTML=shell('account','<div class="page"><span class="spin"></span></div>');
 let d;try{d=await api('account')}catch(e){$('.page').innerHTML=`<div class="note warn">${esc(e.message)}</div>`;return}
 const u=d.user;APP.user={...APP.user,...u};setCredits(u.credits);
 $('.page').innerHTML=`<div class="page-head"><div><h1>Account</h1><div class="muted">${esc(u.email)}</div></div></div>
 <div class="acct">
  <div class="card"><h2>Credits</h2><div class="bal"><b>${u.credits.toLocaleString()}</b><span class="muted">credits available</span></div>
   <div class="muted small" style="margin-bottom:14px">Each measurement uses credits according to the drawings and items it measures. You only pay for what a run actually uses; a run stops when your credits run out and keeps everything found so far.</div>
   <button class="btn pri" id="topB">${icon('plus')}Top up credits</button></div>
  <div class="card"><h2>Profile</h2><div style="margin-top:14px"><div class="field"><label>Name</label><input class="input" id="nm" value="${esc(u.name)}"></div><div class="field"><label>Email</label><input class="input" value="${esc(u.email)}" disabled></div>
   <div class="small muted" style="margin-bottom:12px">Sign-in: ${[u.hasPassword?'email and password':'',u.google?'Google':''].filter(Boolean).join(' and ')||'—'}</div><button class="btn" id="svN">Save name</button></div></div>
  <div class="card"><h2>${u.hasPassword?'Change password':'Set a password'}</h2><form id="pw" style="margin-top:14px">${u.hasPassword?'<div class="field"><label>Current password</label><input class="input" name="current" type="password" autocomplete="current-password" required></div>':''}
   <div class="field"><label>New password</label><input class="input" name="password" type="password" minlength="8" autocomplete="new-password" required placeholder="At least 8 characters"></div><div class="err" id="pwErr"></div><button class="btn">${u.hasPassword?'Change password':'Set password'}</button></form></div>
  <div class="card"><h2>Member since</h2><div class="bal"><b style="font-size:28px">${fmtDate(u.createdAt)}</b></div><button class="btn" id="out">Sign out</button></div>
  <div class="card full"><h2>Credit history</h2>${d.ledger.length?`<div class="qwrap" style="margin-top:14px"><table class="q"><thead><tr><th>Date</th><th>What</th><th>Details</th><th class="n">Credits</th><th class="n">Balance</th></tr></thead><tbody>${d.ledger.map(x=>`<tr><td>${fmtTime(x.at)}</td><td>${LEDGER_KIND[x.kind]||esc(x.kind)}</td><td>${esc(x.note||'')}</td><td class="n" style="color:${x.delta<0?'var(--ink)':'var(--pri-ink)'}">${x.delta>0?'+':''}${x.delta.toLocaleString()}</td><td class="n">${x.balanceAfter.toLocaleString()}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No credit activity yet.</p>'}</div>
 </div>`;
 $('#topB').onclick=topUpDialog;
 $('#svN').onclick=async()=>{try{const r=await api('account/profile',{method:'POST',body:{name:$('#nm').value}});APP.user={...APP.user,...r.user};toast('Name saved.')}catch(e){errToast(e)}};
 $('#out').onclick=async()=>{await api('auth/logout',{method:'POST'}).catch(()=>{});APP.user=null;go('/login')};
 $('#pw').onsubmit=async e=>{e.preventDefault();const f=e.target;$('#pwErr').textContent='';try{await api('account/password',{method:'POST',body:Object.fromEntries(new FormData(f))});f.reset();toast('Password saved.');accountPage()}catch(x){$('#pwErr').textContent=x.message}};
}
function topUpDialog(){
 dialog(`<header><div><h2>Top up credits</h2><p>Online payment is coming soon.</p></div><div class="sp"></div><button class="btn ghost sm" data-x>${icon('x')}</button></header>
  <div class="body"><div class="pkgs"><div class="pkg"><b>Starter</b><span class="small muted">coming soon</span></div><div class="pkg"><b>Professional</b><span class="small muted">coming soon</span></div><div class="pkg"><b>Team</b><span class="small muted">coming soon</span></div></div>
  <div class="note">Until online payment opens, contact us and we will add credits to your account (${esc(APP.user.email)}).</div></div>
  <footer><button class="btn pri" data-x>OK</button></footer>`);
}

async function adminPage(){
 if(APP.user.role!=='admin'){go('/projects');return}
 $('#app').innerHTML=shell('admin',`<div class="page"><div class="page-head"><div><h1>Accounts</h1><div class="muted">Add or remove credits, and choose who can manage accounts.</div></div><div class="sp"></div><input class="input" id="aq" placeholder="Search email or name" style="width:260px"></div><div id="al"><span class="spin"></span></div></div>`);
 let users=[];
 const paint=()=>{const q=$('#aq').value.trim().toLowerCase(),L=users.filter(u=>!q||u.email.includes(q)||(u.name||'').toLowerCase().includes(q));
  $('#al').innerHTML=`<div class="card qwrap"><table class="q"><thead><tr><th>Account</th><th>Role</th><th>Joined</th><th>Last sign-in</th><th class="n">Runs</th><th class="n">Credits</th><th></th></tr></thead><tbody>${L.map(u=>`<tr><td><b>${esc(u.name||'—')}</b><div class="small faint">${esc(u.email)}</div></td><td>${u.role==='admin'?'<span class="pill ok">Admin</span>':'<span class="pill">User</span>'}</td><td>${fmtDate(u.createdAt)}</td><td>${fmtTime(u.lastLogin)}</td><td class="n">${u.runs}</td><td class="n"><b>${u.credits.toLocaleString()}</b></td>
   <td style="white-space:nowrap;text-align:right"><button class="btn sm" data-cr="${u.id}">${icon('coins')}Credits</button> ${u.id!==APP.user.id?`<button class="btn sm ghost" data-role="${u.id}">${u.role==='admin'?'Make user':'Make admin'}</button>`:''}</td></tr>`).join('')}</tbody></table></div>`};
 const load=async()=>{try{users=(await api('admin/users')).users;paint()}catch(e){$('#al').innerHTML=`<div class="note warn">${esc(e.message)}</div>`}};
 $('#aq').oninput=paint;
 $('#al').onclick=async e=>{
  const c=e.target.closest('[data-cr]');if(c){const u=users.find(x=>x.id===+c.dataset.cr);
   const r=await dialog(`<header><div><h2>Credits for ${esc(u.email)}</h2><p>Balance: ${u.credits.toLocaleString()} credits. Use a negative number to remove credits.</p></div></header><div class="body"><div class="field"><label>Credits to add</label><input class="input" id="cd" type="number" step="1" placeholder="e.g. 500"></div><div class="field"><label>Note (shown to the user)</label><input class="input" id="cn" placeholder="e.g. Bank transfer, invoice 1042"></div></div><footer><button class="btn" data-x>Cancel</button><button class="btn pri" id="cOk">Save</button></footer>`,
    {onOpen:(d,close)=>{d.querySelector('#cd').focus();d.querySelector('#cOk').onclick=()=>close({delta:+d.querySelector('#cd').value,note:d.querySelector('#cn').value})}});
   if(!r||!r.delta)return;try{const {balance}=await api(`admin/users/${u.id}/credits`,{method:'POST',body:r});toast(`New balance: ${balance.toLocaleString()} credits.`);if(u.id===APP.user.id)setCredits(balance);load()}catch(x){errToast(x)}return}
  const ro=e.target.closest('[data-role]');if(ro){const u=users.find(x=>x.id===+ro.dataset.role);try{await api(`admin/users/${u.id}/role`,{method:'POST',body:{role:u.role==='admin'?'user':'admin'}});load()}catch(x){errToast(x)}}
 };
 load();
}
