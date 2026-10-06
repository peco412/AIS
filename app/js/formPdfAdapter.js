import {buildDocumentPdf} from './documentPdf.js';import {resolveFileUrl} from './supabase.js';
export async function generatedFormPdf(profile,root,title){
 const fields=[...root.querySelectorAll('input:not([type=file]):not([type=hidden]):not([type=password]),select,textarea')].filter(el=>!el.disabled&&el.type!=='checkbox'&&el.type!=='radio'&&!el.closest('[hidden]')).map(el=>({label:el.id?root.querySelector(`label[for="${el.id}"]`)?.textContent.trim()||el.closest('.field')?.querySelector('label')?.textContent.trim()||el.id:el.name||'Thông tin',value:el.tagName==='SELECT'?el.selectedOptions[0]?.textContent||'':el.value}));
 const signatures=[];if(profile.signatureUrl){const response=await fetch(await resolveFileUrl(profile.signatureUrl,900));if(!response.ok)throw new Error('Không tải được chữ ký người làm đơn.');signatures.push({step:0,name:profile.fullName,at:new Date().toISOString(),image:await response.blob()});}
 return buildDocumentPdf({title,author:profile.fullName,fields,signatures});
}
