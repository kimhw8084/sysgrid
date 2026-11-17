// DOM interaction test for the offline guide's own event handlers; not browser visual QA.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '..', 'PILOT_OWNER_GUIDE.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1, 'expected one self-contained inline script');

class Element {
  constructor(id = '') { this.id=id; this.value=''; this.textContent=''; this.handlers={}; this.download=''; this.href=''; this.selected=false; this.children=[]; }
  addEventListener(name, fn) { this.handlers[name]=fn; }
  fire(name) { if (this.handlers[name]) return this.handlers[name]({target:this}); }
  focus() { this.focused=true; }
  select() { this.selected=true; }
  click() { this.clicked=true; }
  remove() { this.removed=true; }
  appendChild(x) { this.children.push(x); }
}

(async () => {
  const map = Object.fromEntries(['client','project','feedback','generated','message','copy','saveText','saveJson'].map(id=>[id,new Element(id)]));
  const downloads=[]; let copied=''; let execCopy=false;
  const document={getElementById:id=>map[id],createElement:()=>{const e=new Element('a');downloads.push(e);return e;},body:{appendChild(){}},execCommand:()=>{execCopy=true;return true;}};
  const local = new Map();
  const context={document,navigator:{clipboard:{writeText:async value=>{copied=value;}}},localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v)},Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},console};
  vm.runInNewContext(scripts[0][1],context,{timeout:1000});
  assert.match(map.generated.value,/Codex/);
  map.client.value='opencode'; map.project.value='/tmp/pilot'; map.feedback.value='keep the scope small';
  map.project.fire('input');
  assert.match(map.generated.value,/OpenCode/);
  assert.match(map.generated.value,/\/tmp\/pilot/);
  assert.match(map.generated.value,/keep the scope small/);
  map.copy.fire('click'); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(copied,map.generated.value);
  assert.match(map.message.textContent,/copied/i);
  context.navigator.clipboard=undefined;
  map.copy.fire('click');
  assert.equal(map.generated.selected,true);
  assert.equal(execCopy,true);
  assert.match(map.message.textContent,/fallback/i);
  map.saveText.fire('click'); map.saveJson.fire('click');
  assert.deepEqual(downloads.map(x=>x.download),['golden-uiux-next-prompt.txt','golden-uiux-pilot-setup.json']);
  assert.ok(local.size>0,'owner guide should persist selections locally');
  console.log(JSON.stringify({status:'PASS',checks:['prompt generation','input updates','local persistence','clipboard','selection-copy fallback','text export','JSON export'],visual_browser_qa:'NOT_RUN'}));
})().catch(error=>{console.error(error);process.exitCode=1;});
