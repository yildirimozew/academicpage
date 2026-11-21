export const CATEGORIES={majorCore:'Major · core',majorElective:'Major · elective',minor:'Minor · Data Management',interfocus:'Interfocus',free:'Free elective',sip:'Science in Perspective',seminar:'Seminar',practical:'Practical work',thesis:"Master’s thesis"};
export const STATUSES={passed:'Passed',enrolled:'Enrolled',planned:'Planned',failed:'Failed'};
export const SEMESTERS=[{id:'2025W',name:'Autumn 2025'},{id:'2026S',name:'Spring 2026'},{id:'2026W',name:'Autumn 2026'},{id:'2027S',name:'Spring 2027'}];
export const SEED=[];
export function totals(courses,projected=false){
 const included=courses.filter(c=>c.status==='passed'||(projected&&['enrolled','planned'].includes(c.status)&&c.semester!=='unscheduled'));
 const sums=Object.fromEntries(Object.keys(CATEGORIES).map(k=>[k,0]));
 for(const c of included)sums[c.category]+=c.ects;
 const raw=Object.values(sums).reduce((a,b)=>a+b,0);
 const credited={...sums,practical:Math.min(sums.practical,10),sip:Math.min(sums.sip,6),seminar:Math.min(sums.seminar,2),thesis:Math.min(sums.thesis,30)};
 const total=Object.values(credited).reduce((a,b)=>a+b,0);
 const major=sums.majorCore+sums.majorElective;
 const coursesTotal=major+sums.minor+sums.interfocus+sums.free+credited.sip;
 const interfocusCount=new Set(included.filter(c=>c.category==='interfocus').map(c=>c.code||c.id)).size;
 const requirements=[
 {key:'major',label:'Major',detail:'Machine Intelligence',value:major,min:26},
 {key:'core',label:'Major core',detail:'Included in major',value:sums.majorCore,min:16},
 {key:'minor',label:'Minor',detail:'Data Management',value:sums.minor,min:18},
 {key:'interfocus',label:'Interfocus',detail:`${interfocusCount} of 2 courses`,value:sums.interfocus,min:16,extra:interfocusCount>=2},
 {key:'sip',label:'Science in Perspective',detail:'Maximum 6 ECTS',value:credited.sip,min:2},
 {key:'seminar',label:'Seminar',detail:'One seminar',value:credited.seminar,min:2},
 {key:'practical',label:'Practical work',detail:'Maximum 10 ECTS',value:credited.practical,min:8},
 {key:'thesis',label:'Master’s thesis',detail:'30 ECTS',value:credited.thesis,min:30}];
 for(const r of requirements)r.met=r.value>=r.min&&r.extra!==false;
 const warnings=[];
 if(sums.sip>6)warnings.push('Science in Perspective exceeds the 6 ECTS cap. Reassign eligible excess courses to free electives.');
 if(sums.practical>10)warnings.push('Practical work exceeds the 10 ECTS cap.');
 if(included.filter(c=>c.category==='seminar').length>1)warnings.push('Only one seminar can count toward the degree.');
 if(included.filter(c=>c.category==='thesis').length>1||sums.thesis>30)warnings.push('Only one 30 ECTS thesis can count toward the degree.');
 const complete=total>=120&&coursesTotal>=76&&requirements.every(r=>r.met)&&warnings.length===0;
 return{total,raw,sums,credited,major,coursesTotal,interfocusCount,requirements,warnings,complete};
}
export function gradingFor(course){
 return course.grading || (course.category==='practical'||course.code==='263-5059-00'||/^(pass|fail)$/i.test(String(course.grade).trim())?'passfail':'numeric');
}
function numericGrade(value){
 if(value==null||String(value).trim()==='')return null;
 const grade=Number(String(value).trim());
 return Number.isFinite(grade)&&grade>=4&&grade<=6?grade:null;
}
export function gpa(courses){
 let earnedPoints=0,earnedCredits=0,expectedPoints=0,expectedCredits=0,pendingCredits=0,missingEarned=0;
 for(const c of courses){
  if(gradingFor(c)==='passfail'||c.status==='failed')continue;
  if(c.status==='passed'){
   const grade=numericGrade(c.grade);
   if(grade===null){missingEarned+=c.ects;continue;}
   earnedPoints+=grade*c.ects;earnedCredits+=c.ects;
  }else if(['enrolled','planned'].includes(c.status)&&c.semester!=='unscheduled'){
   pendingCredits+=c.ects;
   const grade=numericGrade(c.expectedGrade);
   if(grade===null)continue;
   expectedPoints+=grade*c.ects;expectedCredits+=c.ects;
  }
 }
 const projectedCredits=earnedCredits+expectedCredits;
 return{current:earnedCredits?earnedPoints/earnedCredits:null,projected:projectedCredits?(earnedPoints+expectedPoints)/projectedCredits:null,earnedCredits,expectedCredits,pendingCredits,missingEarned};
}
export function categoriesFor(course){
 const paths=course.paths||[];const result=[];
 for(const p of paths){
  if(p.includes('Major in Machine Intelligence')){if(p.includes('Core Courses'))result.push('majorCore');else if(p.includes('Elective Courses'))result.push('majorElective');}
  if(p.includes('Minor in Data Management'))result.push('minor');
  if(p.some(x=>/Inter.?[Ff]ocus/.test(x)))result.push('interfocus');
  if(p.some(x=>/^Seminars?$/.test(x)))result.push('seminar');
  if(p.includes('Practical Work'))result.push('practical');
  if(p.includes("Master's Thesis"))result.push('thesis');
 }
 return [...new Set([...result,'free'])];
}
export function validateState(data){
 if(!data||data.version!==1||!Array.isArray(data.courses)||!Array.isArray(data.semesters)||data.courses.length>1000||data.semesters.length>40)throw Error('Choose a valid tracker JSON backup.');
 const ids=new Set();const sems=new Set(['unscheduled']);
 for(const s of data.semesters){if(!s||typeof s.id!=='string'||typeof s.name!=='string'||!s.id||sems.has(s.id))throw Error('Invalid or duplicate semester.');sems.add(s.id);}
 const codes=new Set();
 for(const c of data.courses){if(!c||typeof c.id!=='string'||!c.id||ids.has(c.id)||typeof c.title!=='string'||!c.title.trim()||c.title.length>300||typeof c.code!=='string'||!Number.isFinite(c.ects)||c.ects<=0||c.ects>60||!CATEGORIES[c.category]||!STATUSES[c.status]||!sems.has(c.semester))throw Error('Backup contains an invalid course.');if(c.grading!=null&&!['numeric','passfail'].includes(c.grading))throw Error('Invalid grading type.');if(c.expectedGrade!=null&&c.expectedGrade!==''&&numericGrade(c.expectedGrade)===null)throw Error('Expected grades must be between 4 and 6.');ids.add(c.id);if(c.code){if(codes.has(c.code))throw Error('Backup contains duplicate course numbers.');codes.add(c.code);}}
 return data;
}
