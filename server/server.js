const express=require('express'),http=require('http'),os=require('os'),path=require('path'),fs=require('fs'),crypto=require('crypto');
const {WebSocketServer}=require('ws');
const {isLocalAddr,hostOk,originOk,localRequestOk}=require('./security');
const {createJournal,cleanClientLog,summarize,evaluateDevice}=require('./journal');
const {scanPC,fromPhone,mergeNetworks}=require('./wifi');
const RELAY=new Set(['offer','answer','candidate']);
const NUM=['cam','fps','cfps','mbps','rtt','loss','sec','q','rssi','link','freq','battery','thermal','jitter','buf','dropped','lost'],
  STR=['res','codec','limit','level','diag','ssid'],BOOL=['muted','charging'];
/* Ne garde que les champs connus, avec des types simples (les statistiques viennent du réseau) */
const clean=m=>{const o={};
  for(const k of NUM)if(typeof m[k]==='number'&&isFinite(m[k]))o[k]=m[k];
  for(const k of STR)if(typeof m[k]==='string')o[k]=m[k].replace(/[<>&"'`]/g,'').slice(0,200);
  for(const k of BOOL)if(typeof m[k]==='boolean')o[k]=m[k];
  if(o.ssid)o.ssid=o.ssid.slice(0,32);
  o.t=Date.now();return o};
/* Réglages du téléphone modifiables depuis le PC. Valeurs strictement vérifiées : le PC les envoie, le téléphone les revérifie. */
const SETK={q:[480,720,1080],prio:['sharp','fluid'],fluid:['off','on','max'],codec:['auto','h264','vp8']};
const num=(v,a,b)=>typeof v==='number'&&isFinite(v)&&v>=a&&v<=b;
function cleanSet(m){const o={};if(!m||typeof m!=='object')return o;
  if(SETK.q.includes(m.q))o.q=m.q;
  for(const k of['prio','fluid','codec'])if(SETK[k].includes(m[k]))o[k]=m[k];
  if(Number.isInteger(m.mvol)&&m.mvol>=0&&m.mvol<=100)o.mvol=m.mvol;
  for(const k of['muted','torch'])if(typeof m[k]==='boolean')o[k]=m[k];
  if(num(m.zoom,0,100))o.zoom=m.zoom;
  return o}
/* Rapport du téléphone : ses réglages actuels et ce que sa caméra sait faire (flash, plage de zoom) */
function cleanRep(m){const o=cleanSet(m);
  for(const k of['zmin','zmax','zstep'])if(num(m[k],0,1000))o[k]=m[k];
  if(typeof m.ctorch==='boolean')o.ctorch=m.ctorch;
  o.t=Date.now();return o}
/* Code d'appairage (6 chiffres) : sans lui, n'importe quel appareil du Wi-Fi pourrait se faire passer pour une caméra ou pour OBS.
   Il est créé une fois, enregistré dans le dossier de données du PC et affiché dans la fenêtre TPR Live.
   Désactivable avec la variable d'environnement TPR_NO_PIN=1. Le PC lui-même (127.0.0.1, donc OBS) n'en a pas besoin. */
function loadPin(dir){
  if(process.env.TPR_NO_PIN==='1')return null;
  const f=path.join(dir||process.env.TPR_DATA||path.join(os.homedir(),'.tpr-live'),'pin.txt');
  try{const p=fs.readFileSync(f,'utf8').trim();if(/^\d{6}$/.test(p))return p}catch{}
  const p=String(crypto.randomInt(0,1000000)).padStart(6,'0');
  try{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,p)}catch{}
  return p;
}
let lastCpu=null;
const cpuPct=()=>{const c=os.cpus().reduce((a,x)=>{for(const k in x.times)a.t+=x.times[k];a.i+=x.times.idle;return a},{t:0,i:0});
  let p=0;if(lastCpu){const dt=c.t-lastCpu.t,di=c.i-lastCpu.i;p=dt>0?Math.round(100*(1-di/dt)):0}lastCpu=c;return p};
function createServer(opts={}){
  /* grace : délai avant d'annoncer un départ. Une coupure WebSocket brève (Wi-Fi) ne doit pas casser le flux vidéo. */
  const GRACE=opts.grace??4000;
  /* Journal du direct : actif seulement si un dossier de données est fourni (application PC, ou lancement direct du serveur) */
  const J=opts.dataDir&&opts.journal!==false&&process.env.TPR_NO_JOURNAL!=='1'?createJournal(opts.dataDir):null;
  const jlog=(ev,d,t)=>{if(J)J.log(ev,d,t)};
  jlog('server-start',{node:process.version});
  const PIN=opts.pin||null,fails=new Map();   /* échecs de code par adresse : au-delà de 10, blocage d'une minute */
  const app=express();
  /* Le téléphone (origine http://localhost dans l'APK) doit pouvoir lire la version de l'APK proposée par le PC */
  app.get('/apk-version.json',(q,r,n)=>{r.set({'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'});n()});
  /* Caméras IP (dômes PTZ) : commande ONVIF + image dans la fenêtre du PC (réservé à 127.0.0.1) */
  const cams=opts.cameras===false?null:require('./camera').mount(app,express,{dataDir:opts.dataDir,cipher:opts.cipher});
  app.use(express.static(path.join(__dirname,'public')));
  const srv=http.createServer(app),wss=new WebSocketServer({server:srv,path:'/ws',maxPayload:1<<17,
    /* Refuse les pages d'autres sites (détournement depuis un navigateur du PC) et le DNS rebinding */
    verifyClient:({req})=>{const local=isLocalAddr(req.socket.remoteAddress);
      return originOk(req.headers.origin,req.headers.host,local)&&(!local||hostOk(req.headers.host))}});
  const rooms=new Map();
  const live=w=>!!w&&w.readyState===1;
  /* Espace libre du disque où TPR Live range ses données (relu au plus toutes les 30 s) */
  let disk=null,diskAt=0;
  const readDisk=()=>{if(Date.now()-diskAt<30000)return;diskAt=Date.now();try{fs.statfs(opts.dataDir||os.homedir(),(e,st)=>{if(!e&&st)disk={free:st.bavail*st.bsize,total:st.blocks*st.bsize}})}catch{}};
  /* Fait clignoter la fenêtre dans la barre des tâches (alertes critiques). Réservé au PC lui-même. */
  app.post('/api/flash',(q,r)=>{
    if(!localRequestOk(q))return r.status(403).json({ok:false,error:'Réservé au PC qui exécute TPR Live.'});
    try{opts.onFlash&&opts.onFlash()}catch{}
    r.json({ok:true})});
  app.get('/info',(q,r)=>{
    /* Un appareil du réseau ne voit que ce qu'il faut pour retrouver le PC (la recherche automatique du téléphone) */
    if(!isLocalAddr(q.socket.remoteAddress)||!hostOk(q.headers.host)||!originOk(q.headers.origin,q.headers.host,true))return r.json({app:'tpr-live',name:os.hostname().replace(/[^\w .-]/g,'').slice(0,40)||'PC',pin:!!PIN});
    const port=srv.address().port,ips=[];
    for(const l of Object.values(os.networkInterfaces()))for(const i of l)if(i.family==='IPv4'&&!i.internal)ips.push(i.address+':'+port);
    const all=[...rooms.values()];
    r.json({app:'tpr-live',pin:PIN,name:os.hostname().replace(/[^\w .-]/g,'').slice(0,40)||'PC',obs:'http://localhost:'+port+'/obs.html',addresses:ips,viewers:all.filter(x=>live(x.viewer)).length,publishers:all.filter(x=>live(x.publisher)).length,
      cpu:cpuPct(),disk:(readDisk(),disk),
      rooms:[...rooms.entries()].map(([k,x])=>({room:k,publisher:live(x.publisher),viewer:live(x.viewer),onair:live(x.viewer)&&!!x.onair,
        settings:x.settings?{...x.settings,age:Date.now()-x.settings.t}:null,stats:x.stats?{...x.stats,age:Date.now()-x.stats.t}:null,vstats:x.vstats?{...x.vstats,age:Date.now()-x.vstats.t}:null,
        wifi:x.stats?{band:typeof x.stats.freq==='number'&&x.stats.freq>0?(x.stats.freq<3000?'2,4':'5'):null,ssid:x.stats.ssid||null,link:x.stats.link==null?null:x.stats.link,trouble:!!x.w24,guess:!!x.w24guess,since:x.w24at||null,noticed:x.noticeAt||null}:null,
        test:x.test?{running:!x.test.result,elapsed:Math.min(Date.now()-x.test.t0,x.test.dur),dur:x.test.dur,drops:x.test.drops,result:x.test.result}:null}))});});
  const send=(w,m)=>live(w)&&w.send(JSON.stringify(m));
  /* Réglages envoyés par la fenêtre du PC à un téléphone. Réservé au PC lui-même (même protection que les caméras IP). */
  app.post('/api/phone/:room/set',express.json({limit:'2kb'}),(q,r)=>{
    if(!localRequestOk(q))return r.status(403).json({ok:false,error:'Réservé au PC qui exécute TPR Live.'});
    const x=rooms.get(String(q.params.room).slice(0,64)),set=cleanSet(q.body&&q.body.set);
    if(!Object.keys(set).length)return r.status(400).json({ok:false,error:'Réglage invalide.'});
    if(!x||!live(x.publisher))return r.status(404).json({ok:false,error:'Téléphone non connecté.'});
    if(!x.settings)return r.status(409).json({ok:false,error:'Ce téléphone doit être mis à jour pour être réglé depuis le PC.'});
    send(x.publisher,{type:'set',set});jlog('remote-set',{room:String(q.params.room).slice(0,64),...set});r.json({ok:true,sent:set})});
  app.use('/api/phone',(e,q,r,n)=>r.status(400).json({ok:false,error:'Requête illisible.'}));
  /* « Prévenir le téléphone » : affiche sur son écran la demande de passer au Wi-Fi 5 GHz. Android ne permet pas de changer le Wi-Fi à distance. */
  app.post('/api/notice/:room',express.json({limit:'1kb'}),(q,r)=>{
    if(!localRequestOk(q))return r.status(403).json({ok:false,error:'Réservé au PC qui exécute TPR Live.'});
    const room=String(q.params.room).slice(0,64),x=rooms.get(room);
    if(!x||!live(x.publisher))return r.status(404).json({ok:false,error:'Téléphone non connecté.'});
    const net5=q.body&&typeof q.body.net5==='string'?q.body.net5.replace(/[<>&"'`]/g,'').trim().slice(0,32):'';   /* nom du réseau 5 GHz saisi sur le PC */
    send(x.publisher,{type:'notice',kind:'wifi5',net5});x.noticeAt=Date.now();jlog('notice-sent',{room,kind:'wifi5',ip:x.publisher._ip,net5});r.json({ok:true})});
  app.use('/api/notice',(e,q,r,n)=>r.status(400).json({ok:false,error:'Requête illisible.'}));
  /* Recherche des réseaux Wi-Fi à choisir dans une liste (au lieu de les taper). D'abord le PC ; s'il ne voit aucun réseau (câble, pas de carte Wi-Fi),
     on demande aux téléphones en direct de chercher. Réservé au PC lui-même. */
  const scans=new Set();
  const askPhones=ms=>new Promise(res=>{
    const targets=[...rooms.values()].map(x=>x.publisher).filter(live);
    if(!targets.length)return res({asked:0,list:[],unsupported:0});
    const job={need:new Set(targets),list:[],unsupported:0};
    const done=()=>{clearTimeout(t);scans.delete(job);res({asked:targets.length,list:job.list,unsupported:job.unsupported})};
    const t=setTimeout(done,ms);job.done=done;scans.add(job);
    for(const w of targets)send(w,{type:'wifiscan'});
  });
  app.get('/api/wifi/scan',async(q,r)=>{
    if(!localRequestOk(q))return r.status(403).json({ok:false,error:'Réservé au PC qui exécute TPR Live.'});
    r.set('Cache-Control','no-store');
    let nets=[],source=null,note='';
    try{nets=await(opts.wifiScan||scanPC)()}catch{nets=[]}
    if(nets.length)source='pc';
    else{
      const p=await askPhones(opts.wifiPhoneMs||7000);
      nets=mergeNetworks(p.list);
      if(nets.length)source='phone';
      else if(!p.asked)note='Ce PC ne voit aucun réseau Wi-Fi (câble réseau ou pas de carte Wi-Fi). Démarrez le direct sur un téléphone puis relancez la recherche : c\'est le téléphone qui cherchera les réseaux. Vous pouvez aussi saisir le nom à la main.';
      else if(p.unsupported>=p.asked)note='Le téléphone doit être mis à jour pour chercher les réseaux Wi-Fi.';
      else note='Le téléphone n\'a trouvé aucun réseau. Vérifiez que la localisation du téléphone est activée et que l\'autorisation « Position précise » est accordée à TPR Live (la position n\'est jamais lue : Android l\'exige pour lister les réseaux).';
    }
    jlog('wifi-scan',{source,n:nets.length});
    r.json({ok:true,source,networks:nets,note})});
  /* Test d'aptitude d'un téléphone : 5 minutes de mesures puis un verdict. Réservé au PC lui-même. */
  app.post('/api/test/:room/:action',express.json({limit:'1kb'}),(q,r)=>{
    if(!localRequestOk(q))return r.status(403).json({ok:false,error:'Réservé au PC qui exécute TPR Live.'});
    const room=String(q.params.room).slice(0,64),x=rooms.get(room);
    if(q.params.action==='start'){
      if(!x||!live(x.publisher))return r.status(404).json({ok:false,error:'Téléphone non connecté.'});
      const mins=q.body&&[5,10].includes(+q.body.minutes)?+q.body.minutes:5;   /* test rapide (5 min) ou complet (10 min) */
      x.test={t0:Date.now(),dur:opts.testMs||mins*60000,snaps:[],drops:0,result:null,ip:x.publisher._ip,ipChanges:0,speed:null,id:String(x.publisher.cid||'').slice(0,6)};
      jlog('test-start',{room,ip:x.publisher._ip,id:x.test.id});
      /* quelques secondes après le début (période non comptée), le téléphone envoie ~1 Mo en rafale : débit réel du Wi-Fi vers le PC, sans vidéo */
      setTimeout(()=>{if(x.test&&!x.test.result&&live(x.publisher))send(x.publisher,{type:'speedtest'})},Math.min(5000,Math.floor(x.test.dur/10)));
      return r.json({ok:true})}
    if(q.params.action==='stop'){
      if(!x||!x.test)return r.status(404).json({ok:false,error:'Aucun test en cours.'});
      finishTest(room,x);return r.json({ok:true})}
    r.status(400).json({ok:false,error:'Action inconnue.'})});
  app.use('/api/test',(e,q,r,n)=>r.status(400).json({ok:false,error:'Requête illisible.'}));
  /* Journal : résumé et téléchargement, réservés au PC lui-même */
  app.get('/api/journal/summary',(q,r)=>{
    if(!localRequestOk(q))return r.status(403).json({ok:false,error:'Réservé au PC qui exécute TPR Live.'});
    if(!J)return r.json({ok:true,text:'Le journal est désactivé.',files:0});
    const days=Math.min(30,Math.max(1,parseInt(q.query.days,10)||1)),date=String(q.query.date||'');
    r.set('Cache-Control','no-store');r.json({ok:true,files:J.files(days,date).length,text:summarize(J.read(days,date)).text})});
  app.get('/api/journal/download',(q,r)=>{
    if(!localRequestOk(q))return r.status(403).send('Réservé au PC qui exécute TPR Live.');
    if(!J)return r.status(404).send('Le journal est désactivé.');
    const days=Math.min(30,Math.max(1,parseInt(q.query.days,10)||1)),date=String(q.query.date||'');
    r.set({'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="tpr-live-journal.jsonl"','Cache-Control':'no-store'});
    const fl=J.files(days,date);let i=0;const next=()=>{if(i>=fl.length)return r.end();const st=fs.createReadStream(fl[i++]);st.on('error',next);st.on('end',next);st.pipe(r,{end:false})};next()});

  /* Détecte les connexions mortes (Wi-Fi coupé sans fermeture propre) et garde la liaison éveillée */
  const hb=setInterval(()=>{for(const w of wss.clients){if(w.dead){jlog('dead',{room:w._room,role:w._role,ip:w._ip});w.terminate();continue}w.dead=true;try{w.ping()}catch{}}},10000);
  hb.unref();
  /* Fin d'un test d'aptitude : verdict calculé sur les mesures du test, gardé en mémoire (affiché dans la fenêtre du PC) et noté dans le journal */
  const finishTest=(k,x)=>{
    if(!x.test||x.test.result)return;
    const T=x.test,d=x.device||{},m=/Android [\d.]+; ([^)]*)\)/.exec(d.ua||''),device=(m?m[1].replace(/ Build\/.*/,''):'')+(d.cores?(m?', ':'')+d.cores+' cœurs':'');
    T.result=evaluateDevice(T.snaps,{drops:T.drops,device,speed:T.speed,ipChanges:T.ipChanges});T.done=Date.now();
    const f=T.result.fig;jlog('test-result',{room:k,ip:T.ip,id:T.id,verdict:T.result.verdict,title:T.result.title,quality:f.quality,band:f.band,speed:f.speed,ckind:(T.result.cause||{}).kind,cause:(T.result.cause||{}).title,fps:f.fps,rtt:f.rtt50,loss:f.loss,bad:f.bad,drops:f.drops,model:device,why:T.result.why})};
  const snapT=setInterval(()=>{for(const [k,x] of rooms){const pub=live(x.publisher),view=live(x.viewer);
    const st=x.stats||{},vs=x.vstats||{},row={room:k,pub,view,onair:view&&!!x.onair,fps:st.fps,mbps:st.mbps,rtt:st.rtt,loss:st.loss,res:st.res,cfps:st.cfps,ssid:st.ssid,limit:st.limit,level:st.level,thermal:st.thermal,battery:st.battery,charging:st.charging,codec:st.codec,rssi:st.rssi,link:st.link,freq:st.freq,vfps:vs.fps,vdropped:vs.dropped,vlost:vs.lost,vjitter:vs.jitter,vbuf:vs.buf};
    if(J&&(pub||view))J.log('snap',row);
    /* Alerte Wi-Fi : téléphone en 2,4 GHz (ou vitesse typique du 2,4 GHz si la bande est inconnue) avec une mauvaise connexion depuis 30 s */
    const is24=typeof st.freq==='number'&&st.freq>0&&st.freq<3000,g24=typeof st.freq!=='number'&&typeof st.link==='number'&&st.link>0&&st.link<=72;
    const trouble=pub&&(is24||g24)&&(st.level==='bad'||(typeof st.rtt==='number'&&st.rtt>300)||(typeof st.fps==='number'&&st.fps<20));
    x.w24n=trouble?(x.w24n||0)+1:0;const was=!!x.w24;x.w24=x.w24n>=3;x.w24guess=x.w24&&g24;
    if(x.w24&&!was){x.w24at=Date.now();jlog('wifi24-alert',{room:k,ip:x.publisher&&x.publisher._ip,ssid:st.ssid,link:st.link,rtt:st.rtt,fps:st.fps,guess:g24})}
    if(x.test&&!x.test.result){if(pub)x.test.snaps.push({...row,t:Date.now()});if(Date.now()>=x.test.t0+x.test.dur)finishTest(k,x)}}},opts.snapMs||10000);snapT.unref();
  const hb2=setInterval(()=>{if(fails.size>500)fails.clear()},60000);hb2.unref();srv.on('close',()=>{jlog('server-stop',{});clearInterval(snapT);clearInterval(hb);clearInterval(hb2);wss.close();if(cams)cams.close()});
  /* Arrêt immédiat : tue ffmpeg (sinon il reste actif et bloque la mise à jour) et coupe les connexions */
  /* Nombre de téléphones en direct : le PC s'en sert pour demander confirmation avant de quitter et pour ne pas se mettre à jour pendant un direct */
  srv.liveCount=()=>[...rooms.values()].filter(x=>live(x.publisher)).length;
  srv.shutdown=()=>{try{if(cams)cams.close()}catch{}for(const w of wss.clients){try{w.terminate()}catch{}}try{srv.close()}catch{}if(srv.closeAllConnections)try{srv.closeAllConnections()}catch{}};
  wss.on('connection',(ws,req)=>{
    let room=null,role=null;ws.dead=false;ws._ip=req.socket.remoteAddress||'';const tConn=Date.now();
    ws.on('pong',()=>{ws.dead=false});
    ws.on('error',()=>{});
    let wStart=Date.now(),wCount=0;
    ws.on('message',d=>{
      /* Anti-inondation : un appareil qui envoie plus de 150 messages par seconde est coupé (le trafic normal en envoie une dizaine) */
      const tn=Date.now();if(tn-wStart>1000){wStart=tn;wCount=0}
      if(++wCount>150){ws.terminate();return}
      let m;try{m=JSON.parse(d)}catch{return}
      if(!m||typeof m!=='object')return;
      if(m.type==='join'){
        const nr=String(m.room||'main').slice(0,64),nrole=m.role==='publisher'?'publisher':'viewer',cid=typeof m.id==='string'?m.id.slice(0,40):'';
        /* Code d'appairage (sauf pour le PC lui-même) */
        const ip=ws._ip||'';
        if(PIN&&!isLocalAddr(ip)){
          const f=fails.get(ip)||{n:0,until:0};
          if(Date.now()<f.until){jlog('denied',{room:nr,role:nrole,ip,why:'blocked'});ws.close(4003,'blocked');return}
          if(String(m.code||'')!==PIN){if(++f.n>=10){f.until=Date.now()+60000;f.n=0}fails.set(ip,f);jlog('denied',{room:nr,role:nrole,ip,why:'code'});send(ws,{type:'denied'});ws.close(4003,'code');return}
          fails.delete(ip);
        }
        /* Place déjà prise par un autre appareil : on REFUSE le nouveau venu (4001) au lieu de couper celui qui est en ligne.
           Même appareil qui revient (même identifiant, ex. après une coupure Wi-Fi) : il reprend sa place (4000 pour l'ancienne connexion). */
        if(!rooms.has(nr)&&rooms.size>=16){ws.close(1013,'rooms');return}   /* au plus 16 caméras simultanées */
        const cur=rooms.get(nr);
        if(cur&&live(cur[nrole])&&cur[nrole]!==ws&&!(cid&&cur[nrole].cid===cid)){jlog('busy',{room:nr,role:nrole,ip});send(ws,{type:'busy'});ws.close(4001,'busy');return}
        room=nr;role=nrole;ws.cid=cid;ws._room=room;ws._role=role;
        const r=rooms.get(room)||{t:{}};rooms.set(room,r);
        if(r.t[role]){clearTimeout(r.t[role]);delete r.t[role]}   /* retour rapide : on annule l'annonce de départ */
        const old=r[role];r[role]=ws;if(old&&old!==ws)old.close(4000,'replaced');
        jlog('join',{room,role,ip,how:old&&old!==ws?'takeover':(r.t[role]===undefined&&r.seen&&r.seen[role]?'resume':'new'),id:cid.slice(0,6)});(r.seen||(r.seen={}))[role]=true;
        if(role==='publisher'&&r.test&&!r.test.result){if(r.test.ip&&r.test.ip!==ip)r.test.ipChanges=(r.test.ipChanges||0)+1;r.test.ip=ip}   /* changement d'adresse = reconnexion au Wi-Fi */  /* 4000 : remplacé par le même appareil, ne pas se reconnecter */
        if(role==='viewer'){r.active=m.active===true;r.onair=m.onair===true;send(r.publisher,{type:'viewer-joined',keep:r.active});send(r.publisher,{type:'onair',value:r.onair})}
        else{if(r.viewer)send(ws,{type:'viewer-joined',keep:!!r.active});send(ws,{type:'onair',value:live(r.viewer)&&!!r.onair})}  /* le téléphone connaît tout de suite son statut */
        return;
      }
      /* Battement de coeur applicatif : le client sait ainsi que la liaison vit (un Wi-Fi coupé sans fermeture propre ne se voit pas autrement) */
      if(m.type==='ping'){send(ws,{type:'pong'});return}
      /* Réseaux Wi-Fi vus par le téléphone, en réponse à la recherche lancée depuis la fenêtre du PC */
      if(m.type==='wifilist'){if(role==='publisher')for(const job of scans)if(job.need.delete(ws)){
        if(m.unsupported===true)job.unsupported++;else job.list.push(...fromPhone(m.list));
        if(!job.need.size)job.done()}return}
      const r=rooms.get(room);if(!r)return;
      /* OBS demande une nouvelle négociation (image absente alors que le téléphone se croit connecté) */
      if(m.type==='need-offer'){if(role==='viewer'){if(live(r.publisher)){jlog('need-offer',{room});send(r.publisher,{type:'viewer-joined',keep:false})}else send(ws,{type:'no-phone'})}return}
      if(m.type==='speed'){if(role==='publisher'){const S=r.speedRun||(r.speedRun={t0:Date.now(),first:d.length,bytes:0,n:0});S.bytes+=d.length;S.n++;S.t1=Date.now()}return}
      if(m.type==='speed-end'){if(role==='publisher'&&r.speedRun){const S=r.speedRun;r.speedRun=null;
        const ms=Math.max(1,S.t1-S.t0),mbps=S.n>1?Math.min(500,Math.round((S.bytes-S.first)*8/ms/1000*10)/10):null;   /* le premier message sert de départ : on mesure le reste */
        if(mbps!=null&&r.test&&!r.test.result)r.test.speed=mbps;
        jlog('speedtest',{room,ip:ws._ip,mbps,ms,kb:Math.round(S.bytes/1024)});send(ws,{type:'speed-result',mbps,ms})}return}
      if(m.type==='log'){for(const it of cleanClientLog(m,Date.now())){const{t,ev,...d}=it;if(J)J.log('c:'+ev,{...d,room,role},t);if(role==='publisher'&&ev==='device')r.device={ua:d.ua,cores:d.cores,ram:d.ram}}return}
      if(m.type==='active'){if(role==='viewer')r.active=!!m.value;return}
      /* « à l'antenne » : OBS dit si cette caméra est dans le programme ET reçue. Seul OBS (viewer) peut l'affirmer. */
      if(m.type==='onair'){if(role==='viewer'){r.onair=m.value===true;send(r.publisher,{type:'onair',value:r.onair})}return}
      if(m.type==='settings'){if(role==='publisher'){const n=cleanRep(m),sig=['q','prio','fluid','codec','mvol','muted'].map(k=>k+'='+n[k]).join(' ');
        if(sig!==r.sig){r.sig=sig;jlog('settings',{room,q:n.q,prio:n.prio,fluid:n.fluid,codec:n.codec,mvol:n.mvol,muted:n.muted})}   /* changement de réglage du téléphone */
        r.settings=n}return}
      if(m.type==='stats'){if(role==='publisher')r.stats=clean(m);return}
      if(m.type==='vstats'){if(role==='viewer')r.vstats=clean(m);return}
      if(!RELAY.has(m.type))return;
      send(role==='publisher'?r.viewer:r.publisher,m);
    });
    ws.on('close',code=>{
      if(room)jlog('close',{room,role,code,secs:Math.round((Date.now()-tConn)/1000)});
      const r=rooms.get(room);if(!r||r[role]!==ws)return;
      if(role==='publisher'&&r.test&&!r.test.result&&code!==4000)r.test.drops++;   /* coupure pendant un test d'aptitude */
      r[role]=null;if(role==='viewer'){r.active=false;r.onair=false;r.vstats=null}else{r.stats=null;r.settings=null}
      const other=role==='viewer'?'publisher':'viewer';
      r.t[role]=setTimeout(()=>{
        delete r.t[role];jlog('left',{room,role});
        send(r[other],{type:role==='viewer'?'viewer-left':'publisher-left'});
        if(!r.publisher&&!r.viewer&&!r.t.publisher&&!r.t.viewer)rooms.delete(room);
      },GRACE);
      r.t[role].unref();
    });
  });
  return srv;
}
module.exports={createServer,loadPin};
if(require.main===module){
  process.on('uncaughtException',e=>console.error('Erreur inattendue (le serveur continue) :',e&&e.stack||e));
  process.on('unhandledRejection',e=>console.error('Promesse rejetée (le serveur continue) :',e&&e.stack||e));
  const port=process.env.PORT||3000;
  const pin=loadPin();
  createServer({pin,dataDir:process.env.TPR_DATA||path.join(os.homedir(),'.tpr-live')}).listen(port,'0.0.0.0',()=>{
    console.log('\n=== Church Live : serveur prêt ===');
    console.log('Source OBS (Source Navigateur) : http://localhost:'+port+'/obs.html');
    console.log('Test avec la caméra du PC      : http://localhost:'+port+'/camera.html');
    if(pin)console.log("Code d'appairage à saisir sur le téléphone : "+pin);
    console.log("Adresse à saisir dans l'app Android :");
    for(const l of Object.values(os.networkInterfaces()))for(const i of l)
      if(i.family==='IPv4'&&!i.internal)console.log('   ws://'+i.address+':'+port+'/ws');
  });
}
