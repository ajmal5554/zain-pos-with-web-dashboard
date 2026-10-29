const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const {webcrypto} = require('node:crypto');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join(' ') : text(node.props?.children);
class PurchaseRequestError extends Error {constructor(message,confirmedRejected){super(message);this.confirmedRejected=confirmedRejected;}}
function fixture(seed, denied=false, componentName='Purchases', props={}) {
    let index=0,dirty=true,tree;
    const hooks=[],effects=[],timers=[],requests=[],storage=new Map();
    if(seed) storage.set(componentName==='PurchaseActions'?'purchase-action-v1:owner':'purchase-draft-v1:owner',JSON.stringify(seed));
    const react={Fragment:'Fragment',createElement:(type,props,...children)=>({type,props:{...props,children:children.length===1?children[0]:children}}),
        useState(initial){const i=index++;hooks[i] ||= {value:typeof initial==='function'?initial():initial};return[hooks[i].value,v=>{const next=typeof v==='function'?v(hooks[i].value):v;if(!Object.is(next,hooks[i].value)){hooks[i].value=next;dirty=true;}}];},
        useRef(initial){const i=index++;hooks[i] ||= {value:{current:initial}};return hooks[i].value;},
        useEffect(effect,deps){const i=index++;if(!hooks[i]||deps.some((v,j)=>!Object.is(v,hooks[i].deps[j]))){hooks[i]={deps};effects.push(effect);}},
    };
    const call=(channel,input)=>new Promise((resolve,reject)=>requests.push({channel,input,resolve,reject}));
    const m={exports:{}};
    vm.runInNewContext(compile(componentName==='PurchaseActions'?'src/components/purchases/PurchaseActions.tsx':'src/pages/Purchases.tsx'),{module:m,exports:m.exports,crypto:webcrypto,Date,Intl,Error,console,document:{body:{}},
        setTimeout:fn=>timers.push(fn),clearTimeout(){},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
        require(name){if(name==='react')return{__esModule:true,default:react,...react};if(name==='lucide-react')return{Truck:'Truck'};if(name==='react-dom')return{createPortal:node=>node};if(name.endsWith('/authStore'))return{useAuthStore:selector=>selector({user:{id:'owner',role:denied?'CASHIER':'ADMIN'}})};
            if(name.endsWith('/purchases.service'))return{PurchaseRequestError,purchasesService:Object.fromEntries(['list','items','detail','receive','pay','adjust','refund'].map(channel=>[channel,input=>call(channel,input)]))};
            if(name.endsWith('/PurchaseTaxFields'))return{PurchaseTaxFields:'PurchaseTaxFields',PurchaseTaxSummary:'PurchaseTaxSummary'};if(name.endsWith('/Toast'))return{showToast(){}};for(const component of ['ConfirmDialog','Modal','PurchaseActions'])if(name.endsWith('/'+component))return{[component]:component};throw new Error(name);},
    });
    function render(){for(let n=0;dirty;n++){assert.ok(n<40);dirty=false;index=0;tree=m.exports[componentName](props);effects.splice(0).forEach(e=>e());}}
    function all(){const nodes=[];function visit(n){if(!n||typeof n!=='object')return;if(Array.isArray(n))return n.forEach(visit);if(['Modal','ConfirmDialog'].includes(n.type)&&!n.props.isOpen)return;nodes.push(n);visit(n.props?.children);}visit(tree);return nodes;}
    const find=predicate=>{const node=all().find(predicate);assert.ok(node,'Expected UI element');return node;};
    render();
    return{all,find,requests,storage,render,button:label=>find(n=>n.type==='button'&&text(n)===label),act(fn){const result=fn();render();return result;},async settle(){for(let n=0;n<8;n++){await Promise.resolve();render();}},text:()=>text(tree)};
}
const seed={form:{operationId:'stable-operation',supplier:'Supplier',invoiceNumber:'A1',invoiceDate:'2026-10-01',batchName:'Batch',discount:0,charges:0,paid:0,paymentMode:'UPI',lines:[{variantId:'shirt',quantity:10,unitCost:450,sellingPrice:750,mrp:800,expectedSellingPrice:700,expectedMrp:700}]},options:[{id:'shirt',name:'Shirt',barcode:'123456',size:'XL'}],pending:true};
test('uncertain purchase freezes edits, survives reload and retries the exact operation',async()=>{
    const f=fixture(seed); f.act(()=>f.button('New purchase').props.onClick());
    assert.ok(f.text().includes('new barcode'));
    assert.equal(f.find(n=>n.type==='fieldset').props.disabled,true);
    assert.equal(f.button('Discard draft').props.disabled,true);
    f.act(()=>f.button('Retry saved request').props.onClick());
    const first=f.act(()=>f.find(n=>n.type==='ConfirmDialog').props.onConfirm());
    const req=f.requests.find(r=>r.channel==='receive'); assert.equal(req.input.operationId,'stable-operation');
    req.reject(new Error('Lost reply'));await first;await f.settle();
    assert.equal(JSON.parse(f.storage.get('purchase-draft-v1:owner')).pending,true);
    f.act(()=>f.button('Retry saved request').props.onClick());
    const retry=f.act(()=>f.find(n=>n.type==='ConfirmDialog').props.onConfirm());
    const second=f.requests.filter(r=>r.channel==='receive')[1];assert.deepEqual(second.input,req.input);
    second.reject(new PurchaseRequestError('Confirmed rollback',true));await retry;await f.settle();
    assert.equal(f.find(n=>n.type==='fieldset').props.disabled,false);
    assert.equal(JSON.parse(f.storage.get('purchase-draft-v1:owner')).pending,false);
});
test('purchase form is unavailable without cost and inventory permission',()=>{
    const f=fixture(null,true);assert.match(f.text(),/require inventory and cost-price permissions/);assert.equal(f.all().filter(n=>n.type==='input').length,0);
});
test('purchase bridge distinguishes a rejected operation from an uncertain response',async()=>{
    const m={exports:{}};let response={success:false,error:'Rejected'};
    const api={receive:async()=>response};
    vm.runInNewContext(compile('src/services/purchases.service.ts'),{module:m,exports:m.exports,window:{electronAPI:{purchases:api}}});
    await assert.rejects(m.exports.purchasesService.receive({}),e=>e.confirmedRejected===true);
    response={success:true};await assert.rejects(m.exports.purchasesService.receive({}),e=>e.confirmedRejected===false);
    api.receive=async()=>{throw new Error('Lost transport');};await assert.rejects(m.exports.purchasesService.receive({}),e=>e.confirmedRejected===false);
});

const invoice={id:'invoice',supplier:'Supplier',invoiceNumber:'A1',invoiceDate:'2026-10-01',batchName:'Delivery',discountPaise:0,chargesPaise:0,totalPaise:500000,creditDuePaise:100000,status:'ACTIVE',revision:2,
    payments:[],adjustments:[],
    lines:[{id:'line',name:'Shirt',barcode:'123456',size:'XL',quantity:10,returnedQuantity:2,stock:8,unitCostPaise:50000,landedTotalPaise:500000}]};
test('supplier return form sends selected quantity, agreed credit and invoice revision',async()=>{
    const f=fixture(null,false,'PurchaseActions',{detail:invoice,onBlockedChange(){},onSaved:async()=>{}});
    f.act(()=>f.button('Return goods').props.onClick());
    f.act(()=>f.find(n=>n.props['aria-label']==='Action quantity 123456').props.onChange({target:{value:'2'}}));
    const credit=f.find(n=>n.type==='input'&&n.props.max===5000);assert.equal(credit.props.value,1000);
    f.act(()=>f.find(n=>n.type==='input'&&n.props.maxLength===500).props.onChange({target:{value:'CN-12 damaged goods'}}));
    f.act(()=>f.button('Review & confirm').props.onClick());
    const saving=f.act(()=>f.find(n=>n.type==='ConfirmDialog').props.onConfirm());
    const req=f.requests.find(r=>r.channel==='adjust');assert.equal(req.input.kind,'RETURN');assert.equal(req.input.credit,1000);assert.equal(req.input.expectedRevision,2);assert.equal(req.input.lines[0].quantity,2);
    req.reject(new PurchaseRequestError('Not enough stock',true));await saving;await f.settle();
    assert.equal(f.find(n=>n.type==='fieldset').props.disabled,false);
});
test('unconfirmed supplier adjustment survives reload and retries the same request',async()=>{
    const request={operationId:'return-once',purchaseId:'invoice',expectedRevision:2,kind:'RETURN',reason:'CN-12',credit:1000,lines:[{lineId:'line',quantity:2}]};
    const pending={kind:'RETURN',invoice,reason:'CN-12',credit:1000,mode:'UPI',lines:[{lineId:'line',quantity:2,unitCost:500}],request};
    const f=fixture(pending,false,'PurchaseActions',{detail:invoice,onBlockedChange(){},onSaved:async()=>{}});
    assert.equal(f.find(n=>n.type==='fieldset').props.disabled,true);
    f.act(()=>f.button('Retry unchanged request').props.onClick());const saving=f.act(()=>f.find(n=>n.type==='ConfirmDialog').props.onConfirm());
    const req=f.requests.find(r=>r.channel==='adjust');assert.equal(JSON.stringify(req.input),JSON.stringify(request));
    req.reject(new Error('Lost response'));await saving;await f.settle();
    assert.equal(JSON.parse(f.storage.get('purchase-action-v1:owner')).request.operationId,'return-once');
    assert.equal(f.button('Close').props.disabled,true);
});
test('supplier refund is a distinct confirmed action with a positive amount and destination',async()=>{
    const f=fixture(null,false,'PurchaseActions',{detail:invoice,onBlockedChange(){},onSaved:async()=>{}});
    f.act(()=>f.button('Record refund received').props.onClick());
    f.act(()=>f.find(n=>n.type==='input'&&n.props.maxLength===500).props.onChange({target:{value:'Bank reference 20'}}));
    f.act(()=>f.button('Review & confirm').props.onClick());const saving=f.act(()=>f.find(n=>n.type==='ConfirmDialog').props.onConfirm());
    const req=f.requests.find(r=>r.channel==='refund');assert.equal(req.input.amount,1000);assert.equal(req.input.mode,'UPI');
    req.resolve({id:'invoice'});await saving;await f.settle();assert.equal(f.storage.has('purchase-action-v1:owner'),false);
});
test('invoice correction submits replacement quantities and costs with an audit reason',async()=>{
    const f=fixture(null,false,'PurchaseActions',{detail:invoice,onBlockedChange(){},onSaved:async()=>{}});
    f.act(()=>f.button('Correct invoice').props.onClick());
    f.act(()=>f.find(n=>n.props['aria-label']==='Action quantity 123456').props.onChange({target:{value:'8'}}));
    f.act(()=>f.find(n=>n.props['aria-label']==='Correct cost 123456').props.onChange({target:{value:'480'}}));
    f.act(()=>f.find(n=>n.type==='input'&&n.props.maxLength===500).props.onChange({target:{value:'Correct entry from supplier invoice'}}));
    f.act(()=>f.button('Review & confirm').props.onClick());const saving=f.act(()=>f.find(n=>n.type==='ConfirmDialog').props.onConfirm());
    const req=f.requests.find(r=>r.channel==='adjust');assert.equal(req.input.kind,'CORRECTION');assert.equal(req.input.lines[0].quantity,8);assert.equal(req.input.lines[0].unitCost,480);assert.equal(req.input.supplier,'Supplier');
    req.resolve({id:'invoice'});await saving;await f.settle();assert.equal(f.storage.has('purchase-action-v1:owner'),false);
});


test('GST draft totals and saved request include signed round-off without assuming ITC',async()=>{
 const tax={supplierGstin:'',cgst:112.5,sgst:112.5,igst:0,roundOff:-0.1,itcStatus:'PENDING'};
 const f=fixture({...seed,form:{...seed.form,tax},pending:false});f.act(()=>f.button('New purchase').props.onClick());
 assert.match(f.text(),/Rate before GST/);assert.match(f.text(),/4,724.90/);
 f.act(()=>f.button('Save purchase & receive stock').props.onClick());assert.equal(f.find(n=>n.type==='fieldset').props.disabled,true);
 const saving=f.act(()=>f.find(n=>n.type==='ConfirmDialog').props.onConfirm());const req=f.requests.find(r=>r.channel==='receive');assert.equal(req.input.tax.itcStatus,'PENDING');assert.equal(req.input.tax.roundOff,-.1);
 req.reject(new Error('Lost response'));await saving;await f.settle();
 assert.equal(JSON.parse(f.storage.get('purchase-draft-v1:owner')).form.tax.cgst,112.5);assert.equal(f.find(n=>n.type==='fieldset').props.disabled,true);
});

test('invoice correction retains separate GST in its request and confirmation total',async()=>{
 const detail={...invoice,tax:{supplierGstin:'',cgstPaise:2500,sgstPaise:2500,igstPaise:0,roundOffPaise:-10,taxablePaise:500000,totalTaxPaise:5000,itcStatus:'PENDING'}};
 const f=fixture(null,false,'PurchaseActions',{detail,onBlockedChange(){},onSaved:async()=>{}});f.act(()=>f.button('Correct invoice').props.onClick());
 f.act(()=>f.find(n=>n.type==='input'&&n.props.maxLength===500).props.onChange({target:{value:'GST correction'}}));f.act(()=>f.button('Review & confirm').props.onClick());
 const saving=f.act(()=>f.find(n=>n.type==='ConfirmDialog').props.onConfirm());const req=f.requests.find(r=>r.channel==='adjust');assert.equal(req.input.tax.cgst,25);assert.equal(req.input.tax.roundOff,-.1);assert.equal(req.input.tax.itcStatus,'PENDING');req.resolve({id:invoice.id});await saving;await f.settle();
});
