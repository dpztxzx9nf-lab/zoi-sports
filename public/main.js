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

/* Live roster: the profiles people edit in the lab come from /api/roster and win
   over the copy baked into roster.js. The baked-in data stays as the fallback, so
   a roster card still has a name and a role if the request fails — a player never
   disappears because one fetch did not land. */
(()=>{if(!window.ROSTER)return;
const paint=()=>document.querySelectorAll('.card[data-player]').forEach(card=>{
 const p=ROSTER[card.dataset.player];if(!p)return;
 const h=card.querySelector('h3');if(h&&p.gamertag)h.textContent=p.gamertag;
 const r=card.querySelector('.role');if(r)r.textContent=p.role||'';
 const meta=[p.region,p.platform].filter(Boolean).join(' \u00b7 ');
 let m=card.querySelector('.meta');
 if(meta){if(!m){m=document.createElement('p');m.className='meta';r?r.after(m):card.append(m)}m.textContent=meta}
 else if(m)m.remove();
 card.setAttribute('aria-label','View '+p.gamertag+' profile');
});
fetch('/api/roster',{headers:{accept:'application/json'}})
 .then(r=>r.ok?r.json():null)
 .then(j=>{const list=j&&Array.isArray(j.players)?j.players:null;if(!list)return;
  let changed=false;
  list.forEach(row=>{if(!row||!row.slug||!row.gamertag)return;
   const before=ROSTER[row.slug]||{};
   ROSTER[row.slug]=Object.assign({},before,{gamertag:row.gamertag,role:row.role||before.role||'',region:row.region||'',platform:row.platform||'',bio:row.bio||'',socials:row.socials&&typeof row.socials==='object'?row.socials:{},games:before.games||[],settings:row.settings===true||before.settings===true});
   changed=true;
  });
  if(changed)paint();
 })
 .catch(()=>{});
})();

(()=>{const dlg=document.getElementById('profile');if(!dlg||!window.ROSTER)return;
const NET={x:'X',tiktok:'TikTok',youtube:'YouTube',instagram:'Instagram',twitch:'Twitch',kick:'Kick'};
const $=id=>document.getElementById(id);let opener=null;
const safe=u=>{try{const x=new URL(u);return x.protocol==='https:'?x.href:null}catch{return null}};
function open(card){const k=card.dataset.player,p=ROSTER[k];if(!p)return;opener=card;
 const av=dlg.querySelector('.pf-avatar');av.textContent=p.gamertag[0].toUpperCase();
 const i=new Image();i.alt='';i.onload=()=>{av.textContent='';av.appendChild(i)};i.src='/img/roster/'+k+'.png';
 $('pop-name').textContent=p.gamertag;$('pop-role').textContent=p.role||'';
 const f=$('pop-facts');f.replaceChildren();[[(p.games||[]).length>1?'Games':'Game',(p.games||[p.game]).filter(Boolean).map(g=>g.replace(/ /g,'\u00a0')).join(', ')],['Region',p.region],['Platform',p.platform]].forEach(([l,v])=>{if(!v)return;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=l;dd.textContent=v;f.append(dt,dd)});
 const b=$('pop-bio');b.textContent=p.bio||'';b.hidden=!p.bio;
 const ul=$('pop-socials');ul.replaceChildren();Object.keys(NET).forEach(n=>{const u=p.socials&&safe(p.socials[n]);if(!u)return;const li=document.createElement('li'),a=document.createElement('a');a.href=u;a.target='_blank';a.rel='noopener noreferrer';a.textContent=NET[n];a.setAttribute('aria-label',p.gamertag+' on '+NET[n]);li.append(a);ul.append(li)});
 $('pop-soon').hidden=ul.children.length>0;
 const was=dlg.querySelector('.pf-settings');if(was)was.remove();
 if(p.settings){const a=document.createElement('a');a.className='pf-settings';a.href='/settings?p='+encodeURIComponent(k);a.textContent='Game settings';dlg.append(a)}
 dlg.showModal();dlg.querySelector('.pf-close').focus()}
document.querySelectorAll('.card[data-player]').forEach(c=>{c.addEventListener('click',()=>open(c));c.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open(c)}})});
dlg.querySelector('.pf-close').addEventListener('click',()=>dlg.close());
dlg.addEventListener('click',e=>{if(e.target===dlg){const r=dlg.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dlg.close()}});
dlg.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const fs=[...dlg.querySelectorAll('button,a[href]')];const a=fs[0],z=fs[fs.length-1];if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus()}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus()}});
dlg.addEventListener('close',()=>{if(opener)opener.focus()});})();
