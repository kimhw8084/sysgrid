import { test, expect, Page } from '@playwright/test'
import { projectsRootPreviewPolicy } from './helpers/projects-root-preview'
const sizes=[[390,844],[430,932],[768,1024],[1024,768],[1280,720],[1440,900],[1920,1080],[2560,1440]]
const INTERACTION_BUDGET_MS=1200
function fixture() {
 const day=86400000,base=Math.floor(Date.now()/day)-14,iso=(n:number)=>new Date(n*day).toISOString().slice(0,10)
 const tasks=Array.from({length:120},(_,i)=>({id:1001+i,name:`Visual task ${i+1}`,status:i%5===4?'Done':'In Progress',progress:20,priority:'Medium',owner:'Planner',start_date:iso(base+i*2),end_date:iso(base+i*2+(i===1?7:2)),order_index:(i+1)*10,dependencies_json:i?[{id:String(1000+i),type:['FS','SS','FF','SF'][i%4],lag_days:0}]:[],metadata_json:i===0?{milestone:true}:i===2?{wbs_parent_id:1002}:{}}))
 return {id:901,name:'Visual repair acceptance',status:'In Progress',priority:'Medium',owner:'Planner',start_date:iso(base),end_date:iso(base+245),metadata_json:{adoption_state:'Pilot'},tasks}
}
async function setup(page:Page){
 let project:any=fixture();const puts:any[]=[];const errors:string[]=[];const previews=new Map<string,any>()
 page.on('pageerror',e=>errors.push(e.message))
 await page.context().routeWebSocket('**/*',s=>s.close())
 await page.addInitScript(()=>{localStorage.setItem('sysgrid-theme','nordic-frost-v1');localStorage.setItem('SYSGRID_USER_ID','proof_operator')})
 const story=()=>({health:{level:'On track',reason:'Visual repair fixture'},delivery:{percent:50,label:'50%',method:'Canonical task progress'},next_milestone:null,milestones:[],attention:[],attention_count:0,acceptance_criteria:[],primary_metric:null,latest_update:null,governance:[],architecture:{assessment:'Not assessed'},resources:[],freshness:{updated_at:'2026-09-01T00:00:00Z',source:'visual-repair-fixture'},coverage:{resources:'complete'}})
 const canonical=()=>({id:'901',display_key:'PRJ-901',tenant_id:1,name:project.name,objective:'One connected, modern planning surface',owner_id:'proof_operator',team_id:1,phase:'Executing',run_state:'Active',priority:'High',architecture_assessment:'Not assessed',target_date:project.end_date,outcome_phase:'Planned',outcome_result:'Unassessed',revision:1,graph_revision:1,capabilities:{view:true,edit:true,export:true,transition:true},story:story()})
 const work=()=>({project_id:'901',project_revision:1,graph_revision:1,items:project.tasks.map((task:any,index:number)=>({id:String(task.id),title:task.name,owner_id:task.owner,parent_task_id:task.metadata_json?.wbs_parent_id?String(task.metadata_json.wbs_parent_id):null,status:task.status==='Done'?'Done':task.status==='Blocked'?'Blocked':task.status==='Review'?'Review':index%4===0?'To Do':'In progress',progress:task.progress,start_date:task.start_date,end_date:task.end_date,order_key:String(task.order_index),revision:1})),blockers:[],source_revisions:{project_revision:1,graph_revision:1},capabilities:{view:true,edit:true,transition:true}})
 const schedule=()=>({project:canonical(),project_id:'901',project_revision:1,graph_revision:1,calendar:{id:'visual-calendar',timezone:'UTC',working_weekdays:[0,1,2,3,4,5,6],exceptions:[],revision:1},tasks:project.tasks.map((task:any,index:number)=>({id:String(task.id),title:task.name,kind:task.metadata_json?.milestone?'Milestone':'Task',owner_id:task.owner,parent_task_id:task.metadata_json?.wbs_parent_id?String(task.metadata_json.wbs_parent_id):null,metadata_json:{...task.metadata_json,is_milestone:Boolean(task.metadata_json?.milestone)},status:task.status,progress:task.progress,order_key:String(task.order_index || (index+1)*10),start_date:task.start_date,end_date:task.end_date,point_date:task.metadata_json?.milestone?task.start_date:null,revision:1})),dependencies:project.tasks.flatMap((task:any)=> (task.dependencies_json||[]).map((dep:any,index:number)=>({id:`edge-${task.id}-${index}`,predecessor_id:String(dep.id),successor_id:String(task.id),dependency_type:dep.type,lag_days:dep.lag_days||0,active:true,revision:1}))),external_dependencies:[],baselines:[],baseline_variance:[],analysis:{rows:[],critical_task_ids:[],status:'Complete'},forecast:{tasks:[],coverage:'complete'},external_warnings:[],history:[]})
 await page.route('**/api/v2/**',async route=>{
  const r=route.request(),p=new URL(r.url()).pathname,m=r.method();const json=(value:any)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)})
  if(m==='GET'&&p==='/api/v2/projects')return json({items:[{...canonical(),story:story()}],summary:{Executing:1},as_of:'2026-09-01T00:00:00Z',source_revision:'visual-repair-fixture',coverage:{projects:'complete'},next_cursor:null})
  if(m==='GET'&&p==='/api/v2/projects/901')return json(canonical())
  if(m==='GET'&&p==='/api/v2/focus')return json({scope:'project',project_id:'901',items:[],total:0,engine_version:'pv-focus-1'})
  if(m==='GET'&&p==='/api/v2/projects/901/work')return json(work())
  if(m==='GET'&&p==='/api/v2/projects/901/schedule')return json(schedule())
  if(m==='POST'&&p==='/api/v2/projects/901/schedule/preview'){
   const body=r.postDataJSON?.()||{},delta=Number(body.parameters?.delta_workdays||1),selected=(body.selection_ids||[]).map(String),changes=selected.map((id:string)=>{const task=project.tasks.find((item:any)=>String(item.id)===id);if(!task)return null;const before={start_date:task.start_date,end_date:task.end_date};const after={start_date:task.start_date,end_date:task.end_date};const shift=(value:string)=>new Date(Date.parse(value)+delta*86400000).toISOString().slice(0,10);if(body.operation==='resize')after.end_date=shift(task.end_date);else {after.start_date=shift(task.start_date);after.end_date=shift(task.end_date)}return {task_id:id,before,after,delta_workdays:delta,explanation_chain:[{kind:'direct-edit'}]}}).filter(Boolean);const preview={preview_id:`preview-${Date.now()}-${Math.random()}`,content_hash:'f'.repeat(64),base_graph_revision:1,calendar_revision:1,expires_at:new Date(Date.now()+60000).toISOString(),changes,failures:[]};previews.set(preview.preview_id,preview);return json(preview)
  }
  if(m==='POST'&&p==='/api/v2/projects/901/commands'){const body=r.postDataJSON?.()||{};puts.push(body);if(body.type==='schedule.apply'){const preview=previews.get(body.payload?.preview_id);for(const change of preview?.changes||[]){const task=project.tasks.find((item:any)=>String(item.id)===String(change.task_id));if(task)Object.assign(task,change.after)}};return json({status:'applied',event_id:`event-${puts.length}`})}
  return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({detail:'Unexpected visual-repair v2 request'})})
 })
 await page.route('**/api/v1/**',async route=>{
  const r=route.request(),p=new URL(r.url()).pathname,m=r.method();let data:any=[]
  if(m==='PUT' && p==='/api/v1/projects/901'){const value=r.postDataJSON();puts.push(value);project={...project,...value,id:901};data=project}
  else if(!['GET','HEAD','OPTIONS'].includes(m))return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({detail:'Test blocked a non-Project write'})})
  else if(p==='/api/v1/policy/module-availability')data=projectsRootPreviewPolicy
  else if(p==='/api/v1/projects')data=[project]
  else if(p==='/api/v1/projects/901')data=project
  else if(p.endsWith('/settings/bootstrap'))data={VITE_API_BASE_URL:new URL(r.url()).origin,DEFAULT_USER_ID:'proof_operator'}
  else if(p.endsWith('/settings/user/profile'))data={id:'proof_operator',username:'proof_operator',full_name:'Proof Operator',team:'Operations',team_id:1,is_admin:true,permissions:{all:3,projects:3}}
  else if(p.endsWith('/settings/user/settings'))data={theme:'nordic-frost-v1'}
  else if(p.endsWith('/settings/operators'))data=[{id:1,username:'proof_operator',full_name:'Proof Operator',team_id:1}]
  else if(p.includes('/workspaces/')&&p.endsWith('/views'))data={views:[]}
  else if(p.endsWith('/health'))data={status:'ok'}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)})
 })
 await page.goto('/projects?id=901&view=timeline')
 await expect(page.locator('[data-project-modern-gantt]')).toBeVisible()
 return {puts,errors,getProject:()=>project}
}
async function target(el:any){const p=await el.evaluate((e:HTMLElement)=>{const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return {x,y,width:r.width,height:r.height,owns:h===e||e.contains(h),hit:h?.getAttribute('data-project-resize-edge')||h?.tagName,inside:x>=0&&x<innerWidth&&y>=0&&y<innerHeight}});expect(p.owns&&p.inside,JSON.stringify(p)).toBe(true);return p}
for(const [width,height] of sizes)test(`usable real workspace ${width}x${height}`,async({page},info)=>{
 await page.setViewportSize({width,height});const state=await setup(page)
 await expect(page.locator('[data-project-modern-gantt]')).toHaveCount(1)
 await expect(page.locator('[data-project-legacy-gantt-hidden]')).toHaveCount(0)
 expect(await page.locator('[data-project-modern-gantt]').evaluate(e=>!!e.closest('[data-workspace="projects"]'))).toBe(true)
 const s=page.locator('[data-project-timeline-scrollport]');expect(await s.evaluate(e=>e.clientHeight)).toBeGreaterThanOrEqual(160)
 const first=page.locator('[data-project-timeline-bar][data-task-id="1001"]');const hit=await target(first)
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true)
 await info.attach('real-workspace',{body:await page.screenshot(),contentType:'image/png'})
 await info.attach('hit-target',{body:JSON.stringify(hit),contentType:'application/json'})
 expect(state.puts).toHaveLength(0);expect(state.errors).toEqual([])
})
test('move, connected preview, cancellation, and history at the formerly failing 1280 viewport',async({page},info)=>{
 const s=await setup(page);const bar=page.locator('[data-project-timeline-bar][data-task-id="1002"]');let p=await target(bar)
 const before=s.getProject().tasks.find((t:any)=>t.id===1002).start_date
 await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+36,p.y,{steps:8});await page.waitForTimeout(60)
 await info.attach('during-move',{body:await page.screenshot(),contentType:'image/png'});await page.mouse.up()
 await expect.poll(()=>s.puts.length).toBe(1);expect(s.getProject().tasks.find((t:any)=>t.id===1002).start_date).not.toBe(before)
 await page.getByRole('button',{name:'Undo Timeline change',exact:true}).click();await expect.poll(()=>s.puts.length).toBe(2)
 await page.getByRole('button',{name:'Redo Timeline change',exact:true}).click();await expect.poll(()=>s.puts.length).toBe(3)
 p=await target(bar);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+36,p.y,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();await page.waitForTimeout(150)
 expect(s.puts).toHaveLength(3);expect(s.errors).toEqual([])
})
test('Fit and short-bar date actions; connector inspection is not deletion',async({page})=>{
 const s=await setup(page);await page.getByRole('button',{name:'Fit',exact:true}).click()
 const scroller=page.locator('[data-project-timeline-scrollport]');await expect.poll(()=>scroller.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1)
 await page.getByLabel('Timeline zoom',{exact:true}).selectOption('quarter');await scroller.evaluate(e=>{e.scrollLeft=0})
 const bar=page.locator('[data-project-timeline-bar][data-task-id="1002"]');const hit=await target(bar);expect(hit.hit).not.toBe('end');expect(await bar.locator('[data-project-resize-edge]').count()).toBe(0)
 await bar.click();await page.getByRole('button',{name:'Move finish later Visual task 2',exact:true}).click();await expect.poll(()=>s.puts.length).toBe(1)
 const link=page.locator('[data-project-timeline-dependency-connector]').first();await link.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog',{name:'Dependency details',exact:true})).toBeVisible();expect(s.puts).toHaveLength(1)
 await page.getByRole('button',{name:'Remove dependency',exact:true}).click();await expect.poll(()=>s.puts.length).toBe(2);expect(s.errors).toEqual([])
})
test('wide resize and bounded realized DOM after scroll',async({page})=>{
 const s=await setup(page);await page.getByLabel('Timeline zoom',{exact:true}).selectOption('day')
 const appSidebar=page.locator('[data-sg-app-sidebar]');const sidebarWidth0=await appSidebar.evaluate((e:HTMLElement)=>e.getBoundingClientRect().width);await page.waitForTimeout(80);const sidebarWidth1=await appSidebar.evaluate((e:HTMLElement)=>e.getBoundingClientRect().width);expect(Math.abs(sidebarWidth1-sidebarWidth0),'Projects app sidebar must be stable before canvas gestures').toBeLessThan(0.5)
 const scroll=page.locator('[data-project-timeline-scrollport]');await scroll.evaluate(e=>{e.scrollLeft=0})
 const edge=page.locator('[data-project-timeline-bar][data-task-id="1002"] [data-project-resize-edge="end"]');const p=await target(edge);expect(p.width).toBeGreaterThanOrEqual(40);expect(p.height).toBeGreaterThanOrEqual(40)
 await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+28,p.y,{steps:6});await page.mouse.up();await expect.poll(()=>s.puts.length).toBe(1)
 await scroll.evaluate(e=>{e.scrollTop=4000;e.scrollLeft=1200});await page.waitForTimeout(100)
 expect(await page.locator('[data-project-timeline-row]').count()).toBeLessThanOrEqual(40)
 expect(await page.locator('[data-project-timeline-dependency-connector]').count()).toBeLessThanOrEqual(80)
 expect(await page.locator('[data-project-timeline-tick],[data-project-timeline-grid]').count()).toBeLessThanOrEqual(64)
 expect(s.puts).toHaveLength(1);expect(s.errors).toEqual([])
})

test('virtual WBS semantics and keyboard schedule parity stay bounded',async({page},info)=>{
 const s=await setup(page)
 const tree=page.getByRole('treegrid',{name:'Project WBS timeline tasks',exact:true});await expect(tree).toHaveAttribute('aria-rowcount','121') // 120 data rows plus the indexed column-header row.
 const parent=page.locator('[data-project-timeline-row][data-task-id="1002"]');await expect(parent).toHaveAttribute('role','row');await expect(parent).toHaveAttribute('aria-level','1');await expect(parent).toHaveAttribute('aria-rowindex','3');await expect(parent).toHaveAttribute('aria-expanded','true')
 const child=page.locator('[data-project-timeline-row][data-task-id="1003"]');await expect(child).toHaveAttribute('aria-level','2')
 await parent.getByRole('button',{name:'Collapse Visual task 2',exact:true}).click();await expect(parent).toHaveAttribute('aria-expanded','false');await expect(child).toHaveCount(0)
 await parent.getByRole('button',{name:'Expand Visual task 2',exact:true}).click();await expect(parent).toHaveAttribute('aria-expanded','true')
 const bar=page.locator('[data-project-timeline-bar][data-task-id="1002"]');const before=s.getProject().tasks.find((t:any)=>t.id===1002);const start0=before.start_date,end0=before.end_date
 await bar.focus();const moveStarted=Date.now();await page.keyboard.press('ArrowRight');await expect.poll(()=>s.puts.length).toBe(1);const moveMs=Date.now()-moveStarted
 expect(moveMs).toBeLessThan(INTERACTION_BUDGET_MS);const moved=s.getProject().tasks.find((t:any)=>t.id===1002);expect(moved.start_date).not.toBe(start0);expect(moved.end_date).not.toBe(end0);await expect(bar).toBeFocused();await expect(page.locator('[data-project-timeline-live-status]')).toContainText('moved +1 working day')
 const edge=bar.locator('[data-project-resize-edge="end"]');await edge.focus();const resizedBefore=s.getProject().tasks.find((t:any)=>t.id===1002).end_date;const resizeStarted=Date.now();await page.keyboard.press('ArrowRight');await expect.poll(()=>s.puts.length).toBe(2);const resizeMs=Date.now()-resizeStarted
 expect(resizeMs).toBeLessThan(INTERACTION_BUDGET_MS);expect(s.getProject().tasks.find((t:any)=>t.id===1002).end_date).not.toBe(resizedBefore);await expect(edge).toBeFocused();await expect(page.locator('[data-project-timeline-live-status]')).toContainText('resized +1 working day')
 const link=page.locator('[data-project-timeline-dependency-connector]').first();expect(await link.evaluate((e:SVGPathElement)=>parseFloat(getComputedStyle(e).strokeWidth))).toBeGreaterThanOrEqual(40)
 await info.attach('keyboard-performance',{body:JSON.stringify({budgetMs:INTERACTION_BUDGET_MS,moveMs,resizeMs,puts:s.puts.length},null,2),contentType:'application/json'})
 expect(await page.locator('[data-project-timeline-row]').count()).toBeLessThanOrEqual(40);expect(s.errors).toEqual([])
})
test('Board and Work preserve status meaning and working space',async({page},info)=>{
 const state=await setup(page);await page.goto('/projects/901/work?layout=board')
 await expect(page.locator('[data-workspace="projects"] .p05-board')).toBeVisible();await expect(page.getByRole('heading',{name:'To Do',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Done',exact:true})).toBeVisible()
 await expect(page.getByText('Unknown lifecycle',{exact:true})).not.toBeVisible()
 await info.attach('board',{body:await page.screenshot(),contentType:'image/png'})
 await page.goto('/projects/901/work')
 await expect(page.getByRole('treegrid',{name:'Project work breakdown'})).toBeVisible()
 await expect(page.getByText('Work',{exact:true}).first()).toBeVisible()
 await info.attach('work-list',{body:await page.screenshot(),contentType:'image/png'})
 expect(state.puts).toHaveLength(0);expect(state.errors).toEqual([])
})
test('phone menu keeps focus contained and returns it on Escape',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page)
 const toggle=page.getByRole('button',{name:'Open application navigation',exact:true});await toggle.click()
 await expect.poll(()=>page.locator('[data-sg-app-main]').evaluate((e:HTMLElement)=>e.inert)).toBe(true)
 await page.keyboard.press('Escape');await expect(toggle).toBeFocused()
 await expect.poll(()=>page.locator('[data-sg-app-main]').evaluate((e:HTMLElement)=>e.inert)).toBe(false)
})

// R4 regression: first-frame dimensions, not a sleep-until-the-animation-finishes test.
test('Projects sidebar has final geometry on first frame and breakpoint changes', async ({page}, info) => {
 await page.setViewportSize({width:1280,height:720})
 await page.addInitScript(() => {
  const state = {samples: [] as any[]}; (window as any).__sgSidebarFrames = state
  let seen = 0, attempts = 0
  const sample = () => {
   const sidebar = document.querySelector<HTMLElement>('[data-sg-projects-app="true"] [data-sg-app-sidebar]')
   if (sidebar) {
    const r=sidebar.getBoundingClientRect(),style=getComputedStyle(sidebar)
    const wanted=innerWidth<768?260:sidebar.dataset.sgNavOpen==='true'?240:80
    state.samples.push({time:performance.now(),viewport:innerWidth,width:r.width,wanted,inlineWidth:sidebar.style.width,transition:style.transitionProperty,open:sidebar.dataset.sgNavOpen})
    seen++
   }
   if (seen<24 && attempts++<600) requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)
 })
 const state=await setup(page)
 await expect.poll(()=>page.evaluate(()=>(window as any).__sgSidebarFrames.samples.length)).toBeGreaterThanOrEqual(12)
 const first=await page.evaluate(()=>(window as any).__sgSidebarFrames.samples)
 await info.attach('sidebar-first-frames',{body:JSON.stringify(first,null,2),contentType:'application/json'})
 expect(first.length).toBeGreaterThanOrEqual(12)
 for(const sample of first)expect(Math.abs(sample.width-sample.wanted),JSON.stringify(sample)).toBeLessThan(0.5)
 const geometry=[]
 for(const width of [1440,1280,768,390,1024]) {
  await page.setViewportSize({width,height:900})
  const samples=await page.evaluate(async()=>{
   const values=[]
   for(let i=0;i<8;i++){
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const e=document.querySelector<HTMLElement>('[data-sg-app-sidebar]')!
    const wanted=innerWidth<768?260:e.dataset.sgNavOpen==='true'?240:80
    values.push({viewport:innerWidth,width:e.getBoundingClientRect().width,wanted,open:e.dataset.sgNavOpen})
   }
   return values
  })
  geometry.push(...samples)
 }
 await info.attach('sidebar-breakpoint-frames',{body:JSON.stringify(geometry,null,2),contentType:'application/json'})
 for(const sample of geometry)expect(Math.abs(sample.width-sample.wanted),JSON.stringify(sample)).toBeLessThan(0.5)
 expect(state.puts).toHaveLength(0);expect(state.errors).toEqual([])
})
