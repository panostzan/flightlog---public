import {CosmicField,placeClusters,drawCluster} from './matter.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*t;
const ease=t=>t*t*(3-2*t);
function hash(s){let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
export class Space {
  constructor(canvas,container,onEnter,onHover){
    Object.assign(this,{canvas,container,onEnter,onHover,ctx:canvas.getContext('2d'),camera:{x:0,y:0,z:1},points:[],highlight:new Set(),page:0,hover:null,transition:null});
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.field=new CosmicField();this.pointer={x:0,y:0};this.pointerTarget={x:0,y:0};
    addEventListener('pointermove',e=>{this.pointerTarget={x:e.clientX/this.w-.5,y:e.clientY/this.h-.5};},{passive:true});
    this.resize=()=>{this.w=innerWidth;this.h=innerHeight;this.pageSize=this.w<700?8:24;const d=Math.min(devicePixelRatio,2);canvas.width=this.w*d;canvas.height=this.h*d;this.ctx.setTransform(d,0,0,d,0,0);this.field.resize(this.w,this.h);if(this.node&&!this.transition){this.set(this.node,Math.min(this.page,Math.max(0,Math.ceil(this.node.children.length/this.pageSize)-1)));this.onLayout?.();}};
    addEventListener('resize',this.resize);this.resize();
    canvas.addEventListener('pointerdown',e=>{if(this.transition)return;this.zoomTarget=null;this.drag={x:e.clientX,y:e.clientY,c:{...this.camera}};canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';});
    canvas.addEventListener('pointermove',e=>{if(!this.drag)return;this.camera.x=this.drag.c.x-(e.clientX-this.drag.x)/this.camera.z;this.camera.y=this.drag.c.y-(e.clientY-this.drag.y)/this.camera.z;});
    const end=()=>{this.drag=null;canvas.style.cursor='grab';};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
    const wheel=e=>{e.preventDefault();const pixels=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?this.h:1);if(!this.transition)this.zoom(Math.exp(-pixels*.004),e.clientX,e.clientY,true);};
    canvas.addEventListener('wheel',wheel,{passive:false});container.addEventListener('wheel',wheel,{passive:false});
    this.frame=this.frame.bind(this);this.raf=requestAnimationFrame(this.frame);
  }
  layout(node,page=0){const points=placeClusters(node,page,this.pageSize);const rootSpread=node.depth===0?1.42:1;return points.map(p=>({...p,x:p.x*rootSpread,y:p.y*rootSpread}));}
  fit(){return {x:0,y:0,z:Math.min(1.12,Math.max(.27,Math.min(this.w/(this.w<700?1360:1460),(this.h-340)/850)))};}
  set(node,page=0){this.zoomTarget=null;this.node=node;this.page=page;this.points=this.layout(node,page);this.camera=this.fit();this.buttons();}
  buttons(){this.container.replaceChildren();for(const p of this.points){const b=document.createElement('button');b.className='node';b.dataset.nodeId=p.node.id;b.setAttribute('aria-label',`${p.node.label}, ${Math.round(p.node.magnitudeMs/60000)} confirmed browser minutes. ${p.node.children.length?'Enter':'Inspect evidence'}`);const label=document.createElement('span');label.textContent=p.node.label.length>42?p.node.label.slice(0,40)+'…':p.node.label;const meta=document.createElement('small');meta.textContent=p.node.children.length?`${p.node.children.length} TOPICS  ↗`:'HISTORY & EVIDENCE';b.append(label,meta);b.style.setProperty('--label-alpha',p.labelAlpha);b.onclick=()=>{if(!this.transition)this.onEnter(p.node);};b.onpointerenter=()=>{this.hover=p.node.id;this.onHover(p.node);};b.onpointerleave=()=>{this.hover=null;this.onHover(null);};b.onfocus=()=>{this.hover=p.node.id;b.classList.add('keyboard-focus');this.onHover(p.node);};b.onblur=()=>{this.hover=null;b.classList.remove('keyboard-focus');this.onHover(null);};this.container.append(b);p.button=b;}}
  zoom(factor,x=this.w/2,y=this.h*.44,smooth=false){
    const z=clamp((smooth?this.zoomTarget?.z??this.camera.z:this.camera.z)*factor,.25,4);
    const wx=(x-this.w/2)/this.camera.z+this.camera.x,wy=(y-this.h*.44)/this.camera.z+this.camera.y;
    if(smooth&&!this.reduced){this.zoomTarget={z,x,y,wx,wy};return;}
    this.zoomTarget=null;this.camera={x:wx-(x-this.w/2)/z,y:wy-(y-this.h*.44)/z,z};
  }
  settleZoom(dt){
    const target=this.zoomTarget;if(!target||this.transition||this.drag)return;
    // Frame-rate independent damping in logarithmic zoom space; no bounce or overshoot.
    const error=Math.log(target.z/this.camera.z),done=Math.abs(error)<.0001;
    const z=done?target.z:this.camera.z*Math.exp(error*(1-Math.exp(-dt/110)));
    this.camera={x:target.wx-(target.x-this.w/2)/z,y:target.wy-(target.y-this.h*.44)/z,z};
    if(done)this.zoomTarget=null;
  }
  async enter(node,back=false,page=0){
    if(this.transition)return false;
    this.zoomTarget=null;
    const old={node:this.node,points:this.points,camera:{...this.camera}},next={node,points:this.layout(node,page),camera:this.fit()};
    const anchor=back?next.points.find(p=>p.node.id===old.node.id):old.points.find(p=>p.node.id===node.id);
    this.container.style.pointerEvents='none';this.container.replaceChildren();
    return new Promise(resolve=>{this.transition={old,next,anchor:anchor??{x:0,y:0},back,start:performance.now(),duration:this.reduced?1:950,done:()=>{this.node=node;this.points=next.points;this.camera=next.camera;this.page=page;this.container.style.pointerEvents='';this.buttons();resolve(true);}};});
  }
  position(p,c=this.camera){return {x:this.w/2+(p.x-c.x)*c.z,y:this.h*.44+(p.y-c.y)*c.z};}
  visualPosition(p,c=this.camera){
    const pos=this.position(p,c);
    if(!this.reduced&&!this.transition){pos.x+=this.pointer.x*p.depth*5+Math.sin((this.lastFrame??0)/62000+p.depth*9)*.45;pos.y+=this.pointer.y*p.depth*4;}
    return pos;
  }
  positionLabels(){
    const occupied=[];
    for(const p of this.points){
      const {x,y}=this.visualPosition(p),radius=p.r*Math.sqrt(this.camera.z);
      const width=Math.min(this.w<700?139:218,(p.node.label.length+4)*(this.w<700?5:6.4));
      const label={left:x-width/2,right:x+width/2,top:y+radius*1.28+10,bottom:y+radius*1.28+30};
      const overlaps=occupied.some(a=>label.left<a.right+8&&label.right>a.left-8&&label.top<a.bottom+5&&label.bottom>a.top-5);
      if(!overlaps)occupied.push(label);
      p.button.classList.toggle('label-muted',overlaps);
      p.button.style.setProperty('--label-alpha',Math.min(1,p.labelAlpha+Math.max(0,(this.camera.z-1)*.55)));
      p.button.style.left=x+'px';p.button.style.top=y+'px';p.button.style.setProperty('--cluster-radius',radius+'px');
      p.button.style.visibility=x< -100||x>this.w+100||y< -100||y>this.h+100?'hidden':'visible';
      p.button.classList.toggle('highlight',this.highlight.has(p.node.id));
    }
  }
  drawScene(scene,alpha=1,camera=scene.camera){
    const ctx=this.ctx;ctx.save();ctx.globalAlpha=alpha;
    const positions=new Map(scene.points.map(p=>[p.node.id,{p,...this.visualPosition(p,camera)}]));
    for(const edge of scene.node.edges){
      const a=positions.get(edge.a),b=positions.get(edge.b);if(!a||!b)continue;
      const seed=hash(edge.a+edge.b),hover=Math.max(a.p.hoverStrength,b.p.hoverStrength);
      const lit=this.highlight.has(edge.a)&&this.highlight.has(edge.b);
      const brightness=(seed%5===0?.058:.016)+(lit?.24:hover*.18);
      ctx.strokeStyle=`rgba(${lit||hover>.1?'206,171,135':'95,126,182'},${brightness})`;ctx.lineWidth=lit?.8:.55;
      const dx=b.x-a.x,dy=b.y-a.y,bend=.08+(seed%13)/100;
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.bezierCurveTo(a.x+dx*.27+dy*bend,a.y+dy*.28-dx*bend,a.x+dx*.73-dy*bend*.45,a.y+dy*.76+dx*bend*.45,b.x,b.y);ctx.stroke();
    }
    for(const {p,x,y} of [...positions.values()].sort((a,b)=>a.p.depth-b.p.depth)){
      const active=this.hover===p.node.id||this.highlight.has(p.node.id);
      const r=drawCluster(ctx,p,x,y,camera.z,p.hoverStrength,this.hover&&!active?.79:1);
      if(scene.node!==this.node||this.transition){ctx.font='300 10px Segoe UI';ctx.textAlign='center';const alpha=Math.min(1,p.labelAlpha+Math.max(0,(camera.z-1)*.55));ctx.fillStyle=`rgba(198,210,230,${alpha})`;ctx.fillText(p.node.label.slice(0,36).toUpperCase(),x,y+r*1.3+20);}
    }ctx.restore();
  }
  frame(now){const dt=Math.min(50,Math.max(0,now-(this.lastFrame??now)));this.settleZoom(dt);this.lastFrame=now;
    const damping=this.reduced?1:1-Math.exp(-dt/380);
    this.pointer.x=mix(this.pointer.x,this.reduced?0:this.pointerTarget.x,damping);this.pointer.y=mix(this.pointer.y,this.reduced?0:this.pointerTarget.y,damping);
    for(const p of this.points){const target=this.hover===p.node.id||this.highlight.has(p.node.id)?1:0;p.hoverStrength=mix(p.hoverStrength,target,this.reduced?1:1-Math.exp(-dt/210));}
    const c=this.ctx;this.field.draw(c,this.camera,this.pointer,now,this.reduced);
    if(this.transition){const tr=this.transition,t=clamp((now-tr.start)/tr.duration,0,1),s=ease(t),a=tr.anchor;
      if(!tr.back){const out={x:mix(tr.old.camera.x,a.x,s),y:mix(tr.old.camera.y,a.y,s),z:tr.old.camera.z*mix(1,8,s)};this.drawScene(tr.old,1-s,out);this.drawScene(tr.next,s,{...tr.next.camera,z:tr.next.camera.z*mix(.08,1,s)});}
      else{this.drawScene(tr.old,1-s,{...tr.old.camera,z:tr.old.camera.z*mix(1,.08,s)});this.drawScene(tr.next,s,{x:mix(a.x,tr.next.camera.x,s),y:mix(a.y,tr.next.camera.y,s),z:tr.next.camera.z*mix(8,1,s)});}
      if(t===1){this.transition=null;tr.done();}
    }else if(this.node){this.drawScene({node:this.node,points:this.points,camera:this.camera});this.positionLabels();}
    this.field.foreground(c,this.camera,this.pointer);
    this.raf=requestAnimationFrame(this.frame);
  }
}
