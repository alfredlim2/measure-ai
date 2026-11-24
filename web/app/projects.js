/* Projects list. */
async function projectsPage(){
 $('#app').innerHTML=shell('projects',`<div class="page"><div class="page-head"><div><h1>Projects</h1><div class="muted">Each project keeps its drawings and every measurement you run on them.</div></div><div class="sp"></div><button class="btn pri" id="newP">${icon('plus')}New project</button></div><div id="pl"><span class="spin"></span></div></div>`);
 $('#newP').onclick=newProject;
 try{
  const {projects}=await api('projects');
  $('#pl').innerHTML=projects.length?`<div class="grid">${projects.map(p=>`<div class="card proj" data-open="${p.id}"><div style="display:flex;align-items:center;gap:10px"><span class="ico">${icon('folder')}</span><div class="sp" style="flex:1"></div><button class="btn ghost sm" data-del="${p.id}" title="Delete project">${icon('trash')}</button></div>
   <div><h3>${esc(p.name)}</h3><div class="small faint">Updated ${fmtDate(p.updatedAt)}</div></div><div class="meta"><span>${plural(p.drawings,'drawing')}</span><span>${plural(p.runs,'measurement')}</span></div></div>`).join('')}</div>`
   :`<div class="card empty"><div class="ico">${icon('folder')}</div><h2>Create your first project</h2><p>A project holds the drawings of one job. Upload PDF drawings, choose what to measure, and Measure.AI does the takeoff.</p><button class="btn pri" id="newP2">${icon('plus')}New project</button></div>`;
  const b=$('#newP2');if(b)b.onclick=newProject;
  $('#pl').onclick=async e=>{const d=e.target.closest('[data-del]');if(d){e.stopPropagation();const p=projects.find(x=>x.id===+d.dataset.del);
    if(await confirmDlg('Delete project?',`“${p.name}”, its drawings and its measurements will be deleted. This cannot be undone.`,{ok:'Delete project',danger:true})){try{await api('projects/'+p.id,{method:'DELETE'});projectsPage()}catch(x){errToast(x)}}return}
   const o=e.target.closest('[data-open]');if(o)go('/p/'+o.dataset.open)};
 }catch(e){$('#pl').innerHTML=`<div class="note warn">${esc(e.message)}</div>`}
}
async function newProject(){
 const name=await promptDlg('New project',{label:'Project name',placeholder:'e.g. Riverside Tower, Block B',ok:'Create project'});if(name==null)return;
 try{const {project}=await api('projects',{method:'POST',body:{name}});go('/p/'+project.id)}catch(e){errToast(e)}
}
