/* Logique de la page téléphone (phone.html) : débit, adaptation de qualité, alertes chaleur/batterie.
   Les fonctions sont extraites de la page puis exécutées telles quelles. */
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/phone.html'),'utf8');
const slice=(a,b)=>{const i=html.indexOf(a),j=html.indexOf(b,i);assert(i>=0&&j>i,'repère introuvable : '+a);return html.slice(i,j)};
const ctx={BR:{480:2e6,720:5e6,1080:8e6},prio:'fluid',lvl:0,okSince:0,lastAdapt:0,netBad:0,upWait:15000,lastUp:0,calls:[],pc:{connectionState:'connected'},
  $:id=>({value:id==='prio'?ctx.prio:'720'})};
vm.createContext(ctx);
vm.runInContext(slice('function tune(sdp){','async function offer(){'),ctx);
vm.runInContext(slice('const LV=','setInterval(async()=>{').replace(/async function setLevel[\s\S]*?\n}\n/,'async function setLevel(n){lvl=n;calls.push(n)}\n'),ctx);

/* 1) débit : plancher et départ élevés, audio et RTX intacts, idempotent */
const sdp=['v=0','m=audio 9 UDP/TLS/RTP/SAVPF 111','a=rtpmap:111 opus/48000/2','a=fmtp:111 minptime=10','m=video 9 UDP/TLS/RTP/SAVPF 96 97 102','a=rtpmap:96 VP8/90000','a=rtpmap:97 rtx/90000','a=fmtp:97 apt=96','a=rtpmap:102 H264/90000','a=fmtp:102 packetization-mode=1',''].join('\r\n');
const out=ctx.tune(sdp);
assert(out.includes('a=fmtp:96 x-google-min-bitrate=1750;x-google-start-bitrate=4000;x-google-max-bitrate=5000'),'VP8 : débit imposé');
assert(out.includes('a=fmtp:102 packetization-mode=1;x-google-min-bitrate=1750'),'H.264 : débit imposé');
assert(out.includes('a=fmtp:111 minptime=10\r\n')&&out.includes('a=fmtp:97 apt=96\r\n'),'audio et RTX inchangés');
assert.strictEqual(ctx.tune(out),out,'idempotent');assert.strictEqual(ctx.tune('v=0\r\nm=audio 9 X 111\r\n'),'v=0\r\nm=audio 9 X 111\r\n','sans vidéo : inchangé');

/* 2) alertes du téléphone */
assert.strictEqual(ctx.hwWarn({}),'');assert.strictEqual(ctx.hwWarn({thermal:0,battery:80,charging:false}),'');
assert(/trop chaud/.test(ctx.hwWarn({thermal:3})));assert(/chauffe/.test(ctx.hwWarn({thermal:2})));
assert(/Batterie faible \(15 %\)/.test(ctx.hwWarn({battery:15,charging:false})));assert.strictEqual(ctx.hwWarn({battery:15,charging:true}),'','en charge : pas d\'alerte');

/* 3) adaptation de qualité (mode fluidité) et mode netteté */
const run=plan=>{ctx.lvl=0;ctx.okSince=0;ctx.lastAdapt=0;ctx.netBad=0;ctx.upWait=15000;ctx.lastUp=0;ctx.calls.length=0;let t=1e6,ev=[];
  plan.forEach(net=>{t+=1000;ctx.netBad=net?ctx.netBad+1:0;const b=ctx.lvl;ctx.adapt(net,ctx.netBad,t);if(ctx.lvl!==b)ev.push([b,ctx.lvl])});return ev};
const rep=(n,v)=>Array(n).fill(v);
ctx.prio='fluid';
assert.deepStrictEqual(run([...rep(30,false),...rep(3,true),...rep(60,false)]),[],'une coupure de 3 s ne change rien');
let ev=run([...rep(30,false),...rep(20,true),...rep(120,false)]);
assert.deepStrictEqual(ev,[[0,1],[1,2],[2,1],[1,0]],'baisse puis remontée par paliers');
ev=run([...rep(20,false),...rep(8,true),...rep(18,false),...rep(8,true),...rep(40,false),...rep(8,true),...rep(200,false)]);
assert(ev.filter(e=>e[1]>e[0]).length<=4,'pas de yo-yo');
assert(!ev.some(e=>e[1]>2),'jamais plus bas que le niveau 2 (~480p)');
ctx.prio='sharp';
assert.deepStrictEqual(run([...rep(30,false),...rep(60,true),...rep(60,false)]),[],'mode netteté : la définition et le débit ne baissent jamais');
console.log('OK page téléphone (débit, adaptation, netteté, alertes)');
/* 4) ordres venant du PC : chaque valeur est revérifiée, enregistrée comme un réglage local, et seuls les réglages vidéo modifiés déclenchent une application */
{
  const el={q:{value:'720'},codec:{value:'h264'},prio:{value:'sharp'},fluid:{value:'off'},mvol:{value:'50'},mvo:{textContent:'50'}};
  const log=[],applied=[];
  const c2={$:id=>el[id],localStorage:{},muted:false,applied,log,applyGain(){log.push('gain')},setMuted(v){c2.muted=v;log.push('muted:'+v)},
    async setTorch(v){log.push('torch:'+v)},setZoom(v){log.push('zoom:'+v)},async applyChanges(k){applied.push(k.join(','))},reportSet(){log.push('report')}};
  vm.createContext(c2);vm.runInContext(slice('async function applySet(s){','/* Rapport au PC'),c2);
  (async()=>{
    await c2.applySet({q:1080,codec:'vp8',prio:'fluid',fluid:'on',mvol:35,muted:true,torch:true,zoom:3});
    assert.strictEqual(el.q.value,'1080');assert.strictEqual(el.codec.value,'vp8');assert.strictEqual(el.prio.value,'fluid');assert.strictEqual(el.fluid.value,'on');
    assert.strictEqual(el.mvol.value,35);assert.strictEqual(c2.localStorage.q,'1080','réglage enregistré comme un réglage local');assert.strictEqual(c2.localStorage.mvol,35);
    assert.deepStrictEqual(c2.applied,['q,codec,prio,fluid'],'les 4 réglages vidéo modifiés sont appliqués');
    assert(c2.log.includes('muted:true')&&c2.log.includes('torch:true')&&c2.log.includes('zoom:3'),'micro, flash et zoom appliqués');
    /* valeurs fausses : rien ne change */
    c2.applied.length=0;c2.log.length=0;
    await c2.applySet({q:999,codec:'av1',prio:'x',fluid:'zzz',mvol:500,muted:'oui',torch:'oui',zoom:'3'});
    assert.strictEqual(el.q.value,'1080');assert.strictEqual(el.codec.value,'vp8');assert.strictEqual(el.mvol.value,35);
    assert.deepStrictEqual(c2.applied,[''],'rien à appliquer');assert(!c2.log.some(x=>/muted|torch|zoom|gain/.test(x)),'rien n\'est appliqué sur des valeurs fausses');
    /* même valeur qu'actuellement : pas de redémarrage inutile de la caméra */
    c2.applied.length=0;await c2.applySet({q:1080,codec:'vp8'});assert.deepStrictEqual(c2.applied,[''],'valeur identique : aucune coupure');
    await c2.applySet(null);await c2.applySet('x');
    console.log('OK ordres du PC (vérification, enregistrement, pas de coupure inutile)');
  })().catch(e=>{console.error(e);process.exit(1)});
}

