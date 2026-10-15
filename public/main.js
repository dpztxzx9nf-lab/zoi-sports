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
document.querySelectorAll('.avatar[data-avatar]').forEach(a=>{const i=new Image();i.alt='';i.decoding='async';i.onload=()=>{a.textContent='';a.appendChild(i)};i.src=a.dataset.avatar});

(()=>{const dlg=document.getElementById('profile');if(!dlg||!window.ROSTER)return;
const NET={x:'X',tiktok:'TikTok',youtube:'YouTube',twitch:'Twitch',instagram:'Instagram',kick:'Kick'};
const $=id=>document.getElementById(id);let opener=null;
const safe=u=>{try{const x=new URL(u);return x.protocol==='https:'?x.href:null}catch{return null}};
function open(card){const k=card.dataset.player,p=ROSTER[k];if(!p)return;opener=card;
 const av=dlg.querySelector('.pf-avatar');av.textContent=p.gamertag[0].toUpperCase();
 const i=new Image();i.alt='';i.onload=()=>{av.textContent='';av.appendChild(i)};i.src='/img/roster/'+k+'.png';
 $('pf-name').textContent=p.gamertag;$('pf-role').textContent=p.role||'';
 const f=$('pf-facts');f.replaceChildren();[[(p.games||[]).length>1?'Games':'Game',(p.games||[p.game]).filter(Boolean).map(g=>g.replace(/ /g,'\u00a0')).join(', ')],['Region',p.region],['Platform',p.platform]].forEach(([l,v])=>{if(!v)return;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=l;dd.textContent=v;f.append(dt,dd)});
 const b=$('pf-bio');b.textContent=p.bio||'';b.hidden=!p.bio;
 const ul=$('pf-socials');ul.replaceChildren();Object.keys(NET).forEach(n=>{const u=p.socials&&safe(p.socials[n]);if(!u)return;const li=document.createElement('li'),a=document.createElement('a');a.href=u;a.target='_blank';a.rel='noopener noreferrer';a.textContent=NET[n];a.setAttribute('aria-label',p.gamertag+' on '+NET[n]);li.append(a);ul.append(li)});
 $('pf-soon').hidden=ul.children.length>0;
 dlg.showModal();dlg.querySelector('.pf-close').focus()}
document.querySelectorAll('.card[data-player]').forEach(c=>{c.addEventListener('click',()=>open(c));c.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(c)}})});
dlg.querySelector('.pf-close').addEventListener('click',()=>dlg.close());
dlg.addEventListener('click',e=>{if(e.target===dlg){const r=dlg.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dlg.close()}});
dlg.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const fs=[...dlg.querySelectorAll('button,a[href]')];const a=fs[0],z=fs[fs.length-1];if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus()}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus()}});
dlg.addEventListener('close',()=>{if(opener)opener.focus()});})();
