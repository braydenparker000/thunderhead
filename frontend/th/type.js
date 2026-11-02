const half=(/** @type {number} */ n)=>Math.round(n*2)/2;
/** Lab size axis. */
export function ramp({ base=15, ratio=1.2, heroMax=46, snapOffRamp=true, text='m' }={}) {
 const sizes=[-2,-1,-1,0,0,0,1,2,3,4,5,5].map(n=>half(base*ratio**n));
 sizes[4]=Math.max(16, sizes[4]); sizes[5]=half(base*1.1);
 const names='label small chip body input reply strong section heading page-title title big'.split(' ');
 const out=Object.fromEntries(names.map((n,i)=>[`--fs-${n}`, `${sizes[i]}px`]));
 for (const n of [10.5,11,11.5,12.5,13.5,14.5,15.5,18,18.5,22,28,64]) {
  const v=snapOffRamp&&n!==64?sizes.reduce((a,b)=>Math.abs(b-n)<Math.abs(a-n)?b:a):n;
  out[`--fs-x-${String(n).replace('.','-')}`]=`${v}px`;
 }
 const b=base*(text==='s'?.93:text==='l'?1.12:1);
 return {...out, '--fs-input':`${Math.max(16,half(b))}px`, '--fs-reply':`${half(b*1.1)}px`, '--fs-hero':`clamp(${sizes[10]}px,11vw,${heroMax}px)`, '--fs-x-not-found':'clamp(32px,9vw,40px)', '--fs-rel-code':'.84em', '--fs-rel-marker':'.88em', '--fs-rel-heading':'1.06em', '--fs-ask':'16px'};
}
/** Density axis. */
export function density(factor=1) {
 const f=Math.max(.9,Math.min(1.1,factor));
 return Object.fromEntries('flat:1 dense:1.1 snug:1.25 tight:1.3 compact:1.35 body:1.4 card:1.42 reading:1.45 loose:1.5 reply:1.55 badge:1.6 tall:2 hero:1.06 big:1.05 title:1.12 page-title:1.15 ask:22px'.split(' ').map(s=>{
  const [n,v]=s.split(':');
  return [`--lh-${n}`, n==='flat'||n==='ask'?v:String(Number((Number(v)*f).toFixed(4)))];
 }));
}
