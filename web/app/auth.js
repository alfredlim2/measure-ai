/* Sign in, create account, forgot / reset password. */
const AUTH_SIDE=`<div class="side">${BRAND}<div>
 <h1>Quantities from your PDF drawings, ready to check.</h1>
 <p>Upload a drawing set, choose what to measure, and get concrete, formwork, finishes and steel quantities, each one drawn on the sheet with its calculation.</p>
 <div class="feats">
  <div class="feat"><i>${icon('layers')}</i><div><b>Reads the whole set</b><div class="muted">Schedules, details and sections are used together.</div></div></div>
  <div class="feat"><i>${icon('ruler')}</i><div><b>Exact geometry</b><div class="muted">Lengths and areas come from the drawing's own lines.</div></div></div>
  <div class="feat"><i>${icon('shield')}</i><div><b>Every number traceable</b><div class="muted">Click any item to see how it was measured.</div></div></div>
 </div></div><div class="faint small">© ${new Date().getFullYear()} Measure.AI</div></div>`;
const GERR={google_off:'Google sign-in is not set up on this server.',google_state:'Google sign-in expired. Please try again.',google_token:'Google sign-in failed. Please try again.',google_profile:'Google did not share your email address.',google_unverified:'Your Google email is not verified.',google_error:'Google sign-in failed. Please try again.'};

function authPage(kind,q){
 const g=APP.cfg&&APP.cfg.google;
 const gbtn=g?`<button class="gbtn" onclick="location.href='/auth/google'">${GOOGLE_G}Continue with Google</button><div class="divider">or</div>`:'';
 const forms={
  login:`<h2>Welcome back</h2><div class="muted">Sign in to your Measure.AI account.</div>${gbtn}
   <form id="f"><div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="email" required></div>
   <div class="field"><label style="display:flex">Password<span style="flex:1"></span><a href="#/forgot" class="small">Forgot password?</a></label><input class="input" name="password" type="password" autocomplete="current-password" required></div>
   <div class="err" id="err"></div><button class="btn pri block">Sign in</button></form>
   <p class="muted small" style="margin-top:18px;text-align:center">New to Measure.AI? <a href="#/signup">Create an account</a></p>`,
  signup:`<h2>Create your account</h2><div class="muted">Start measuring your drawings in minutes.</div>${gbtn}
   <form id="f"><div class="field"><label>Name</label><input class="input" name="name" autocomplete="name"></div>
   <div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="email" required></div>
   <div class="field"><label>Password</label><input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"></div>
   <div class="err" id="err"></div><button class="btn pri block">Create account</button></form>
   <p class="muted small" style="margin-top:18px;text-align:center">Already have an account? <a href="#/login">Sign in</a></p>`,
  forgot:`<h2>Reset your password</h2><div class="muted">Enter your email and we will send you a link to choose a new password.</div>
   <form id="f"><div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="email" required></div>
   <div class="err" id="err"></div><button class="btn pri block">Send reset link</button></form>
   <p class="muted small" style="margin-top:18px;text-align:center"><a href="#/login">Back to sign in</a></p>`,
  reset:`<h2>Choose a new password</h2><div class="muted">Your new password must have at least 8 characters.</div>
   <form id="f"><div class="field"><label>New password</label><input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
   <div class="err" id="err"></div><button class="btn pri block">Save password</button></form>`,
 };
 $('#app').innerHTML=`<div class="auth">${AUTH_SIDE}<div class="form"><div class="box">${forms[kind]}</div></div></div>`;
 const f=$('#f'),err=$('#err');
 if(q.get('error'))err.textContent=GERR[q.get('error')]||'Sign-in failed.';
 f.onsubmit=async e=>{e.preventDefault();err.textContent='';const b=f.querySelector('button');b.disabled=true;
  const d=Object.fromEntries(new FormData(f));
  try{
   if(kind==='forgot'){await api('auth/forgot',{method:'POST',body:d});f.outerHTML='<div class="note">If an account exists for that email, a reset link is on its way. Check your inbox.</div>';return}
   const r=await api('auth/'+(kind==='reset'?'reset':kind),{method:'POST',body:kind==='reset'?{...d,token:q.get('token')}:d});
   APP.user=r.user;go('/projects');if(kind==='signup')toast('Welcome to Measure.AI!');
  }catch(x){err.textContent=x.message;b.disabled=false}
 };
}
