(()=>{
 const root=document.querySelector('.bundle-carousel');if(!root)return;
 const track=root.querySelector('.bundle-grid'),windowEl=root.querySelector('.bundle-window');
 const cards=[...track.children],n=cards.length,reduce=matchMedia('(prefers-reduced-motion: reduce)');
 let index=n,busy=false,timer;
 function clone(card){const copy=card.cloneNode(true);copy.setAttribute('aria-hidden','true');copy.inert=true;return copy;}
 cards.forEach(c=>track.append(clone(c)));cards.slice().reverse().forEach(c=>track.prepend(clone(c)));
 const step=()=>track.children[0].getBoundingClientRect().width+22;
 function draw(animate=true){const visible=Math.round((windowEl.clientWidth+22)/step());[...track.children].forEach((c,i)=>{const active=i>=index&&i<index+visible;c.inert=!active;c.setAttribute('aria-hidden',String(!active))});track.style.transition=animate?'':'none';track.style.transform=`translateX(${-index*step()}px)`;}
 function normalize(){if(index>=n*2)index-=n;if(index<n)index+=n;draw(false);busy=false;}
 function move(dir){if(busy)return;busy=true;index+=dir;draw(!reduce.matches);setTimeout(normalize,reduce.matches?0:650);}
 function schedule(){clearInterval(timer);timer=setInterval(()=>{if(!reduce.matches&&!document.hidden&&!root.querySelector('.bundle-card:hover')&&!root.contains(document.activeElement))move(1)},5500);}
 root.querySelector('.bundle-prev').onclick=()=>move(-1);root.querySelector('.bundle-next').onclick=()=>move(1);
 root.addEventListener('keydown',e=>{if(e.key==='ArrowRight'){e.preventDefault();move(1)}if(e.key==='ArrowLeft'){e.preventDefault();move(-1)}});
 let touchX;windowEl.addEventListener('touchstart',e=>touchX=e.touches[0].clientX,{passive:true});windowEl.addEventListener('touchend',e=>{const delta=e.changedTouches[0].clientX-touchX;if(Math.abs(delta)>45)move(delta<0?1:-1)},{passive:true});
 new ResizeObserver(()=>draw(false)).observe(windowEl);draw(false);schedule();
})();
