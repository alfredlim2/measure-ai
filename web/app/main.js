/* Start-up and routes. */
async function route(){
 const h=location.hash.replace(/^#/,'')||'/projects',[path,qs]=h.split('?'),q=new URLSearchParams(qs||'');
 const pub=['/login','/signup','/forgot','/reset'];
 if(!APP.user&&!pub.includes(path)){go('/login');return}
 if(APP.user&&['/login','/signup'].includes(path)){go('/projects');return}
 if(path!==APP.route&&WS.project&&!path.startsWith('/p/')){WS.project=null;DOC={files:[],sheets:[]}}
 APP.route=path;
 if(pub.includes(path))return authPage(path.slice(1),q);
 const m=path.match(/^\/p\/(\d+)$/);
 if(m)return workspacePage(+m[1]);
 if(path==='/account')return APP.cfg.testMode?go('/projects'):accountPage();   // no account page in test mode
 if(path==='/admin')return adminPage();
 return projectsPage();
}
window.addEventListener('hashchange',route);
(async()=>{
 try{APP.cfg=await api('config');CF.vision=APP.cfg.vision}catch(e){APP.cfg={measure:false,naming:false,google:false,maxUploadMb:150}}
 try{APP.user=(await api('auth/me')).user}catch(e){APP.user=null}
 route();
})();
// every form field: tie its label to its input (screen readers, click on the label)
let fieldN=0;
new MutationObserver(()=>document.querySelectorAll('.field').forEach(f=>{const l=f.querySelector('label'),i=f.querySelector('input,select,textarea');if(l&&i&&!l.htmlFor){if(!i.id)i.id='fld'+(++fieldN);l.htmlFor=i.id}})).observe(document.body,{childList:true,subtree:true});
