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
