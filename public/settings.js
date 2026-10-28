(()=>{
const bar=document.querySelector('.fn-tabs'),tabs=[...document.querySelectorAll('.fn-tabs [role=tab]')];
if(!bar||!tabs.length)return;
const sel=(t,focus)=>{tabs.forEach(x=>{const on=x===t;x.setAttribute('aria-selected',on?'true':'false');x.tabIndex=on?0:-1;const p=document.getElementById(x.getAttribute('aria-controls'));if(p)p.hidden=!on});if(focus)t.focus()};
tabs.forEach((t,i)=>{
 t.addEventListener('click',()=>sel(t));
 t.addEventListener('keydown',e=>{
  const n=tabs.length;let j=null;
  if(e.key==='ArrowRight')j=(i+1)%n;
  else if(e.key==='ArrowLeft')j=(i-1+n)%n;
  else if(e.key==='Home')j=0;
  else if(e.key==='End')j=n-1;
  if(j===null)return;
  e.preventDefault();sel(tabs[j],true);
 });
});
sel(tabs.find(t=>t.getAttribute('aria-selected')==='true')||tabs[0]);
})();

/* description strip: the hovered row's data-desc, on hover and on focus */
(()=>{
const out=document.getElementById('fn-desc');
if(!out)return;
const def=out.getAttribute('data-default')||out.textContent;
const rows=[...document.querySelectorAll('.fn-row[data-desc],.fn-bind[data-desc],.dg-btn[data-desc]')];
const show=r=>{const d=r.getAttribute('data-desc');out.textContent=d||def};
const reset=()=>{out.textContent=def};
rows.forEach(r=>{
 r.addEventListener('mouseenter',()=>show(r));
 r.addEventListener('focus',()=>show(r));
 r.addEventListener('mouseleave',reset);
 r.addEventListener('blur',reset);
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')reset()});
})();
