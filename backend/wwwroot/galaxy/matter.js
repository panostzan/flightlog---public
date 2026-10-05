// Visual material only. Particles, dust, depth and internal filaments are seeded
// decoration belonging to a real parent node; none are observations or graph edges.
import {visualMagnitude} from './semantics.js';
export function seedOf(text){let h=2166136261;for(const c of text)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
function random(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const tau=Math.PI*2;
const warm='255,185,121',white='255,232,204',blue='125,177,255',violet='171,140,230';
function surface(size){const c=document.createElement('canvas');c.width=c.height=size;return c;}
function haze(c,x,y,rx,ry,angle,color,alpha){
  c.save();c.translate(x,y);c.rotate(angle);c.scale(rx,ry);
  const g=c.createRadialGradient(0,0,0,0,0,1);g.addColorStop(0,`rgba(${color},${alpha})`);g.addColorStop(.35,`rgba(${color},${alpha*.42})`);g.addColorStop(1,`rgba(${color},0)`);
  c.fillStyle=g;c.fillRect(-1,-1,2,2);c.restore();
}
function light(c,x,y,size,color,strength=1,flare=false){
  c.save();c.globalAlpha=strength;c.globalCompositeOperation='lighter';
  haze(c,x,y,size*10,size*10,0,color,.17);
  haze(c,x,y,size*3.4,size*3.4,0,color,.5);
  c.fillStyle=`rgba(${color},.9)`;c.beginPath();c.arc(x,y,size*.68,0,tau);c.fill();
  c.fillStyle='rgba(255,244,232,.95)';c.beginPath();c.arc(x,y,size*.3,0,tau);c.fill();
  if(flare){
    for(const angle of [.18,1.75]){c.save();c.translate(x,y);c.rotate(angle);const g=c.createLinearGradient(-size*12,0,size*12,0);g.addColorStop(0,`rgba(${color},0)`);g.addColorStop(.5,`rgba(${color},.55)`);g.addColorStop(1,`rgba(${color},0)`);c.strokeStyle=g;c.lineWidth=.48;c.beginPath();c.moveTo(-size*12,0);c.lineTo(size*12,0);c.stroke();c.restore();}
  }c.restore();
}

export function clusterMaterial(id,major=true){
  const rand=random(seedOf(id)),size=640,scale=140,origin=size/2;
  const count=major?28+Math.floor(rand()*13):15;
  const tilt=rand()*tau;
  const particles=[];
  for(let i=0;i<count;i++){
    const core=i<12;
    const arm=i%3,angle=tilt+arm*tau/3+(rand()-.5)*1.8;
    const radius=core?Math.pow(rand(),.65)*.34:.36+Math.pow(rand(),.8)*1.2;
    const x=Math.cos(angle)*radius+(rand()-.5)*.2,y=Math.sin(angle)*radius*.76+(rand()-.5)*.15;
    const cool=!core&&rand()<.38;
    particles.push({x,y,size:i===0?4.4:.75+Math.pow(rand(),2)*3.2,
      color:cool?(rand()<.65?blue:violet):(core?white:warm),brightness:.5+rand()*.5,core,depth:rand()});
  }
  particles[0].x=.015;particles[0].y=-.025;
  // A sparse, irregular scaffold. These links describe the material, not activity.
  const filaments=[];
  for(let i=1;i<count;i++){
    if(rand()<.22)continue;
    let nearest=0,distance=Infinity;
    for(let j=0;j<i;j++){const d=Math.hypot(particles[i].x-particles[j].x,particles[i].y-particles[j].y);if(d<distance){distance=d;nearest=j;}}
    filaments.push({a:i,b:nearest,bend:(rand()-.5)*.38,alpha:.2+rand()*.6});
    if(i>10&&i%4===0)filaments.push({a:i,b:i%8,bend:(rand()-.5)*.65,alpha:.3});
  }
  const base=surface(size),reveal=surface(size),c=base.getContext('2d'),r=reveal.getContext('2d');
  // Thin, layered veils give the scaffold volume without filling an orb.
  for(let i=0;i<7;i++){
    const a=particles[12+i%Math.max(1,count-12)],b=particles[i%9];
    const x=origin+a.x*scale,y=origin+a.y*scale,xx=origin+b.x*scale,yy=origin+b.y*scale;
    const bend=(rand()-.5)*scale*.6;
    for(let j=0;j<5;j++){
      c.strokeStyle=`rgba(${i%3?blue:warm},${.006+j*.001})`;c.lineWidth=14-j*2.7;
      c.beginPath();c.moveTo(x,y);c.bezierCurveTo(x+(xx-x)*.4+bend,y+(yy-y)*.3-bend,xx-bend*.4,yy+bend*.3,xx,yy);c.stroke();
    }
  }
  const drawFilaments=(ctx,alpha)=>{
    for(const f of filaments){const a=particles[f.a],b=particles[f.b],x=origin+a.x*scale,y=origin+a.y*scale,xx=origin+b.x*scale,yy=origin+b.y*scale;
      ctx.strokeStyle=`rgba(${a.core?warm:blue},${alpha*f.alpha})`;ctx.lineWidth=.85;ctx.beginPath();ctx.moveTo(x,y);ctx.bezierCurveTo(x+(xx-x)*.28+(yy-y)*f.bend,y+(yy-y)*.3-(xx-x)*f.bend,x+(xx-x)*.76,y+(yy-y)*.7,xx,yy);ctx.stroke();}
  };
  // Overlapping anisotropic clouds, never a circular envelope or boundary.
  for(let i=0;i<Math.min(16,particles.length);i++){
    const p=particles[i],central=i<8;
    haze(c,origin+p.x*scale*.8,origin+p.y*scale*.8,scale*(.25+rand()*.65),scale*(.10+rand()*.23),tilt+rand(),central?warm:blue,central?.08:.038);
    if(central)haze(r,origin+p.x*scale,origin+p.y*scale,scale*.5,scale*.22,tilt, warm,.022);
  }
  drawFilaments(c,.28);drawFilaments(r,.42);
  // Unlabelled dust binds the luminous anchors into one little world.
  for(let i=0;i<240;i++){
    const a=tilt+rand()*tau,rad=Math.pow(rand(),1.7)*1.6;
    const x=origin+Math.cos(a)*rad*scale,y=origin+Math.sin(a)*rad*scale*.72;
    const color=rad<.5?warm:rand()<.65?blue:violet;
    const s=.28+rand()*.9;
    c.fillStyle=`rgba(${color},${.12+rand()*.44})`;c.beginPath();c.arc(x,y,s,0,tau);c.fill();
    if(i%4===0)light(r,x,y,s*.8,color,.32);
  }
  for(const p of [...particles].sort((a,b)=>a.depth-b.depth)){
    const x=origin+p.x*scale,y=origin+p.y*scale;
    light(c,x,y,p.size,p.color,p.brightness*(p.core?1:.7),p.size>1.65);
    light(r,x,y,p.size*(p.core?1.05:1),p.color,p.core?.26:.48,p.size>1.65);
  }
  const softBase=surface(96);softBase.getContext('2d').drawImage(base,0,0,96,96);
  return {base,softBase,reveal,particles,filaments,scale,size,decorative:true};
}

// A compositional arrangement, not semantic proximity. The ranked data order
// is untouched; density collects in unequal islands with open space between.
const anchors=[[-165,25],[260,-190],[385,190],[-432,-207],[-395,235],[40,280],[20,-290],[550,-305],[-565,24],[580,48],[-210,-290],[260,338],[-570,320],[485,-110],[-310,120],[-330,-68],[140,-92],[158,155],[-84,190],[-78,-140],[410,338],[-490,-340],[606,260],[310,-350]];
const portraitAnchors=[[-125,-30],[295,-380],[160,390],[-335,-540],[-310,440],[5,760],[-10,-850],[460,-55]];
export function placeClusters(node,page,pageSize){
  const children=node.children.slice(page*pageSize,page*pageSize+pageSize);
  return children.map((n,i)=>{
    const rand=random(seedOf(n.id));
    const arrangement=pageSize===8?portraitAnchors:anchors;
    const point=children.length===1?[-65,10]:arrangement[(n.layoutSlot??i)%arrangement.length];
    const rank=page*pageSize+i;
    const {prominence,r}=visualMagnitude(n,node.children);
    return {node:n,x:point[0]+(rand()-.5)*34,y:point[1]+(rand()-.5)*30,r,
      prominence,depth:rand(),labelAlpha:i<4?.98:i<8?.34:.08+rand()*.08,rank,
      color:i<6?warm:blue,material:clusterMaterial(n.id,n.children.length>0),hoverStrength:0};
  });
}

export class CosmicField {
  constructor(){this.layers=[];}
  resize(w,h){
    this.w=w;this.h=h;this.layers=[];
    for(let layer=0;layer<3;layer++){
      const canvas=document.createElement('canvas');canvas.width=w+100;canvas.height=h+100;
      const c=canvas.getContext('2d'),rand=random(8217+layer*982),count=Math.round(w*h/(layer===0?1350:layer===1?3300:35000));
      for(let i=0;i<count;i++){
        const x=rand()*canvas.width,y=rand()*canvas.height,size=layer===0?.22+rand()*.35:layer===1?.4+rand()*.5:.8+rand()*.7;
        const color=rand()<.12?warm:rand()<.2?violet:blue;
        if(layer===2)light(c,x,y,size,color,.18+rand()*.32,rand()>.82);
        else{c.fillStyle=`rgba(${color},${.07+rand()*(layer===0?.22:.3)})`;c.beginPath();c.arc(x,y,size,0,tau);c.fill();}
      }
      // Far-off dust strands are unlabelled scenery, not extra data clusters.
      if(layer===0)for(let j=0;j<7;j++){
        const x=rand()*w,y=rand()*h,tilt=rand()*tau;
        haze(c,x,y,75+rand()*150,12+rand()*25,tilt,j%3?blue:violet,.034);
        for(let i=0;i<90;i++){const t=(rand()-.5)*240,spread=(rand()-.5)*26,xx=x+Math.cos(tilt)*t-Math.sin(tilt)*spread,yy=y+Math.sin(tilt)*t+Math.cos(tilt)*spread;c.fillStyle=`rgba(${blue},${rand()*.19})`;c.fillRect(xx,yy,.5,.5);}
      }
      this.layers.push(canvas);
    }
  }
  draw(c,camera,pointer,time,reduced){
    c.fillStyle='#02060d';c.fillRect(0,0,this.w,this.h);
    haze(c,this.w*.41,this.h*.43,this.w*.53,this.h*.38,-.38,'27,46,86',.10);
    for(let i=0;i<2;i++){
      const rate=(i+1)*.006,drift=reduced?0:Math.sin(time/85000+i)*.6;
      const x=Math.max(-42,Math.min(42,-camera.x*rate+(pointer?.x??0)*(i+1)*1.4+drift));
      const y=Math.max(-42,Math.min(42,-camera.y*rate+(pointer?.y??0)*(i+1)*1.1));
      c.drawImage(this.layers[i],x-50,y-50);
    }
  }
  foreground(c,camera,pointer){
    const x=Math.max(-42,Math.min(42,-camera.x*.032+(pointer?.x??0)*6));
    const y=Math.max(-42,Math.min(42,-camera.y*.032+(pointer?.y??0)*5));
    c.drawImage(this.layers[2],x-50,y-50);
  }
}

export function drawCluster(c,p,x,y,zoom,hover,subdued){
  const radius=p.r*Math.sqrt(zoom),m=p.material,extent=radius*m.size/m.scale;
  c.save();c.globalAlpha*=subdued*(.28+p.prominence*.72);
  c.drawImage(p.prominence<.45&&zoom<1.5?m.softBase:m.base,x-extent/2,y-extent/2,extent,extent);
  // Zoom resolves faint material without resizing the cluster as a hover effect.
  const reveal=Math.min(.4,Math.max(0,(zoom-.8)*.18))+hover*.82;
  if(reveal>0){c.save();c.globalAlpha*=reveal;c.drawImage(m.reveal,x-extent/2,y-extent/2,extent,extent);c.restore();}
  if(hover>.01){
    const dx=radius*1.23+6,dy=radius*1.02+6,len=8+radius*.045;
    c.strokeStyle=`rgba(190,211,237,${hover*.66})`;c.lineWidth=.65;
    for(const sx of [-1,1])for(const sy of [-1,1]){c.beginPath();c.moveTo(x+sx*(dx-len),y+sy*dy);c.lineTo(x+sx*dx,y+sy*dy);c.lineTo(x+sx*dx,y+sy*(dy-len));c.stroke();}
  }c.restore();
  return radius;
}
