import{CATEGORIES,STATUSES,SEMESTERS,SEED,totals,gpa,gradingFor,categoriesFor,validateState}from'./model.js';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY='eth-cs-ects-v1:'+new URL('.',location.href).pathname;let state={version:1,courses:[],semesters:structuredClone(SEMESTERS)},catalogue=[],showProjected=false,targetSemester='2026W',undoState=null,toastTimer,selectedCategory=null,loadIssue='';
let restored=false;
try{const data=localStorage.getItem(KEY);if(data){state=validateState(JSON.parse(data));restored=true;}}catch{loadIssue='Saved browser data could not be loaded. The saved starting plan is shown. Import a backup to restore another plan.';}
if(!restored){try{const response=await fetch('./initial-plan.json',{cache:'no-cache'});if(!response.ok)throw Error('Starting plan unavailable');state=validateState(await response.json());}catch{loadIssue='The starting plan could not be loaded. Import a JSON backup or add courses to start.';}}
const fmt=n=>Number.isInteger(n)?String(n):String(Number(n.toFixed(2)));
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));$('#save-state').textContent='Saved on this device';}catch{$('#save-state').textContent='Storage unavailable · export your plan';toast('Browser storage unavailable. Export your plan to keep changes.');}}
function toast(message,undo=false){clearTimeout(toastTimer);const t=$('#toast');t.hidden=false;t.innerHTML=esc(message)+(undo?' <button id="undo">Undo</button>':'');if(undo)$('#undo').onclick=()=>{if(undoState){state=undoState;undoState=null;save();render();toast('Change undone.');}};toastTimer=setTimeout(()=>t.hidden=true,undo?10000:6500);}
function beforeChange(){undoState=structuredClone(state);}
function render(){
 const earned=totals(state.courses),projected=totals(state.courses,true),shown=showProjected?projected:earned;
 const grades=gpa(state.courses),displayGpa=value=>value===null?'—':value.toFixed(2);
 $('#current-gpa').textContent=displayGpa(grades.current);$('#projected-gpa').textContent=displayGpa(grades.projected);
 $('#current-gpa-note').textContent=`${fmt(grades.earnedCredits)} graded ECTS${grades.missingEarned?' · '+fmt(grades.missingEarned)+' missing grades':''}`;
 $('#projected-gpa-note').textContent=`${fmt(grades.expectedCredits)} / ${fmt(grades.pendingCredits)} pending graded ECTS estimated`;
 const enrolled=state.courses.filter(c=>c.status==='enrolled').reduce((s,c)=>s+c.ects,0);
 $('#earned').textContent=fmt(earned.total);$('#enrolled').innerHTML=`${fmt(enrolled)}<span> ECTS</span>`;$('#projected').innerHTML=`${fmt(projected.total)}<span> ECTS</span>`;$('#remaining').innerHTML=`${fmt(Math.max(120-projected.total,0))}<span> ECTS</span>`;
 const ep=Math.min(earned.total/120*100,100),pp=Math.min(projected.total/120*100,100);$('#overall-bar').innerHTML=`<div class="earned" style="width:${ep}%"></div><div class="future" style="width:${Math.max(pp-ep,0)}%"></div>`;
 $('#degree-note').textContent=projected.complete?'All tracked requirements covered':projected.total>=120?'Check unmet category requirements':'Category requirements also apply';
 $('#projected-note').textContent=`${fmt(Math.max(projected.total-earned.total,0))} pending / planned ECTS included`;
 $('#requirements').innerHTML=shown.requirements.map(r=>`<button type="button" class="requirement ${r.met?'met':''}" data-category="${r.key}" aria-label="View courses in ${esc(r.label)}" aria-haspopup="dialog" title="View courses · ${esc(r.detail)}"><span class="req-label">${esc(r.label)}${r.met?'<span class="req-check" aria-label="Met">✓</span>':''}</span><span class="req-value">${fmt(r.value)} <span>/ ${r.min}</span></span><span class="req-bar"><span style="width:${Math.min(r.value/r.min*100,100)}%"></span></span><span class="req-detail">${esc(r.detail)}</span></button>`).join('');
 $('#courses-minimum').textContent=`Course subtotal ${fmt(shown.coursesTotal)} / 76 ECTS · ${showProjected?'including scheduled plans':'passed courses'}`;
 $('#warnings').innerHTML=shown.warnings.map(x=>`<div class="warning">${esc(x)}</div>`).join('');
 const semesters=[...state.semesters];if(state.courses.some(c=>c.semester==='unscheduled'))semesters.push({id:'unscheduled',name:'Unscheduled'});
 $('#board').innerHTML=semesters.map(s=>{
  const courses=state.courses.filter(c=>c.semester===s.id),all=courses.filter(c=>c.status!=='failed').reduce((a,c)=>a+c.ects,0),passed=courses.filter(c=>c.status==='passed').reduce((a,c)=>a+c.ects,0);
  return`<section class="semester ${s.id==='2026W'?'current':''}" data-semester="${esc(s.id)}" aria-label="${esc(s.name)}"><div class="semester-header"><h3>${esc(s.name)}</h3><span class="semester-credits"><strong>${fmt(all)}</strong> ECTS</span></div><div class="semester-sub"><span>${courses.length} course${courses.length===1?'':'s'}${passed?' · '+fmt(passed)+' earned':''}</span>${s.id==='2026W'?'<span class="current-label">Current semester</span>':''}</div><div class="course-list">${courses.map(card).join('')||'<div class="empty-semester">Drop courses here<br>or add from the catalogue<button class="text-button" data-add="'+esc(s.id)+'">＋ Add course</button></div>'}</div>${courses.length?'<button class="semester-add" data-add="'+esc(s.id)+'">＋ Add course</button>':''}</section>`;
 }).join('');bindBoard();if($('#category-dialog').open)renderCategory();
}
function card(c){return`<article class="course-card" draggable="false" data-id="${esc(c.id)}" tabindex="0" aria-label="${esc(c.title)}, ${c.ects} ECTS. Press Enter to edit or move."><div class="course-top"><span class="course-code">${esc(c.code||'CUSTOM COURSE')}</span><button class="edit-card" data-edit="${esc(c.id)}" aria-label="Edit ${esc(c.title)}">⋯</button></div><h4 class="course-name">${esc(c.title)}</h4><div class="course-bottom"><button type="button" class="tag ${c.category}" data-category="${c.category}" aria-label="View courses in ${esc(CATEGORIES[c.category])}" aria-haspopup="dialog">${esc(CATEGORIES[c.category].replace(' · Data Management',''))}</button><span class="course-ects">${fmt(c.ects)} <span style="font-weight:400;color:#8a968f;font-size:10px">ECTS</span></span></div><div class="course-status ${c.status}">${c.status==='passed'?'<span class="status-check">✓</span> ':''}${esc(STATUSES[c.status])}${c.grade?' · '+esc(c.grade):''}</div></article>`;}
function bindBoard(){
 document.querySelectorAll('[data-category]').forEach(b=>b.onclick=e=>{e.stopPropagation();openCategory(b.dataset.category);});
 document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>openCatalogue(b.dataset.add));
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=e=>{e.stopPropagation();editCourse(state.courses.find(c=>c.id===b.dataset.edit));});
 document.querySelectorAll('.course-card').forEach(el=>{
  bindPointerDrag(el);
  el.ondblclick=()=>editCourse(state.courses.find(c=>c.id===el.dataset.id));
  el.onkeydown=e=>{if(e.target===el&&(e.key==='Enter'||e.key===' ')){e.preventDefault();editCourse(state.courses.find(c=>c.id===el.dataset.id));}};

 });

}
const categoryKeys=key=>key==='major'?['majorCore','majorElective']:key==='core'?['majorCore']:[key];
const categoryTitle=key=>key==='major'?'Major · Machine Intelligence':key==='core'?'Major · core':CATEGORIES[key];
function openCategory(key){selectedCategory=key;renderCategory();$('#category-dialog').showModal();}
function renderCategory(){
 const keys=categoryKeys(selectedCategory),courses=state.courses.filter(c=>keys.includes(c.category));
 const earned=totals(courses),projected=totals(courses,true);
 $('#category-title').textContent=categoryTitle(selectedCategory);
 $('#category-summary').textContent=`${courses.length} course${courses.length===1?'':'s'} · ${fmt(earned.total)} earned ECTS · ${fmt(projected.total)} projected ECTS`;
 $('#category-courses').innerHTML=courses.map(c=>{
  const semester=state.semesters.find(s=>s.id===c.semester)?.name||'Unscheduled';
  const excluded=c.status==='failed'||(c.status!=='passed'&&c.semester==='unscheduled');
  return `<button type="button" class="category-course" data-category-edit="${esc(c.id)}" aria-label="Edit ${esc(c.title)}"><span class="category-course-info"><strong>${esc(c.title)}</strong><span class="category-course-meta">${esc(c.code||'Custom course')} · ${esc(semester)}</span><span class="category-course-meta">${esc(CATEGORIES[c.category])} · ${esc(STATUSES[c.status])}${c.grade?' · '+esc(c.grade):''}${excluded?' · Excluded from totals':''}</span></span><span class="category-course-ects">${fmt(c.ects)} <span>ECTS</span></span></button>`;
 }).join('')||'<p class="empty-results">No courses assigned to this category yet.</p>';
 document.querySelectorAll('[data-category-edit]').forEach(b=>b.onclick=()=>editCourse(state.courses.find(c=>c.id===b.dataset.categoryEdit)));
}
$('#category-browse').onclick=()=>{
 const filter=selectedCategory==='core'?'majorCore':selectedCategory;
 $('#category-dialog').close();$('#catalog-search').value='';$('#catalog-category').value=filter;$('#catalog-offering').value='all';openCatalogue();
};
function bindPointerDrag(el){
 let start=null,ghost=null,active=false,dropTarget=null;
 el.onpointerdown=e=>{if(e.button!==0||e.target.closest('button,a'))return;start={x:e.clientX,y:e.clientY,id:e.pointerId};};
 el.onpointermove=e=>{
  if(!start||e.pointerId!==start.id)return;
  if(!active&&Math.hypot(e.clientX-start.x,e.clientY-start.y)<6)return;
  if(!active){active=true;el.setPointerCapture(e.pointerId);el.classList.add('dragging');ghost=el.cloneNode(true);ghost.classList.remove('dragging');ghost.classList.add('drag-ghost');ghost.style.width=el.getBoundingClientRect().width+'px';document.body.append(ghost);}
  e.preventDefault();ghost.style.left=(e.clientX+14)+'px';ghost.style.top=(e.clientY+10)+'px';
  const next=document.elementFromPoint(e.clientX,e.clientY)?.closest('.semester');
  if(dropTarget!==next){dropTarget?.classList.remove('drop-over');dropTarget=next;dropTarget?.classList.add('drop-over');}
  const board=$('#board'),rect=board.getBoundingClientRect();if(e.clientX>rect.right-35)board.scrollLeft+=14;else if(e.clientX<rect.left+35)board.scrollLeft-=14;
 };
 const finish=e=>{
  if(!start)return;const wasActive=active,destination=dropTarget?.dataset.semester;
  if(el.hasPointerCapture(start.id))el.releasePointerCapture(start.id);start=null;active=false;ghost?.remove();ghost=null;dropTarget?.classList.remove('drop-over');dropTarget=null;el.classList.remove('dragging');
  if(wasActive&&e.type!=='pointercancel'&&destination){const c=state.courses.find(c=>c.id===el.dataset.id);if(c&&c.semester!==destination){beforeChange();c.semester=destination;save();render();toast('Course moved. Status and category retained.',true);}}
 };
 el.onpointerup=finish;el.onpointercancel=finish;el.onlostpointercapture=e=>{if(start)finish({...e,type:'pointercancel'});};
}
function setView(projected){showProjected=projected;for(const [id,active]of[['view-earned',!projected],['view-projected',projected]]){$('#'+id).classList.toggle('active',active);$('#'+id).setAttribute('aria-pressed',active);}render();}
$('#view-earned').onclick=()=>setView(false);$('#view-projected').onclick=()=>setView(true);
function openCatalogue(semester='2026W'){targetSemester=semester;$('#catalog-dialog').showModal();renderCatalogue();$('#catalog-search').focus();}
$('#add-course').onclick=()=>openCatalogue();
$('#catalog-category').insertAdjacentHTML('beforeend','<option value="major">Major · all courses</option>');
for(const [key,value]of Object.entries(CATEGORIES))$('#catalog-category').insertAdjacentHTML('beforeend',`<option value="${key}">${esc(value)}</option>`);
function renderCatalogue(){
 const q=$('#catalog-search').value.toLowerCase().trim(),category=$('#catalog-category').value,offering=$('#catalog-offering').value;
 const rows=catalogue.filter(c=>(c.title.toLowerCase().includes(q)||c.code.includes(q))&&(category==='all'||categoryKeys(category).some(key=>categoriesFor(c).includes(key)||c.category===key))&&(offering==='all'||c.offerings?.includes(offering)));
 $('#catalog-count').textContent=`${rows.length} courses`;
 $('#catalog-results').innerHTML=rows.map(c=>{
 const added=state.courses.some(x=>x.code===c.code),cat=c.category||categoriesFor(c)[0],seasons=(c.offerings||[]).map(s=>s.endsWith('W')?'Autumn 2026':'Spring 2026').join(' · ');
 return`<div class="catalog-row"><div><h3>${esc(c.title)}</h3><div class="catalog-meta">${esc(c.code)} · ${fmt(c.ects)} ECTS · ${esc(CATEGORIES[cat])}<br>${esc(seasons||'Not offered in snapshot')}${c.sources?.[0]?` · <a href="${esc(safeUrl(c.sources[0]))}" target="_blank" rel="noopener">VVZ</a>`:''}</div></div><button data-catalog-code="${esc(c.code)}" ${added?'disabled':''}>${added?'Added':'＋ Add'}</button></div>`;
 }).join('')||'<div class="empty-results">No courses found. Try another search or add a custom course.</div>';
 document.querySelectorAll('[data-catalog-code]').forEach(b=>b.onclick=()=>{const c=catalogue.find(c=>c.code===b.dataset.catalogCode);const cats=categoriesFor(c),filtered=$('#catalog-category').value;editCourse({code:c.code,title:c.title,ects:c.ects,category:c.category||(cats.includes(filtered)?filtered:cats[0]),semester:targetSemester,status:'planned',grade:'',source:'VVZ · 2026 snapshot',sourceUrl:c.sources?.[0]||'',note:'Catalogue offering is a 2026 snapshot. Check the linked VVZ for your planned semester.'});});
}
function safeUrl(url){try{const u=new URL(url);return u.protocol==='https:'&&(/(^|\.)ethz\.ch$/.test(u.hostname))?u.href:'#';}catch{return'#';}}
$('#catalog-search').oninput=renderCatalogue;$('#catalog-category').onchange=renderCatalogue;$('#catalog-offering').onchange=renderCatalogue;
$('#custom-course').onclick=()=>editCourse({code:'',title:'',ects:6,category:'free',semester:targetSemester,status:'planned',grade:'',source:'Custom course'});
function editCourse(c){
 $('#edit-title').textContent=c.id?'Edit course':'Add course';$('#course-id').value=c.id||'';$('#course-title').value=c.title;$('#course-code').value=c.code;$('#course-ects').value=c.ects;$('#course-grade').value=c.grade||'';$('#course-grading').value=gradingFor(c);$('#course-expected-grade').value=c.expectedGrade??'';
 $('#course-category').innerHTML=Object.entries(CATEGORIES).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('');$('#course-category').value=c.category;
 $('#course-semester').innerHTML=[...state.semesters,{id:'unscheduled',name:'Unscheduled'}].map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');$('#course-semester').value=c.semester;
 $('#course-status').innerHTML=Object.entries(STATUSES).map(([k,v])=>`<option value="${k}">${v}</option>`).join('');$('#course-status').value=c.status;updateExpectedField();
 $('#course-source').innerHTML=esc(c.source||'Custom course')+(c.sourceUrl?` · <a href="${esc(safeUrl(c.sourceUrl))}" target="_blank" rel="noopener">View in VVZ</a>`:'')+(c.note?'<br>'+esc(c.note):'');
 $('#category-note').textContent='One category per course. Major: Machine Intelligence; minor: Data Management.';
 $('#form-error').textContent='';$('#remove-course').hidden=!c.id;$('#course-form').dataset.draft=JSON.stringify(c);$('#edit-dialog').showModal();
}
$('#course-form').onsubmit=e=>{e.preventDefault();const draft=JSON.parse($('#course-form').dataset.draft),code=$('#course-code').value.trim().replace(/[LS]$/,'');const c={...draft,id:$('#course-id').value||crypto.randomUUID(),title:$('#course-title').value.trim(),code,ects:Number($('#course-ects').value),category:$('#course-category').value,semester:$('#course-semester').value,status:$('#course-status').value,grade:$('#course-grade').value.trim(),grading:$('#course-grading').value,expectedGrade:$('#course-expected-grade').value===''?'':Number($('#course-expected-grade').value)};
 if(state.courses.some(x=>x.id!==c.id&&code&&x.code===code)){$('#form-error').textContent='This course is already in your plan. Edit the existing course to avoid counting it twice.';return;}
 const next={...state,courses:[...state.courses.filter(x=>x.id!==c.id),c]};try{validateState(next);}catch(err){$('#form-error').textContent=err.message;return;}
 beforeChange();state=next;save();render();$('#edit-dialog').close();if($('#catalog-dialog').open)renderCatalogue();toast(draft.id?'Course updated.':'Course added to your plan.',true);
};
function updateExpectedField(){const disabled=$('#course-grading').value==='passfail'||!['enrolled','planned'].includes($('#course-status').value);$('#course-expected-grade').disabled=disabled;}
$('#course-grading').onchange=updateExpectedField;$('#course-status').onchange=updateExpectedField;
$('#expected-grades-button').onclick=()=>{
 const pending=state.courses.filter(c=>['enrolled','planned'].includes(c.status)&&c.semester!=='unscheduled');
 const graded=pending.filter(c=>gradingFor(c)==='numeric');
 $('#expected-grades-list').innerHTML=graded.map(c=>`<label class="expected-grade-row"><span><strong>${esc(c.title)}</strong><span class="gpa-note">${fmt(c.ects)} ECTS · ${esc(state.semesters.find(s=>s.id===c.semester)?.name||c.semester)}</span></span><input type="number" min="4" max="6" step="0.25" placeholder="—" aria-label="Expected grade for ${esc(c.title)}" data-expected-id="${esc(c.id)}" value="${esc(c.expectedGrade??'')}"></label>`).join('')||'<p class="empty-results">No pending graded courses. Add a course or thesis to your plan first.</p>';
 const excluded=pending.filter(c=>gradingFor(c)==='passfail');
 $('#gpa-exclusions').textContent=excluded.length?'Pass/fail excluded: '+excluded.map(c=>c.title).join(', ')+'.':'';
 $('#gpa-form-error').textContent='';$('#gpa-dialog').showModal();
};
$('#expected-grades-form').onsubmit=e=>{
 e.preventDefault();const estimates=new Map([...document.querySelectorAll('[data-expected-id]')].map(input=>[input.dataset.expectedId,input.value===''?'':Number(input.value)]));
 const next={...state,courses:state.courses.map(c=>estimates.has(c.id)?{...c,expectedGrade:estimates.get(c.id)}:c)};
 try{validateState(next);}catch(err){$('#gpa-form-error').textContent=err.message;return;}
 beforeChange();state=next;save();render();$('#gpa-dialog').close();toast('Expected grades saved.',true);
};
$('#remove-course').onclick=()=>{beforeChange();state.courses=state.courses.filter(c=>c.id!==$('#course-id').value);save();render();$('#edit-dialog').close();if($('#catalog-dialog').open)renderCatalogue();toast('Course removed.',true);};
$('#add-semester').onclick=()=>{$('#semester-error').textContent='';$('#semester-dialog').showModal();};
$('#semester-form').onsubmit=e=>{e.preventDefault();const year=Number($('#semester-year').value),season=$('#semester-season').value,id=String(year)+season;if(state.semesters.some(s=>s.id===id)){$('#semester-error').textContent='That semester is already in your plan.';return;}beforeChange();state.semesters.push({id,name:(season==='S'?'Spring':'Autumn')+' '+year});state.semesters.sort((a,b)=>a.id.localeCompare(b.id));save();render();$('#semester-dialog').close();toast('Semester added.',true);};
$('#rules-button').onclick=()=>$('#rules-dialog').showModal();
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$('#'+b.dataset.close).close();
for(const d of document.querySelectorAll('dialog'))d.addEventListener('click',e=>{const r=d.getBoundingClientRect();if(e.target===d&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))d.close();});
$('#backup').onclick=()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='eth-ects-plan.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Plan exported.');};
$('#restore').onclick=()=>$('#import-file').click();$('#import-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2000000)throw Error('Backup is too large.');const next=validateState(JSON.parse(await file.text()));beforeChange();state=next;save();render();toast('Plan imported. Previous plan can be restored with Undo.',true);}catch(err){toast(err.message);}finally{e.target.value='';}};
render();if(loadIssue)toast(loadIssue);
try{const response=await fetch('./catalogue.json');if(!response.ok)throw Error('Catalogue unavailable');const data=await response.json();const scrapedCount=data.courses.length;catalogue=data.courses;for(const seed of state.courses){if(!catalogue.some(c=>c.code===seed.code))catalogue.push({...seed,category:seed.category,offerings:seed.semester==='unscheduled'?[]:[seed.semester],paths:[],sources:[]});}catalogue.sort((a,b)=>a.title.localeCompare(b.title));$('#catalog-sources').innerHTML=data.sources.map((u,i)=>`<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener">${i===0?'Autumn':'Spring'} 2026 CS MSc listing</a>`).join(' · ')+`<br>${scrapedCount} unique course units scraped from two public VVZ pages. Additional courses come from the saved plan.`;renderCatalogue();}catch{$('#catalog-count').textContent='Catalogue unavailable';$('#catalog-results').innerHTML='<div class="empty-results">Could not load the catalogue. You can still add a custom course.</div>';}
