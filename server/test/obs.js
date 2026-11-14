/* Page OBS (obs.html) : le script de la page est extrait puis exécuté dans un faux navigateur
   (faux WebSocket, faux WebRTC, faux minuteurs). On vérifie ce dont dépend le direct :
   adresse et code envoyés au PC, reconnexions, « à l'antenne », écran d'attente, réglages d'adresse. */
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/obs.html'),'utf8');
const script=html.slice(html.lastIndexOf('<script>')+8,html.lastIndexOf('</script>'));
assert(script.includes('function connect()'),'script de la page introuvable');
const tick=async(n=6)=>{for(let i=0;i<n;i++)await new Promise(r=>setImmediate(r))};

function load(search='',extra={}){
  const el=()=>({style:{},textContent:'',volume:1,srcObject:undefined,play:()=>Promise.resolve(),pause(){},
    classList:{set:new Set(),add(c){this.set.add(c)},remove(c){this.set.delete(c)},contains(c){return this.set.has(c)}}});
  const b={sockets:[],pcs:[],timers:[],intervals:[],listeners:{}};
  class WS{constructor(url){this.url=url;this.readyState=0;this.sent=[];b.sockets.push(this)}
    send(s){this.sent.push(JSON.parse(s))}
    open(){this.readyState=1;this.onopen&&this.onopen()}
    drop(code){this.readyState=3;this.onclose&&this.onclose({code})}
    say(m){this.onmessage({data:JSON.stringify(m)})}}
  class PC{constructor(cfg){this.cfg=cfg;this.connectionState='new';this.closed=false;this.cands=[];this.stats=new Map();b.pcs.push(this)}
    async setRemoteDescription(d){this.remote=d}
    async createAnswer(){return{type:'answer',sdp:'ANSWER'}}
    async setLocalDescription(d){this.local=d}
    async addIceCandidate(c){this.cands.push(c)}
    close(){this.closed=true;this.connectionState='closed'}
    async getStats(){return this.stats}}
  const ctx={URLSearchParams,console,location:{search,protocol:'http:',host:'localhost:3000'},
    v:el(),msg:el(),w:el(),wv:el(),wtt:el(),wtd:el(),wts:el(),dbg:el(),WebSocket:WS,RTCPeerConnection:PC,
    setTimeout:(f,ms)=>{b.timers.push({f,ms});return b.timers.length},clearTimeout(){},
    setInterval:(f,ms)=>{b.intervals.push({f,ms});return b.intervals.length},
    addEventListener:(t,f)=>{(b.listeners[t]=b.listeners[t]||[]).push(f)},...extra};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(script,ctx);
  b.ctx=ctx;b.ev=code=>vm.runInContext(code,ctx);b.sock=()=>b.sockets[b.sockets.length-1];
  b.interval=ms=>b.intervals.find(i=>i.ms===ms).f;
  b.obs=active=>b.listeners.obsSourceActiveChanged.forEach(f=>f({detail:{active}}));
  b.report=(n,more={})=>{const pc=b.pcs[b.pcs.length-1];pc.stats=new Map([['v',{type:'inbound-rtp',kind:'video',framesDecoded:n,frameWidth:1280,frameHeight:720,
    framesPerSecond:30,jitter:.002,jitterBufferDelay:1,jitterBufferEmittedCount:10,framesDropped:0,packetsLost:0,...more}]])};
  return b;
}
const lastTypes=(s,n)=>s.sent.slice(-n).map(m=>m.type+':'+(m.value===undefined?'':m.value));

(async()=>{
  /* 1) ce que la page annonce au PC en arrivant : rôle OBS, caméra choisie, code, identifiant */
  let b=load(),s=b.sock();
  assert.strictEqual(s.url,'ws://localhost:3000/ws');s.open();
  let j=s.sent[0];
  assert.strictEqual(j.type,'join');assert.strictEqual(j.role,'viewer');assert.strictEqual(j.room,'main');assert.strictEqual(j.code,'');
  assert(typeof j.id==='string'&&j.id.length>8,'identifiant de page');assert.strictEqual(j.active,false);assert.strictEqual(j.onair,false);
  b=load('?room=cam2&code=123456');b.sock().open();j=b.sock().sent[0];
  assert.strictEqual(j.room,'cam2','caméra 2 : ?room=cam2');assert.strictEqual(j.code,'123456','code d\'appairage : ?code=…');

  /* 2) réglages d'adresse : tampon anti-saccades et volume */
  assert.strictEqual(load().ev('DELAY'),250,'tampon par défaut : 250 ms');
  assert.strictEqual(load('?delay=150').ev('DELAY'),150);assert.strictEqual(load('?delay=400').ev('DELAY'),400);assert.strictEqual(load('?delay=-5').ev('DELAY'),0);
  assert.strictEqual(load().ctx.v.volume,1,'volume par défaut : 1');
  assert.strictEqual(load('?vol=0.6').ctx.v.volume,0.6);assert.strictEqual(load('?vol=5').ctx.v.volume,1,'volume borné à 1');assert.strictEqual(load('?vol=0').ctx.v.volume,0);

  /* 3) coupures et refus : chaque code de fermeture a sa réaction */
  b=load();s=b.sock();s.open();
  let n=b.timers.length;s.drop(1006);
  assert.strictEqual(b.timers.length,n+1);assert.strictEqual(b.timers[n].ms,1000,'coupure ordinaire : reconnexion après 1 s');
  b.timers[n].f();assert.strictEqual(b.sockets.length,2,'nouvelle connexion ouverte');
  b.sock().open();assert.strictEqual(b.ctx.msg.style.display,'none','connexion rétablie : plus de message');
  n=b.timers.length;s.drop(1006);assert.strictEqual(b.timers.length,n,'une ancienne connexion qui se ferme est ignorée');
  n=b.timers.length;b.sock().drop(4000);assert.strictEqual(b.timers.length,n,'4000 (remplacée par cette même page) : pas de reconnexion');
  b=load();b.sock().open();n=b.timers.length;b.sock().drop(4001);
  assert(/déjà reçue/.test(b.ctx.msg.textContent)&&b.ctx.msg.style.display==='block','place prise : message rouge');
  assert.strictEqual(b.timers[n].ms,3000,'place prise : on attend 3 s puis on réessaie, sans chasser personne');
  b=load();b.sock().open();n=b.timers.length;b.sock().drop(4003);
  assert(/code d'appairage/.test(b.ctx.msg.textContent),'code refusé : message');assert.strictEqual(b.timers[n].ms,10000,'code refusé : nouvel essai après 10 s');

  /* 4) négociation vidéo : réponse, candidats, tampon de réception, remplacement d'une ancienne liaison */
  b=load();s=b.sock();s.open();
  s.say({type:'offer',sdp:'OFFER'});await tick();
  let pc=b.pcs[0];
  assert.strictEqual(JSON.stringify(pc.cfg),'{"iceServers":[]}','réseau local : aucun serveur externe');assert.strictEqual(pc.remote.sdp,'OFFER');
  assert.deepStrictEqual(s.sent[s.sent.length-1],{type:'answer',sdp:'ANSWER'},'réponse envoyée à la caméra');
  const before=s.sent.length;pc.onicecandidate({candidate:null});assert.strictEqual(s.sent.length,before,'fin des candidats : rien à envoyer');
  pc.onicecandidate({candidate:{c:1}});assert.deepStrictEqual(s.sent[s.sent.length-1],{type:'candidate',candidate:{c:1}});
  s.say({type:'candidate',candidate:{c:2}});await tick();assert.strictEqual(JSON.stringify(pc.cands),'[{"c":2}]');
  const rcv={},st={};pc.ontrack({receiver:rcv,streams:[st]});
  assert.strictEqual(rcv.jitterBufferTarget,250);assert.strictEqual(rcv.playoutDelayHint,0.25);assert.strictEqual(b.ctx.v.srcObject,st,'image branchée sur la vidéo');
  s.say({type:'offer',sdp:'OFFER2'});await tick();
  assert(pc.closed,'ancienne liaison fermée');assert.strictEqual(b.pcs.length,2);assert.strictEqual(b.pcs[1].remote.sdp,'OFFER2');
  b=load('?delay=150');b.sock().open();b.sock().say({type:'offer',sdp:'O'});await tick();
  const r2={};b.pcs[0].ontrack({receiver:r2,streams:[{}]});assert.strictEqual(r2.jitterBufferTarget,150);assert.strictEqual(r2.playoutDelayHint,0.15,'?delay=150 appliqué à la réception');

  /* 5) « à l'antenne » : seulement si l'image est reçue ET que la source est dans le programme d'OBS */
  b=load();s=b.sock();s.open();s.say({type:'offer',sdp:'O'});await tick();pc=b.pcs[0];
  b.obs(true);assert.deepStrictEqual(lastTypes(s,1),['onair:false'],'liaison pas encore établie : pas à l\'antenne');
  pc.connectionState='connected';pc.onconnectionstatechange();
  assert.deepStrictEqual(lastTypes(s,2),['active:true','onair:true'],'image reçue et source active : à l\'antenne');
  b.obs(false);assert.deepStrictEqual(lastTypes(s,1),['onair:false'],'source sortie du programme : plus à l\'antenne');
  b.obs(true);assert.deepStrictEqual(lastTypes(s,1),['onair:true']);
  /* ancienne méthode d'OBS (onActiveChange) */
  b=load('',{obsstudio:{}});b.sock().open();b.sock().say({type:'offer',sdp:'O'});await tick();b.pcs[0].connectionState='connected';b.pcs[0].onconnectionstatechange();
  b.ctx.obsstudio.onActiveChange(false);assert.deepStrictEqual(lastTypes(b.sock(),1),['onair:false']);
  /* après une coupure Wi-Fi, la page se réannonce comme déjà en ligne et à l'antenne */
  b=load();s=b.sock();s.open();s.say({type:'offer',sdp:'O'});await tick();b.pcs[0].connectionState='connected';b.pcs[0].onconnectionstatechange();
  const n2=b.timers.length;s.drop(1006);b.timers[n2].f();b.sock().open();
  j=b.sock().sent[0];assert.strictEqual(j.active,true,'se réannonce active');assert.strictEqual(j.onair,true,'se réannonce à l\'antenne');
  /* la caméra part : l'image est coupée et le PC est prévenu */
  b=load();s=b.sock();s.open();s.say({type:'offer',sdp:'O'});await tick();pc=b.pcs[0];pc.connectionState='connected';pc.onconnectionstatechange();
  s.say({type:'publisher-left'});await tick();
  assert(pc.closed);assert.strictEqual(b.ctx.v.srcObject,null);assert.deepStrictEqual(lastTypes(s,2),['active:false','onair:false']);

  /* 6) écran d'attente : texte selon l'état, disparition quand l'image avance, retour quand elle se fige */
  b=load();const render=b.interval(500),stats=b.interval(1000);
  render();assert.strictEqual(b.ev('wstate()'),'wait');assert.strictEqual(b.ctx.wtt.textContent,'En attente de la caméra');
  assert(!b.ctx.w.classList.contains('hide'),'écran d\'attente visible');
  let c3=load('?room=cam3');c3.interval(500)();assert.strictEqual(c3.ctx.wtt.textContent,'En attente de la caméra 3');
  b.sock().open();b.sock().say({type:'offer',sdp:'O'});await tick();pc=b.pcs[0];render();
  assert.strictEqual(b.ev('wstate()'),'connect');assert.strictEqual(b.ctx.wtt.textContent,'Connexion de la caméra…');
  pc.connectionState='connected';pc.onconnectionstatechange();
  assert.strictEqual(b.ev('wstate()'),'load');assert.strictEqual(b.ctx.wtt.textContent,'Chargement de l\'image…');
  b.report(10);await stats();
  assert.strictEqual(b.ev('wstate()'),'','images qui avancent : l\'écran d\'attente s\'efface');assert(b.ctx.w.classList.contains('hide'));
  const vs=b.sock().sent.filter(m=>m.type==='vstats').pop();
  assert.deepStrictEqual([vs.res,vs.fps,vs.jitter,vs.buf,vs.dropped,vs.lost],['1280×720',30,2,100,0,0],'mesures de réception envoyées au PC');
  b.report(10);await stats();assert.strictEqual(b.ev('wstate()'),'','une seconde sans image : on attend encore');
  b.report(10);await stats();
  assert.strictEqual(b.ev('wstate()'),'frozen','deux secondes sans image : image figée');assert(!b.ctx.w.classList.contains('hide'),'l\'écran d\'attente revient');
  assert.strictEqual(b.ctx.wtt.textContent,'Image interrompue : reprise en cours…');
  b.report(25);await stats();assert.strictEqual(b.ev('wstate()'),'','l\'image repart : l\'écran d\'attente s\'efface');
  pc.connectionState='disconnected';pc.onconnectionstatechange();
  assert.strictEqual(b.ctx.wtt.textContent,'Connexion perdue : reconnexion…','liaison coupée après avoir diffusé');
  const idle=load();await idle.interval(1000)();assert.strictEqual(idle.sock().sent.length,0,'sans liaison : aucune mesure envoyée');
  console.log('OK page OBS (adresse, code, reconnexions, à l\'antenne, écran d\'attente)');
})().catch(e=>{console.error('ÉCHEC',e);process.exit(1)});
