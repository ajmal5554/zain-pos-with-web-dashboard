const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const text=node=>node==null||typeof node==='boolean'?'':typeof node!=='object'?String(node):Array.isArray(node)?node.map(text).join(' '):text(node.props?.children);
function fixture(initialUser={id:'owner',role:'ADMIN'}){
    let index=0,dirty=true,tree,user=initialUser,version='v1';const hooks=[],effects=[],requests=[];
    const react={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'Fragment',
        useState(value){const i=index++;hooks[i] ||= {value:typeof value==='function'?value():value};return [hooks[i].value,next=>{const value=typeof next==='function'?next(hooks[i].value):next;if(!Object.is(value,hooks[i].value)){hooks[i].value=value;dirty=true;}}];},
        useEffect(effect,deps){const i=index++;if(!hooks[i]||deps.some((value,j)=>!Object.is(value,hooks[i].deps[j]))){hooks[i]?.cleanup?.();hooks[i]={deps};effects.push(()=>{hooks[i].cleanup=effect();});}}};
    const m={exports:{}};
    vm.runInNewContext(compile(fs.readFileSync('src/components/sales/SaleCostSummary.tsx','utf8')),{module:m,exports:m.exports,Error,window:{electronAPI:{saleCosts:{get:saleId=>new Promise((resolve,reject)=>requests.push({saleId,resolve,reject}))}}},
        require:name=>name==='react'?{__esModule:true,default:react,...react}:name.endsWith('/authStore')?{useAuthStore:selector=>selector({user})}:(()=>{throw new Error(name);})()});
    function render(){for(let n=0;dirty;n++){assert.ok(n<30);index=0;dirty=false;tree=m.exports.SaleCostSummary({saleId:'sale',version});effects.splice(0).forEach(effect=>effect());}}
    render();return {requests,text:()=>text(tree),setUser(next){user=next;dirty=true;render();},setVersion(next){version=next;dirty=true;render();},async settle(){for(let n=0;n<6;n++){await Promise.resolve();render();}},retry(){const visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){for(const n of node){const found=visit(n);if(found)return found;}return;}if(node.type==='button')return node;return visit(node.props?.children);};visit(tree).props.onClick();render();}};
}
const summary={status:'CAPTURED',knownCostPaise:45000,unknownQuantity:0,heldCostPaise:0,heldUnknownQuantity:0};
test('Sales cost panel shows captured costs and refreshes after the invoice changes',async()=>{
    const f=fixture();assert.equal(f.requests.length,1);f.requests[0].resolve({success:true,data:summary});await f.settle();assert.match(f.text(),/₹450/);
    f.setVersion('v2');assert.equal(f.requests.length,2);assert.equal(f.text().includes('₹450'),false);
    f.requests[1].resolve({success:true,data:{...summary,knownCostPaise:48000}});await f.settle();assert.match(f.text(),/₹480/);
});
test('unknown and historical costs say profit unavailable, with held losses separate',async()=>{
    const f=fixture();f.requests[0].resolve({success:true,data:{...summary,status:'UNKNOWN_COST',unknownQuantity:2,heldCostPaise:45000}});await f.settle();
    assert.match(f.text(),/Profit unavailable/);assert.match(f.text(),/Known portion only/);assert.match(f.text(),/Held returns are outside saleable stock/);
    f.setVersion('v2');f.requests[1].resolve({success:true,data:{...summary,status:'NOT_CAPTURED',knownCostPaise:0}});await f.settle();assert.match(f.text(),/earlier sale/);assert.equal(f.text().includes('₹0'),false);
});
test('cashiers cannot request or see costs, and permission revocation hides an outstanding response',async()=>{
    const f=fixture({id:'cashier',role:'CASHIER',permViewSales:true,permViewCostPrice:false});assert.equal(f.requests.length,0);assert.equal(f.text(),'');
    f.setUser({id:'cashier',role:'CASHIER',permViewSales:true,permViewCostPrice:true});assert.equal(f.requests.length,1);
    f.setUser({id:'cashier',role:'CASHIER',permViewSales:true,permViewCostPrice:false});f.requests[0].resolve({success:true,data:summary});await f.settle();assert.equal(f.text(),'');
});
test('cost read failures stay visible and retry without guessing a cost',async()=>{
    const f=fixture();f.requests[0].resolve({success:false,error:'Read unavailable'});await f.settle();assert.match(f.text(),/Read unavailable/);assert.equal(f.text().includes('₹0'),false);
    f.retry();f.requests[1].resolve({success:true,data:summary});await f.settle();assert.match(f.text(),/₹450/);
});
