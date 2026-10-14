const b=document.querySelector('.menu'),n=document.querySelector('.nav nav');
b.onclick=()=>{const o=n.classList.toggle('open');b.setAttribute('aria-expanded',o)};
n.querySelectorAll('a').forEach(a=>a.onclick=()=>n.classList.remove('open'));
{const y=document.getElementById('y');if(y)y.textContent=new Date().getFullYear()}
const f=document.getElementById('apply'),st=document.getElementById('status');
if(f)f.addEventListener('submit',async e=>{
 e.preventDefault();st.className='';
 if(!f.checkValidity()){f.reportValidity();st.className='err';st.textContent='Please fill in the required fields (age must be 13+).';return}
 const btn=f.querySelector('button');btn.disabled=true;st.textContent='Sending…';
 try{const r=await fetch('/api/apply',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(f)))});
  const j=await r.json().catch(()=>({}));
  if(r.ok&&j.ok){f.reset();st.className='ok';st.textContent='Application received — welcome to the arena. We\'ll reach out on Discord.'}
  else{st.className='err';st.textContent=(j.errors||[j.error||'Something went wrong. Try again.']).join(' ')}
 }catch{st.className='err';st.textContent='Network error. Try again.'}
 btn.disabled=false});

(()=>{const tabs=[...document.querySelectorAll('.game-tabs [role=tab]')];if(!tabs.length)return;
const sel=(t,focus)=>{tabs.forEach(x=>{const on=x===t;x.setAttribute('aria-selected',on);x.tabIndex=on?0:-1;document.getElementById(x.getAttribute('aria-controls')).hidden=!on});if(focus)t.focus()};
tabs.forEach((t,i)=>{t.addEventListener('click',()=>sel(t));t.addEventListener('keydown',e=>{let j=null;if(e.key==='ArrowRight')j=(i+1)%tabs.length;else if(e.key==='ArrowLeft')j=(i-1+tabs.length)%tabs.length;else if(e.key==='Home')j=0;else if(e.key==='End')j=tabs.length-1;if(j!==null){e.preventDefault();sel(tabs[j],true)}})})})();
