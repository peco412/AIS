const {JSDOM}=require('jsdom');const vm=require('vm'),fs=require('fs'),path=require('path'),assert=require('assert');
const base=path.resolve(__dirname, '../app');
async function loadPage(file){
 const dom=new JSDOM(fs.readFileSync(path.join(base,file),'utf8'),{url:'http://localhost/'+file,runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
 w.matchMedia=()=>({matches:false,addEventListener(){}});w.scrollTo=()=>{};w.HTMLElement.prototype.getClientRects=function(){return [1]};w.__ENV__={};
 const calls=[];const emp={id:'e1',full_name:'Nguyễn An',status:'active',temp_password_flag:false,center_id:'c1',language_preference:'vi',department_id:'d1',departments:{code:'HR',name:'Nhân sự'},positions:{name:'Quản lý',is_teacher_eligible:false},system_roles:{code:'TECH',name:'Kỹ thuật'},centers:{id:'c1',name:'MEKONG',divisions:{code:'ALOHA'}}};
 function q(table){let single=false;const o=new Proxy({}, {get(_,k){if(k==='then')return (yes,no)=>Promise.resolve({data:single?(table==='employees'?emp:table==='centers'?{id:'c1',name:'MEKONG',latitude:10,longitude:106}:null):(table==='centers'?[{id:'c1',name:'ALOHA Sài Gòn – MEKONG',code:'MEKONG',divisions:{code:'ALOHA'}},{id:'c2',name:'ALOHA Trà Vinh',code:'TV',divisions:{code:'ALOHA'}}]:[]),error:null,count:0}).then(yes,no);return()=>{if(k==='single'||k==='maybeSingle')single=true;return o};}});return o;}
 w.supabase={createClient(){return {auth:{getSession:async()=>({data:{session:{user:{id:'u1'}}}}),signOut:async()=>({error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from(t){calls.push(t);return q(t)},rpc(){return q('rpc')},channel(){return {on(){return this},subscribe(){return this}}},removeChannel(){}}}};
 const context=dom.getInternalVMContext();const cache=new Map();
 function getModule(filename){filename=path.resolve(filename);if(cache.has(filename))return cache.get(filename);const m=new vm.SourceTextModule(fs.readFileSync(filename,'utf8'),{context,identifier:filename});cache.set(filename,m);return m;}
 const linker=(spec,parent)=>getModule(spec.startsWith('/')?path.join(base,spec):path.resolve(path.dirname(parent.identifier),spec));
 async function module(filename){const m=getModule(filename);if(m.status==='unlinked')await m.link(linker);return m;}
 // Cache loader handles shared imports by linking entry's complete graph at once.
 return {w,dom,calls,module};
}
(async()=>{const results=[];
 let p=await loadPage('world-select.html');let m=await p.module(path.join(base,'js/workspaceHome.js'));await m.evaluate();await new Promise(r=>setTimeout(r,80));assert(p.w.document.querySelector('#greeting').textContent.includes('Nguyễn An'));assert(p.w.document.querySelectorAll('.workspace-function').length>30);assert(p.w.document.querySelector('.workspace-sidebar'));assert.equal(p.w.document.querySelector('[href="/attendance-checkin.html"]'),null);results.push('Trang chủ mới hiển thị tác vụ và không có chấm công GPS');
 const search=p.w.document.querySelector('#homeSearch');search.value='bang luong';search.dispatchEvent(new p.w.Event('input'));assert(p.w.document.querySelectorAll('.workspace-function').length>0);results.push('Tìm công việc không dấu');
 const nav=p.w.document.querySelector('#workspaceNavSearch');nav.value='bang cong';nav.dispatchEvent(new p.w.Event('input'));assert([...p.w.document.querySelectorAll('.workspace-nav-item')].some(a=>!a.hidden&&a.href.endsWith('/hr/attendance-sheet.html')));results.push('Bảng công HCNS và kế toán cùng một đích');
 const sh=await p.module(path.join(base,'js/shell.js'));assert(sh.namespace.canAccess({href:'/x',visible:()=>false},{grantedModules:new Set(['/x'])}));results.push('Giữ quyền mở rộng');
 p.dom.window.close();
 const p2=await loadPage('hr/attendance-sheet.html');m=await p2.module(path.join(base,'js/attendanceSheet.js'));await m.evaluate();await new Promise(r=>setTimeout(r,80));assert.equal(p2.w.document.querySelector('#sheetError').classList.contains('show'),false);results.push('Bảng công khởi tạo với mock Supabase');p2.dom.window.close();
 const p3=await loadPage('documents.html');m=await p3.module(path.join(base,'js/documents.js'));await m.evaluate();await new Promise(r=>setTimeout(r,80));assert.equal(p3.w.document.querySelector('#documentError').classList.contains('show'),false);assert(p3.w.document.querySelectorAll('#documentType option').length>=6);results.push('Mẫu đơn khởi tạo và lọc theo nhóm nhân sự');p3.dom.window.close();
 console.log(JSON.stringify({passed:results.length,results},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
