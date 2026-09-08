/** Local gallery renderer. Model output supplies exhibits, not an entire 3D engine. */
export const SCENE_RUNTIME = String.raw`
(() => {
  'use strict';
  window.NaviScene = {
    mount(selector, config) {
      const root = document.querySelector(selector);
      if (!root) throw new Error('Scene mount target was not found');
      const rooms = Array.isArray(config.rooms) ? config.rooms.slice(0, 12) : [];
      if (!rooms.length) throw new Error('A scene needs at least one room with exhibits');
      const text = (value, limit = 1600) => String(value || '').slice(0, limit);
      root.replaceChildren();
      const style = document.createElement('style');
      style.textContent = '.navi-scene{position:relative;overflow:hidden;border-radius:18px;background:#17130f;color:#fff;font-family:system-ui,sans-serif}.navi-scene canvas{display:block;width:100%;height:440px;max-height:65vh;min-height:260px;touch-action:none;outline-offset:-4px}.navi-scene header{padding:16px;background:#241e18}.navi-scene h2{margin:0;font-size:20px}.navi-scene p{margin:6px 0;font-size:13px;line-height:1.5}.navi-scene nav{display:flex;flex-wrap:wrap;gap:8px;padding:10px;background:#241e18}.navi-scene button{width:auto;min-width:44px;min-height:44px;border:1px solid #746044;background:#30271e;color:#fff;border-radius:10px;padding:8px 12px}.navi-scene button:disabled{opacity:.45}.navi-scene [role=status]{padding:10px 14px;font-size:13px;background:#241e18}.navi-scene article{padding:16px;background:#fff4dc;color:#302418;max-height:240px;overflow:auto}.navi-scene article h3{margin:0 0 6px}.navi-scene .navi-room-picker{padding:0 10px 10px;display:flex;gap:6px;overflow:auto}.navi-scene .navi-room-picker button{white-space:nowrap}.navi-scene button[aria-current=true]{background:#715126}';
      root.appendChild(style);
      const shell = document.createElement('section'); shell.className = 'navi-scene'; root.appendChild(shell);
      const header = document.createElement('header'); shell.appendChild(header);
      const title = document.createElement('h2'); title.textContent = text(config.title, 120); header.appendChild(title);
      const subtitle = document.createElement('p'); header.appendChild(subtitle);
      const canvas = document.createElement('canvas'); canvas.tabIndex = 0; canvas.setAttribute('aria-label', 'Walkable gallery. Arrow keys or W A S D move; E opens the nearest exhibit.'); shell.appendChild(canvas);
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas is unavailable on this device');
      const status = document.createElement('div'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); shell.appendChild(status);
      const nav = document.createElement('nav'); nav.setAttribute('aria-label', 'Gallery movement'); shell.appendChild(nav);
      const detail = document.createElement('article'); detail.hidden = true; detail.setAttribute('aria-label', 'Exhibit details'); shell.appendChild(detail);
      const picker = document.createElement('div'); picker.className = 'navi-room-picker'; shell.appendChild(picker);
      let roomIndex = 0, x = 0, z = 4.5, yaw = 0, lastTime = 0, alive = true;
      let exhibits = [], projected = [], w = 400, h = 440;
      const held = new Set();
      const listeners = [];
      const listen = (target, event, handler, options) => { target.addEventListener(event, handler, options); listeners.push(() => target.removeEventListener(event, handler, options)); };
      const button = (label, action, parent = nav) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; listen(b, 'click', action); parent.appendChild(b); return b; };
      const reset = () => { x = 0; z = 4.5; yaw = 0; detail.hidden = true; held.clear(); };
      const setRoom = index => {
        roomIndex = Math.max(0, Math.min(rooms.length - 1, index)); reset();
        const room = rooms[roomIndex];
        subtitle.textContent = text(room.title, 100) + (room.period ? ' · ' + text(room.period, 80) : '');
        const items = Array.isArray(room.exhibits) ? room.exhibits.slice(0, 12) : [];
        exhibits = items.map((item, i) => ({ item, x: i % 2 ? 4.1 : -4.1, z: 3.2 - Math.floor(i / 2) * 1.7 }));
        status.textContent = 'Drag to look around. Walk toward a display, then press Explore exhibit. ' + (roomIndex + 1) + ' of ' + rooms.length + ' rooms.';
        Array.from(picker.children).forEach((b, i) => b.setAttribute('aria-current', String(i === roomIndex)));
        previous.disabled = roomIndex === 0; next.disabled = roomIndex === rooms.length - 1;
      };
      const openExhibit = exhibit => {
        if (!exhibit) return;
        const item = exhibit.item; detail.replaceChildren(); detail.hidden = false;
        const heading = document.createElement('h3'); heading.textContent = text(item.title || item.name, 140); detail.appendChild(heading);
        for (const value of [item.dates, item.description, item.work, item.source ? 'Source: ' + text(item.source, 300) : '']) {
          if (!value) continue;
          const p = document.createElement('p'); p.textContent = text(value); detail.appendChild(p);
        }
        button('Close exhibit', () => { detail.hidden = true; }, detail);
      };
      const nearest = () => [...exhibits].sort((a, b) => Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z))[0];
      const advance = (amount, sideways = 0) => {
        x = Math.max(-4.5, Math.min(4.5, x + Math.sin(yaw)*amount + Math.cos(yaw)*sideways));
        z = Math.max(-6.3, Math.min(6.3, z - Math.cos(yaw)*amount + Math.sin(yaw)*sideways));
      };
      const move = (label, key, action) => {
        const b = button(label, action);
        listen(b, 'pointerdown', event => { event.preventDefault(); held.add(key); b.setPointerCapture(event.pointerId); });
        const stop = () => held.delete(key); listen(b, 'pointerup', stop); listen(b, 'pointercancel', stop); listen(b, 'lostpointercapture', stop);
      };
      move('↶ Turn left', 'left', () => { yaw -= .22; });
      move('↑ Forward', 'forward', () => advance(.4));
      move('↓ Back', 'back', () => advance(-.4));
      move('↷ Turn right', 'right', () => { yaw += .22; });
      button('Explore exhibit', () => openExhibit(nearest()));
      button('Reset position', reset);
      const previous = button('Previous room', () => setRoom(roomIndex - 1));
      const next = button('Next room', () => setRoom(roomIndex + 1));
      rooms.forEach((room, index) => button(text(room.title, 60) || 'Room ' + (index + 1), () => setRoom(index), picker));
      const keys = { ArrowUp:'forward', w:'forward', ArrowDown:'back', s:'back', ArrowLeft:'left', a:'left', ArrowRight:'right', d:'right' };
      listen(canvas, 'keydown', event => { const key = keys[event.key]; if (key) { event.preventDefault(); held.add(key); } if (event.key.toLowerCase() === 'e') openExhibit(nearest()); });
      listen(canvas, 'keyup', event => held.delete(keys[event.key]));
      listen(window, 'blur', () => held.clear()); listen(canvas, 'blur', () => held.clear());
      let pointer = null;
      listen(canvas, 'pointerdown', event => { canvas.focus(); canvas.setPointerCapture(event.pointerId); pointer = { x:event.clientX, y:event.clientY, moved:false }; });
      listen(canvas, 'pointermove', event => { if (!pointer) return; const delta = event.clientX-pointer.x; yaw += delta*.006; if (Math.abs(delta)>2) pointer.moved=true; pointer.x=event.clientX; });
      listen(canvas, 'pointerup', event => {
        if (pointer && !pointer.moved) { const bounds=canvas.getBoundingClientRect(); const px=event.clientX-bounds.left, py=event.clientY-bounds.top; const target=[...projected].reverse().find(p=>px>=p.x&&px<=p.x+p.w&&py>=p.y&&py<=p.y+p.h); if (target) openExhibit(target.exhibit); }
        pointer=null;
      });
      listen(canvas, 'pointercancel', () => { pointer=null; });
      const resize = () => { const bounds=canvas.getBoundingClientRect(); w=Math.max(1,bounds.width); h=Math.max(1,bounds.height); const dpr=Math.min(2,window.devicePixelRatio||1); canvas.width=Math.round(w*dpr); canvas.height=Math.round(h*dpr); ctx.setTransform(dpr,0,0,dpr,0,0); };
      const observer=new ResizeObserver(resize); observer.observe(canvas); resize(); setRoom(0);
      const draw = time => {
        if (!alive || !root.isConnected) { alive=false; observer.disconnect(); listeners.forEach(remove=>remove()); return; }
        const dt=Math.min(.04,(time-lastTime)/1000||0); lastTime=time;
        if (held.has('left')) yaw-=dt*1.5; if (held.has('right')) yaw+=dt*1.5;
        if (held.has('forward')) advance(dt*2.4); if (held.has('back')) advance(-dt*2.4);
        const horizon=h*.45, focal=w*.82;
        const ceiling=ctx.createLinearGradient(0,0,0,horizon); ceiling.addColorStop(0,'#191611'); ceiling.addColorStop(1,'#64503a'); ctx.fillStyle=ceiling; ctx.fillRect(0,0,w,horizon);
        const floor=ctx.createLinearGradient(0,horizon,0,h); floor.addColorStop(0,'#413426'); floor.addColorStop(1,'#a38a66'); ctx.fillStyle=floor; ctx.fillRect(0,horizon,w,h-horizon);
        for(let sx=0;sx<w;sx+=3) {
          const offset=Math.atan((sx-w/2)/focal), angle=yaw+offset, dx=Math.sin(angle), dz=-Math.cos(angle);
          const tx=dx>0?(5-x)/dx:dx<0?(-5-x)/dx:Infinity, tz=dz>0?(7-z)/dz:dz<0?(-7-z)/dz:Infinity;
          const distance=Math.min(tx,tz)*Math.cos(offset), wall=Math.min(h*3,focal*3.2/Math.max(.2,distance));
          const shade=Math.max(28,Math.min(115,130-distance*7)), side=tx<tz;
          ctx.fillStyle='rgb('+Math.round(shade*(side?1:.88))+','+Math.round(shade*.81)+','+Math.round(shade*.58)+')'; ctx.fillRect(sx,horizon-wall*.53,4,wall);
          ctx.fillStyle='#bd9758'; ctx.fillRect(sx,horizon+wall*.43,4,Math.max(1,wall*.016));
        }
        projected=[];
        for(const exhibit of exhibits) {
          const dx=exhibit.x-x,dz=exhibit.z-z,depth=Math.sin(yaw)*dx-Math.cos(yaw)*dz,across=Math.cos(yaw)*dx+Math.sin(yaw)*dz;
          if(depth<.3) continue;
          const size=Math.min(h*1.6,focal*1.1/depth), px=w/2+across/depth*focal-size/2, py=horizon-size*.56;
          if(px+size<0||px>w) continue; projected.push({x:px,y:py,w:size,h:size*1.2,depth,exhibit});
        }
        projected.sort((a,b)=>b.depth-a.depth);
        for(const p of projected) {
          ctx.fillStyle='#c6a36a'; ctx.fillRect(p.x-4,p.y-4,p.w+8,p.h+8); ctx.fillStyle='#342a22'; ctx.fillRect(p.x,p.y,p.w,p.h);
          ctx.fillStyle='#e8d2a6'; ctx.fillRect(p.x+p.w*.16,p.y+p.h*.12,p.w*.68,p.h*.38);
          ctx.fillStyle='#6a4525'; ctx.beginPath(); ctx.arc(p.x+p.w*.5,p.y+p.h*.28,p.w*.1,0,Math.PI*2); ctx.fill(); ctx.fillRect(p.x+p.w*.32,p.y+p.h*.36,p.w*.36,p.h*.11);
          ctx.fillStyle='#fff1d5'; ctx.textAlign='center'; ctx.font='600 '+Math.max(8,p.w*.095)+'px system-ui';
          const words=text(p.exhibit.item.title||p.exhibit.item.name,80).split(' '); let line='',lines=[];
          for(const word of words) { const next=line?line+' '+word:word; if(ctx.measureText(next).width>p.w*.88&&line) { lines.push(line); line=word; } else line=next; } if(line) lines.push(line);
          lines.slice(0,3).forEach((value,i)=>ctx.fillText(value,p.x+p.w/2,p.y+p.h*.65+i*p.w*.13,p.w*.9));
          ctx.font=Math.max(7,p.w*.07)+'px system-ui'; ctx.fillStyle='#d5bb91'; ctx.fillText(text(p.exhibit.item.dates,40),p.x+p.w/2,p.y+p.h*.94,p.w*.9);
        }
        // Position map makes movement visible and helps visitors orient themselves.
        ctx.fillStyle='rgba(10,8,6,.7)'; ctx.fillRect(w-77,10,67,87); ctx.strokeStyle='#ddc396'; ctx.strokeRect(w-71,16,55,75);
        ctx.fillStyle='#ffe0a1'; const mx=w-71+(x+5)/10*55,mz=16+(z+7)/14*75; ctx.beginPath(); ctx.arc(mx,mz,3,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.moveTo(mx,mz); ctx.lineTo(mx+Math.sin(yaw)*9,mz-Math.cos(yaw)*9); ctx.stroke();
        requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
      return { reset, setRoom, destroy: () => { alive=false; observer.disconnect(); listeners.forEach(remove=>remove()); root.replaceChildren(); } };
    }
  };
})();
`;
