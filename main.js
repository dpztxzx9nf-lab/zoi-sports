const b=document.querySelector('.menu'),n=document.querySelector('.nav nav');
b.onclick=()=>{const o=n.classList.toggle('open');b.setAttribute('aria-expanded',o)};
n.querySelectorAll('a').forEach(a=>a.onclick=()=>n.classList.remove('open'));
document.getElementById('y').textContent=new Date().getFullYear();
