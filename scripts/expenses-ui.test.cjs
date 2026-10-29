const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {webcrypto}=require('node:crypto');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const text=node=>node==null||typeof node==='boolean'?'':typeof node!=='object'?String(node):Array.isArray(node)?node.map(text).join(' '):text(node.props?.children);
class ExpenseRequestError extends Error{constructor(message,confirmedRejected){super(message);this.confirmedRejected=confirmedRejected;}}
function fixture(seed=null,denied=false){
    let index=0,dirty=true,tree,timerId=0;const hooks=[],effects=[],requests=[],storage=new Map(),timers=new Map(),downloads=[];
    if(seed)storage.set('expense-request-v1:owner',JSON.stringify(seed));
    const react={Fragment:'Fragment',createElement:(type,props,...children)=>({type,props:{...props,children}}),
        useState(initial){const i=index++;hooks[i] ||= {value:typeof initial==='function'?initial():initial};return[hooks[i].value,value=>{const next=typeof value==='function'?value(hooks[i].value):value;if(!Object.is(next,hooks[i].value)){hooks[i].value=next;dirty=true;}}];},
        useRef(initial){const i=index++;hooks[i] ||= {value:{current:initial}};return hooks[i].value;},
        useEffect(effect,deps){const i=index++;if(!hooks[i]||deps.some((value,j)=>!Object.is(value,hooks[i].deps[j]))){hooks[i]?.cleanup?.();hooks[i]={deps};effects.push(()=>{hooks[i].cleanup=effect();});}}};
    const call=(channel,input)=>new Promise((resolve,reject)=>requests.push({channel,input,resolve,reject}));
    const types={exports:{}};vm.runInNewContext(compile(fs.readFileSync('src/types/expenses.ts','utf8')),{module:types,exports:types.exports});
    const m={exports:{}};
    vm.runInNewContext(compile(fs.readFileSync('src/pages/Expenses.tsx','utf8')),{module:m,exports:m.exports,crypto:webcrypto,Date,Intl,Error,console,Blob,
        setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),URL:{createObjectURL:()=> 'blob:expense-test',revokeObjectURL(){}},document:{createElement:()=>{const a={click:()=>downloads.push(a.download)};return a;}},
        localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
        require(name){if(name==='react')return{__esModule:true,default:react,...react};if(name.endsWith('/authStore'))return{useAuthStore:selector=>selector({user:{id:'owner',role:denied?'CASHIER':'ADMIN',permManageCashDrawer:false,isActive:true}})};
            if(name.endsWith('/types/expenses'))return types.exports;
            if(name.endsWith('/expenses.service'))return{ExpenseRequestError,expensesService:Object.fromEntries(['list','detail','create','act','export'].map(key=>[key,input=>call(key,input)]))};
            if(name.endsWith('/Toast'))return{showToast(){}};for(const component of ['Modal','ConfirmDialog'])if(name.endsWith('/'+component))return{[component]:component};throw new Error(name);},
    });
    function render(){for(let n=0;dirty;n++){assert.ok(n<40);dirty=false;index=0;tree=m.exports.Expenses();effects.splice(0).forEach(effect=>effect());}}
    function all(){const nodes=[];function visit(node){if(!node||typeof node!=='object')return;if(Array.isArray(node))return node.forEach(visit);if(['Modal','ConfirmDialog'].includes(node.type)&&!node.props.isOpen)return;nodes.push(node);visit(node.props?.children);}visit(tree);return nodes;}
    const find=predicate=>{const node=all().find(predicate);assert.ok(node,'Expected expense UI element');return node;};
    function field(label){const node=find(n=>n.type==='label'&&n.props.children[0]===label);return node.props.children.find(n=>n&&typeof n==='object'&&['input','select'].includes(n.type));}
    render();return{requests,storage,downloads,all,find,field,text:()=>text(tree),button:label=>find(n=>n.type==='button'&&text(n)===label),latest:channel=>requests.filter(r=>r.channel===channel).at(-1),act(fn){const result=fn();render();return result;},change(label,value){const n=field(label);n.props.onChange({target:{value}});render();},runTimers(){const work=[...timers.values()];timers.clear();work.forEach(fn=>fn());render();},async settle(){for(let n=0;n<8;n++){await Promise.resolve();render();}}};
}
const empty={items:[],total:0,page:1,totals:{expensePaise:0,reviewPaise:0,reviewCount:0}};
test('expense page denies users without cash-register permission',()=>{const f=fixture(null,true);assert.match(f.text(),/permission is required/);assert.equal(f.requests.length,0);assert.equal(f.all().filter(n=>n.type==='input').length,0);});
test('reviewing a drawer row classifies its identity rather than creating a second payment',async()=>{
    const f=fixture();f.runTimers();f.latest('list').resolve({...empty,items:[{id:'drawer:tea',expenseDate:'2026-10-25',category:'OTHER',amountPaise:10000,note:'Tea',paymentSource:'CASH_DRAWER',status:'REVIEW',revision:0,drawerTxId:'tea'}],total:1,totals:{expensePaise:0,reviewPaise:10000,reviewCount:1}});await f.settle();
    f.act(()=>f.button('Review').props.onClick());f.change('Business category','REFRESHMENTS');f.change('Reason','Confirmed staff refreshments');
    f.act(()=>f.button('Review & confirm').props.onClick());const saving=f.act(()=>f.find(n=>n.type==='ConfirmDialog').props.onConfirm());
    const request=f.latest('act');assert.equal(request.input.id,'drawer:tea');assert.equal(request.input.expectedRevision,0);assert.equal(request.input.action,'CLASSIFY');assert.equal(request.input.category,'REFRESHMENTS');assert.equal(f.requests.some(r=>r.channel==='create'),false);
    request.reject(new ExpenseRequestError('Changed; reload',true));await saving;await f.settle();assert.equal(f.find(n=>n.type==='fieldset').props.disabled,false);
});
test('an uncertain expense save survives reload and retries the exact same operation',async()=>{
    const input={operationId:'stable-expense-request',date:'2026-10-25',category:'OTHER',amount:50,note:'Shop supplies',paymentSource:'CASH_DRAWER'};
    const f=fixture({kind:'CREATE',input});assert.equal(f.find(n=>n.type==='fieldset').props.disabled,true);assert.equal(f.button('Close').props.disabled,true);
    f.act(()=>f.button('Retry unchanged save').props.onClick());const first=f.act(()=>f.find(n=>n.type==='ConfirmDialog').props.onConfirm());
    f.latest('create').reject(new Error('Lost reply'));await first;await f.settle();assert.equal(JSON.parse(f.storage.get('expense-request-v1:owner')).input.operationId,input.operationId);
    f.act(()=>f.button('Retry unchanged save').props.onClick());const retry=f.act(()=>f.find(n=>n.type==='ConfirmDialog').props.onConfirm());const second=f.latest('create');assert.equal(JSON.stringify(second.input),JSON.stringify(input));
    second.resolve({id:'saved'});await f.settle();f.latest('list').resolve(empty);await retry;await f.settle();assert.equal(f.storage.has('expense-request-v1:owner'),false);
});
test('void confirmation explains cash reversal and normal expense confirmation names the payment source',async()=>{
    const row={id:'entry',expenseDate:'2026-10-25',category:'OTHER',amountPaise:5000,note:'Wrong expense',paymentSource:'CASH_DRAWER',status:'ACTIVE',revision:1,drawerTxId:'cash'};
    const f=fixture({kind:'ACTION',row,input:{operationId:'void-once',id:'entry',expectedRevision:1,action:'VOID',reason:'Never paid'}});
    f.act(()=>f.button('Retry unchanged action').props.onClick());const confirm=f.find(n=>n.type==='ConfirmDialog');assert.match(confirm.props.message,/equal reversing cash-in/);assert.match(confirm.props.message,/₹50/);
    const fresh=fixture();fresh.act(()=>fresh.button('Add expense').props.onClick());fresh.change('Amount (₹)','600');fresh.change('Paid from','UPI');fresh.change('Description / bill reference','Rent');fresh.act(()=>fresh.button('Review & save').props.onClick());assert.match(fresh.find(n=>n.type==='ConfirmDialog').props.message,/UPI/);assert.match(fresh.find(n=>n.type==='ConfirmDialog').props.message,/without changing drawer cash/);
});
test('CSV export uses the selected date range and status without issuing a write',async()=>{
    const f=fixture();f.change('From','2026-10-01');f.change('To','2026-10-25');f.change('Status','ACTIVE');
    const exporting=f.act(()=>f.button('Export CSV').props.onClick());const req=f.latest('export');assert.equal(req.input.from,'2026-10-01');assert.equal(req.input.to,'2026-10-25');assert.equal(req.input.status,'ACTIVE');
    req.resolve({csv:'Date,Amount\r\n2026-10-25,50.00',rowCount:1});await exporting;await f.settle();assert.deepEqual(f.downloads,['Zain_Expenses_2026-10-01_2026-10-25.csv']);assert.equal(f.requests.some(r=>['create','act'].includes(r.channel)),false);
});
