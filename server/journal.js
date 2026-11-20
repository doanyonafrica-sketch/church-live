/* Journal du direct : enregistre automatiquement, sur le PC, tout ce qui sert à comprendre ce qui s'est passé pendant un culte
   (connexions, coupures, reprises, mesures réseau, événements envoyés par le téléphone et par la page OBS).
   Un fichier par jour (journal-AAAA-MM-JJ.jsonl, une ligne = un événement), conservé 30 jours.
   Aucun code d'appairage, aucune image, aucun son : seulement des chiffres et des états. */
const fs=require('fs'),path=require('path'),os=require('os');
const KEEP_DAYS=30,MAX_BYTES=40*1024*1024;
const pad=n=>String(n).padStart(2,'0');
const dayOf=t=>{const d=new Date(t);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())};
/* Date et heure locales du PC, lisibles : « 2026-11-14 16:25:03 » */
const stamp=t=>{const d=new Date(t);return dayOf(t)+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())};
function createJournal(dir){
  const base=path.join(dir||process.env.TPR_DATA||path.join(os.homedir(),'.tpr-live'),'journal');
  try{fs.mkdirSync(base,{recursive:true})}catch{}
  /* ménage : fichiers de plus de 30 jours */
  try{for(const f of fs.readdirSync(base)){const m=/^journal-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
    if(m&&Date.now()-new Date(m[1]+'T12:00:00').getTime()>KEEP_DAYS*864e5)try{fs.unlinkSync(path.join(base,f))}catch{}}}catch{}
  const sizes=new Map();
  function log(ev,d,t){
    try{t=t||Date.now();const f=path.join(base,'journal-'+dayOf(t)+'.jsonl');
      const n=sizes.get(f)||0;if(n>MAX_BYTES)return;
      const line=JSON.stringify({h:stamp(t),ev,...(d||{}),t})+'\n';sizes.set(f,n+line.length);
      fs.appendFileSync(f,line)}catch{}   /* une ligne à la fois, dans l'ordre : le volume est faible (quelques lignes par seconde au plus) */
  }
  const files=(days,date)=>{try{
    if(/^\d{4}-\d{2}-\d{2}$/.test(date||'')){const f=path.join(base,'journal-'+date+'.jsonl');return fs.existsSync(f)?[f]:[]}
    const lim=Date.now()-Math.max(1,days||1)*864e5;
    return fs.readdirSync(base).filter(f=>/^journal-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)&&new Date(f.slice(8,18)+'T23:59:59').getTime()>=lim).sort().map(f=>path.join(base,f))}catch{return[]}};
  const read=(days,date)=>{const out=[];for(const f of files(days,date))try{for(const l of fs.readFileSync(f,'utf8').split('\n')){if(!l)continue;try{out.push(JSON.parse(l))}catch{}}}catch{}out.sort((x,y)=>x.t-y.t);return out};   /* ordre chronologique garanti à la lecture */
  return{log,files,read,dir:base};
}
/* Nettoie un événement envoyé par le téléphone ou la page OBS : noms et valeurs simples, tailles limitées */
function cleanClientLog(m,now){
  const out=[];if(!m||!Array.isArray(m.items))return out;
  for(const it of m.items.slice(0,50)){
    if(!it||typeof it!=='object'||typeof it.ev!=='string'||!/^[a-z0-9_-]{1,32}$/.test(it.ev))continue;
    const o={ev:it.ev},ago=typeof it.ago==='number'&&isFinite(it.ago)?Math.min(Math.max(it.ago,0),864e5):0;
    if(it.d&&typeof it.d==='object'){let n=0;
      for(const k of Object.keys(it.d)){if(n>=8)break;if(!/^[a-z0-9_]{1,16}$/.test(k))continue;const v=it.d[k];
        if(typeof v==='number'&&isFinite(v)){o[k]=v;n++}else if(typeof v==='boolean'){o[k]=v;n++}
        else if(typeof v==='string'){o[k]=v.replace(/[<>&"'`\r\n]/g,'').slice(0,120);n++}}}
    o.t=now-ago;out.push(o)}
  return out;
}
const N=x=>x==null?'n/d':x;   /* valeur absente : on écrit « n/d », jamais « null » */
const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null,r1=x=>x==null?null:Math.round(x*10)/10;
const fmtDur=s=>{s=Math.round(s);return s<60?s+' s':s<3600?Math.floor(s/60)+' min '+pad(s%60)+' s':Math.floor(s/3600)+' h '+pad(Math.floor(s/60)%60)+' min'};
const dm=t=>{const d=new Date(t);return pad(d.getDate())+'/'+pad(d.getMonth()+1)+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())};
const longDate=t=>new Date(t).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const clock=t=>{const d=new Date(t);return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())};
const GAP=15*60e3;   /* plus de 15 minutes sans aucun événement = nouvelle session (un autre test, un autre culte) */
function sessions(ev){const out=[];let cur=null;
  for(const e of ev){if(!cur||e.t-cur.end>GAP){cur={start:e.t,end:e.t,ev:[]};out.push(cur)}cur.ev.push(e);cur.end=e.t}
  return out}
/* Test d'aptitude : transforme les mesures d'un téléphone (une toutes les 10 s) en verdict
   « apte », « apte sous conditions » ou « non apte », avec les raisons et les conseils.
   Seuils calibrés sur le culte du 15/11 : le téléphone qui a tenu 2 h (30 images/s, 9 ms, 0 % d'alerte) doit sortir « apte »,
   et ceux qui ramaient (12 à 23 images/s, jusqu'à plus d'une seconde de latence) « non apte ». */
function evaluateDevice(snaps,info){
  info=info||{};
  const num=x=>typeof x==='number'&&isFinite(x);
  const quick=!!info.quick,step=info.step||10;   /* contrôle rapide à la connexion : mesures toutes les 2 s, 10 premières secondes ignorées */
  if(quick){if(snaps.length>=17)snaps=snaps.slice(5)}else if(snaps.length>=21)snaps=snaps.slice(3);   /* les 30 premières secondes (établissement de la liaison) ne comptent pas */
  const n=snaps.length;
  const col=k=>snaps.map(s=>s[k]).filter(num),q=(a,f)=>{a=a.slice().sort((x,y)=>x-y);return a.length?a[Math.min(a.length-1,Math.floor(a.length*f))]:null};
  const out={verdict:'insuffisant',title:'Test trop court',scope:'',checks:[],advice:[],fig:{n:n,secs:n*step},device:info.device||'',why:'',cause:{kind:'insuffisant',title:'Test trop court : pas de conclusion possible',why:[],proof:''}};
  if(n<(quick?12:18)){out.advice.push(quick?'Laissez le téléphone diffuser une minute de plus.':'Relancez le test et laissez-le durer 5 minutes, avec le téléphone connecté.');return out}
  const fps=avg(col('fps')),fps10=q(col('fps'),.1),rtt50=q(col('rtt'),.5),rtt95=q(col('rtt'),.95),loss=avg(col('loss'));
  const bad=snaps.filter(s=>s.level==='bad').length/n,cpu=snaps.filter(s=>s.limit==='cpu').length/n,th=Math.max(0,...col('thermal'));
  const resC={};for(const s of snaps)if(s.res&&s.res!=='0×0')resC[s.res]=(resC[s.res]||0)+1;
  const resTop=Object.keys(resC).sort((a,b)=>resC[b]-resC[a])[0]||'',rm=/(\d+)\s*[×x]\s*(\d+)/.exec(resTop),h=rm?Math.round(Math.min(+rm[1],+rm[2])/10)*10:null;
  const C=(key,name,st,detail,advice)=>out.checks.push({key,name,status:st,detail,advice:advice||''});
  const ADV_WIFI='Connectez le téléphone au Wi-Fi 5 GHz s\'il existe, rapprochez-le du routeur et éloignez-le des autres appareils.';
  /* 1. fluidité */
  const cf=avg(col('cfps')),camSlow=cf!=null&&cf<22&&fps!=null&&fps<27;   /* la caméra elle-même fournit peu d'images : le réseau et l'encodage ne sont pas en cause */
  if(fps!=null)C('fps','Fluidité',fps>=27&&(fps10==null||fps10>=18)?'ok':fps>=22?'warn':'fail',r1(fps)+' images/s en moyenne ; pendant 10 % du temps, '+N(fps10)+' ou moins'+(cf!=null?' (la caméra fournit '+Math.round(cf)+' images/s)':''),camSlow?'La caméra du téléphone fournit trop peu d\'images : éclairez davantage la scène (en pénombre, la caméra baisse sa cadence), sinon utilisez un autre téléphone.':'Baissez la qualité (480p), fermez les autres applications, ou utilisez un autre téléphone.');
  /* 2. latence */
  if(rtt50!=null)C('rtt','Latence',rtt50<=50&&rtt95<=250?'ok':rtt50<=150&&rtt95<=800?'warn':'fail','typique '+rtt50+' ms, dans les mauvais moments jusqu\'à '+rtt95+' ms',ADV_WIFI);
  /* 3. pertes */
  if(loss!=null)C('loss','Pertes de données',loss<=1?'ok':loss<=3?'warn':'fail',r1(loss)+' % en moyenne',ADV_WIFI);
  /* 4. stabilité */
  C('bad','Stabilité',bad<=0.10?'ok':bad<=0.30?'warn':'fail','en alerte « mauvais » '+Math.round(bad*100)+' % du temps',ADV_WIFI);
  /* 5. coupures */
  if(num(info.drops))C('drops','Coupures',info.drops===0?'ok':info.drops===1?'warn':'fail',info.drops===0?'aucune coupure pendant le test':info.drops+' coupure(s) pendant le test','Redémarrez le téléphone, vérifiez le Wi-Fi, et gardez l\'application au premier plan.');
  /* 6. processeur et chaleur */
  C('cpu','Processeur et chaleur',cpu<=0.05&&th<=1?'ok':cpu<=0.20&&th<=2?'warn':'fail','processeur limitant la qualité '+Math.round(cpu*100)+' % du temps, chauffe '+th,'Fermez les autres applications, désactivez l\'économiseur de batterie, baissez la qualité, ou utilisez un autre téléphone.');
  /* 7. Wi-Fi (information : jamais bloquant à lui seul) */
  const fr=col('freq'),lk=col('link'),p24=fr.length>=n/2?fr.filter(x=>x<3000).length/fr.length:null,lkAvg=lk.length>=n/2?avg(lk):null;   /* p24 : part du temps en 2,4 GHz ; null = bande non enregistrée */
  if(p24!=null)C('wifi','Wi-Fi',p24>=0.5?'warn':'ok',p24>=0.5?'bande 2,4 GHz (moins fiable quand beaucoup d\'appareils sont présents)':'bande 5 GHz, vitesse de liaison '+Math.round(avg(lk)||0)+' Mb/s',ADV_WIFI);
  else if(lkAvg!=null)C('wifi','Wi-Fi',lkAvg>=100?'ok':'warn','vitesse de liaison '+Math.round(lkAvg)+' Mb/s'+(lkAvg>=100?' (compatible 5 GHz)':', probablement le 2,4 GHz'),ADV_WIFI);
  /* 7 bis. Débit réel du Wi-Fi vers le PC (essai sans vidéo) et reconnexions Wi-Fi pendant le test */
  const sp=num(info.speed)?info.speed:null,ipCh=num(info.ipChanges)?info.ipChanges:null;
  if(sp!=null)C('speed','Capacité d\'envoi du Wi-Fi',sp>=12?'ok':sp>=6?'warn':'fail','débit mesuré vers le PC : '+r1(sp)+' Mb/s (la vidéo en 720p en demande environ 4)',ADV_WIFI);
  if(ipCh!=null)C('ip','Connexion Wi-Fi',ipCh===0?'ok':ipCh===1?'warn':'fail',ipCh===0?'aucune reconnexion au Wi-Fi pendant le test':'le téléphone a changé d\'adresse '+ipCh+' fois : il s\'est reconnecté au Wi-Fi',ADV_WIFI);
  /* 8. batterie (conseil : jamais bloquant) */
  const bt=col('battery'),chg=snaps.filter(s=>s.charging===true).length/n;let drain=null;
  if(bt.length){const b0=bt[0],b1=bt[bt.length-1];
    if(chg>=0.5)C('bat','Batterie','ok','branché ('+b1+' %)','');
    else{let dt=0,dd=0;for(let i=1;i<n;i++){const a=snaps[i-1],b=snaps[i];if(b.t-a.t<=30000&&num(a.battery)&&num(b.battery)&&a.charging!==true&&b.charging!==true&&b.battery<=a.battery){dt+=b.t-a.t;dd+=a.battery-b.battery}}
      if(dt>=240000)drain=Math.min(100,dd/(dt/3600000));
      C('bat','Batterie',b1<30||(drain!=null&&drain>=25)?'warn':'ok',b1+' % non branché'+(drain!=null?', consommation estimée environ '+Math.round(drain)+' % par heure'+(drain>=10?' (il tiendrait environ '+r1(100/drain)+' h)':''):' (test trop court pour estimer la consommation)'),'Branchez le téléphone sur secteur pendant tout le direct.')}}
  const F=out.checks.filter(c=>c.status==='fail'),W=out.checks.filter(c=>c.status==='warn');
  out.verdict=F.length?'non':W.length?'conditions':'apte';
  out.title=F.length?'Non apte au direct':W.length?'Apte sous conditions':'Apte au direct';
  out.scope=(h?'Testé en '+h+'p. ':'')+(h&&h<720?'Le verdict ne vaut que pour cette qualité. ':'');
  for(const c of F.concat(W))if(c.advice&&!out.advice.includes(c.advice))out.advice.push(c.advice);
  out.why=F.concat(W).map(c=>c.name+' ('+c.detail+')').join(' ; ').slice(0,110);
  /* Cause probable : le téléphone, le Wi-Fi 2,4 GHz ou le réseau ? On compare les signes de chacun. */
  const netBad=(rtt50!=null&&(rtt50>150||rtt95>800))||(loss!=null&&loss>3)||(sp!=null&&sp<6)||(ipCh!=null&&ipCh>=2);
  const cpuBad=cpu>0.2||th>=3,phoneBad=camSlow||cpuBad||(fps!=null&&fps<22&&!netBad),l24=p24!=null?p24>=0.5:(lkAvg!=null&&lkAvg<=72);
  const netWhy=[],phoneWhy=[];
  if(rtt50!=null&&(rtt50>150||rtt95>800))netWhy.push('latence typique '+rtt50+' ms, jusqu\'à '+rtt95+' ms');
  if(loss!=null&&loss>3)netWhy.push('pertes de données '+r1(loss)+' %');
  if(sp!=null&&sp<6)netWhy.push('débit mesuré vers le PC seulement '+r1(sp)+' Mb/s');
  if(ipCh!=null&&ipCh>=2)netWhy.push('reconnexions au Wi-Fi : adresse changée '+ipCh+' fois');
  if(l24)netWhy.push(p24!=null?'bande 2,4 GHz ('+Math.round(p24*100)+' % du temps)':'vitesse de liaison '+Math.round(lkAvg)+' Mb/s, typique du 2,4 GHz (bande non enregistrée par cette version)');
  if(camSlow)phoneWhy.push('la caméra du téléphone ne fournit que '+Math.round(cf)+' images/s (lumière insuffisante ou caméra limitée)');
  if(cpuBad)phoneWhy.push('processeur limitant la qualité '+Math.round(cpu*100)+' % du temps, chauffe '+th);
  if(!camSlow&&!cpuBad&&fps!=null&&fps<22&&!netBad)phoneWhy.push(r1(fps)+' images/s alors que la latence est bonne : le téléphone n\'arrive pas à encoder assez vite');
  const PW='Preuve à faire : refaites le même test avec ce téléphone, au même endroit, connecté au Wi-Fi 5 GHz. Si le résultat devient meilleur, la bande 2,4 GHz était la cause.',
        PN='Preuve à faire : refaites le test au plus près du routeur, puis avec un autre téléphone au même endroit. Si l\'autre téléphone est bon au même endroit, le réseau n\'est pas en cause : c\'est le téléphone (ou sa puce Wi-Fi).',
        PP='Preuve à faire : testez ce téléphone à l\'endroit où le premier téléphone marchait bien, avec la même lumière. S\'il reste mauvais, c\'est bien le téléphone.';
  const noProblem=!F.length&&!W.some(c=>['fps','rtt','loss','bad','drops','cpu','speed','ip'].includes(c.key));
  out.cause=noProblem?{kind:'ok',title:'Aucun problème de téléphone ni de réseau',why:[],proof:''}
    :netBad&&phoneBad?{kind:'mixed',title:'Le téléphone et le réseau sont tous deux en cause',why:netWhy.concat(phoneWhy),proof:PN+' '+PP}
    :netBad?(l24?{kind:'wifi24',title:'Cause probable : le Wi-Fi 2,4 GHz',why:netWhy,proof:PW}:{kind:'network',title:'Cause probable : le réseau (Wi-Fi, routeur ou distance)',why:netWhy,proof:PN})
    :phoneBad?{kind:'phone',title:'Cause probable : le téléphone lui-même',why:phoneWhy,proof:PP}
    :{kind:'unknown',title:'Cause non déterminée',why:['les mesures sont limites, sans signe net du téléphone ni du réseau'],proof:'Refaites un test complet de 10 minutes pour avoir plus de mesures.'};
  out.fig={n,secs:n*step,fps:r1(fps),rtt50,rtt95,loss:r1(loss),bad:Math.round(bad*100),cpu:Math.round(cpu*100),thermal:th,drops:num(info.drops)?info.drops:null,drain:drain==null?null:Math.round(drain),quality:h,
    band:p24==null?null:(p24>=0.5?'2,4':'5'),speed:sp==null?null:r1(sp),ipChanges:ipCh,camfps:cf==null?null:Math.round(cf)};
  return out}

/* Diagnostic automatique : transforme les chiffres en conclusions, comme le ferait quelqu'un qui relit le journal à la main */
function diagnose(r,endT){
  const D=[],ps=r.snaps.filter(s=>s.pub),n=ps.length,num=x=>typeof x==='number'&&isFinite(x);
  const q=(a,f)=>{a=a.slice().sort((x,y)=>x-y);return a.length?a[Math.floor(a.length*f)]:null};
  const batAt=t=>{let b=null;for(const s of ps){if(s.t>t+2000)break;if(num(s.battery))b=s}return b};
  /* 1) Absences du téléphone (30 s ou plus), avec la cause la plus probable */
  const ab=[];for(const c of r.pc){if(c.code===4000)continue;const j=r.pj.find(x=>x.t>c.t),to=j?j.t:null,secs=((to||endT)-c.t)/1000;if(secs>=30)ab.push({c,to,secs})}
  ab.sort((x,y)=>x.c.t-y.c.t);let lastA=null;const ab2=[];for(const a of ab){if(lastA&&a.c.t<(lastA.to||Infinity))continue;ab2.push(a);lastA=a}   /* plusieurs téléphones sur la même caméra : on ne compte pas deux fois la même absence */
  for(const a of ab2.slice(0,8)){const b=batAt(a.c.t),hid=r.hidden.some(h=>Math.abs(h-a.c.t)<30000);let why;
    if(b&&b.battery<=15&&b.charging!==true)why='batterie presque vide ('+b.battery+' %) : cause très probable';
    else if(a.c.code===1006)why='coupure brutale du réseau (code 1006)';
    else if(a.c.code===1001)why='application fermée, téléphone éteint ou mis en veille (code 1001)'+(hid?' ; l\'application était passée en arrière-plan juste avant':'');
    else if(a.c.code===1000||a.c.code===1005)why='arrêt normal : bouton « arrêt » ou fermeture de l\'application'+(hid?' ; l\'application était passée en arrière-plan juste avant':'');
    else why='code de fermeture '+a.c.code;
    D.push('⚠ Téléphone absent de '+dm(a.c.t)+' à '+(a.to?dm(a.to):'la fin du journal')+' ('+fmtDur(a.secs)+') : '+why+'.')}
  if(ab2.length>8)D.push('… et '+(ab2.length-8)+' autre(s) absence(s) du téléphone.');
  /* 1 bis) Changements d'adresse IP : à chaque reconnexion au Wi-Fi, le téléphone reçoit parfois une autre adresse */
  const byId={};for(const x of r.pj){if(!x.id)continue;(byId[x.id]=byId[x.id]||[]).push(x.ip)}
  for(const [id,a] of Object.entries(byId)){let ch=0;for(let i=1;i<a.length;i++)if(a[i]&&a[i-1]&&a[i]!==a[i-1])ch++;
    if(ch>=2)D.push('⚠ Le téléphone d\'identifiant '+id+' a changé d\'adresse IP '+ch+' fois ('+[...new Set(a.filter(Boolean))].join(', ')+') : il s\'est reconnecté au Wi-Fi à chaque fois. Son Wi-Fi est instable.')}
  /* 1 ter) Alertes Wi-Fi 2,4 GHz déclenchées pendant le direct, et demandes envoyées au téléphone */
  if(r.w24.length)D.push('⚠ Alerte Wi-Fi 2,4 GHz déclenchée '+r.w24.length+' fois (à '+r.w24.slice(0,5).map(e=>clock(e.t)).join(', ')+(r.w24.length>5?', …':'')+') : connexion mauvaise sur le 2,4 GHz pendant plus de 30 secondes.'+(r.notices.length?' Le PC a prévenu le téléphone '+r.notices.length+' fois (à '+r.notices.slice(0,5).map(e=>clock(e.t)).join(', ')+').':' Personne n\'a prévenu le téléphone depuis le PC.'));
  /* 2) Consommation de batterie */
  let dt=0,dd=0;for(let i=1;i<n;i++){const a=ps[i-1],b=ps[i];if(b.t-a.t<=30000&&num(a.battery)&&num(b.battery)&&a.charging!==true&&b.charging!==true&&b.battery<=a.battery){dt+=b.t-a.t;dd+=a.battery-b.battery}}
  if(dt>=600000){const rate=dd/(dt/3600000);if(rate>=15)D.push('⚠ Le téléphone perd environ '+Math.round(rate)+' % de batterie par heure sans être branché : il tient environ '+(Math.round(100/rate*10)/10)+' h depuis 100 %. Branchez-le pendant le direct.')}
  /* 3) Wi-Fi : bande et vitesse, quand la connexion est difficile */
  if(n>=20){const badShare=ps.filter(s=>s.level==='bad').length/n,rtt90=q(ps.map(s=>s.rtt).filter(num),.9),hard=badShare>0.2||(rtt90!=null&&rtt90>300);
    const fr=ps.map(s=>s.freq).filter(num),lk=ps.map(s=>s.link).filter(num);
    if(hard&&fr.length>=n/2){const p24=fr.filter(x=>x<3000).length/fr.length;
      if(p24>=0.5)D.push('⚠ Wi-Fi en 2,4 GHz ('+Math.round(p24*100)+' % du temps) et connexion difficile : connectez ce téléphone au réseau 5 GHz s\'il existe.')}
    else if(hard&&lk.length>=n/2&&q(lk,.9)<=72)D.push('⚠ Vitesse Wi-Fi basse (jamais plus de 72 Mb/s, typique du 2,4 GHz) et connexion difficile : essayez le réseau 5 GHz. Cette version n\'enregistrait pas la bande exacte.');
    else if(hard)D.push('⚠ Connexion difficile ('+Math.round(badShare*100)+' % du temps en alerte, latence élevée jusqu\'à '+N(q(ps.map(s=>s.rtt).filter(num),.99))+' ms) sans cause évidente dans le journal.')}
  /* 3 bis) Images lentes alors que le réseau va bien : le problème est dans le téléphone (caméra ou encodage), pas dans le Wi-Fi */
  if(n>=20){const slowOk=ps.filter(s=>num(s.fps)&&s.fps<20&&num(s.rtt)&&s.rtt<100).length/n,cfv=ps.map(s=>s.cfps).filter(num),cfAvg=avg(cfv);
    if(slowOk>=0.2)D.push('⚠ Images lentes ('+Math.round(slowOk*100)+' % du temps sous 20 images/s) alors que la latence est bonne : le Wi-Fi n\'est pas en cause, c\'est le téléphone.'+(cfAvg!=null?(cfAvg<22?' La caméra elle-même ne fournit que '+Math.round(cfAvg)+' images/s : éclairez mieux la scène ou changez de téléphone.':' La caméra fournit '+Math.round(cfAvg)+' images/s : le téléphone n\'arrive pas à les encoder assez vite, baissez la qualité (480p).'):' Cette version n\'enregistrait pas la cadence de la caméra : au prochain essai, le rapport dira si c\'est la caméra ou l\'encodage.'))}
  /* 4) Processeur du téléphone */
  const cpuS=ps.filter(s=>s.limit==='cpu').length;
  if(n>=20&&cpuS/n>=0.05)D.push('⚠ Le processeur du téléphone a limité la qualité pendant '+fmtDur(cpuS*10)+' ('+Math.round(cpuS/n*100)+' % du temps) : baissez la qualité (480p) ou fermez les autres applications.');
  /* 5) Application passée en arrière-plan */
  if(r.hidden.length)D.push('⚠ L\'application du téléphone est passée en arrière-plan '+r.hidden.length+' fois (à '+r.hidden.slice(0,4).map(clock).join(', ')+(r.hidden.length>4?', …':'')+') : la caméra s\'arrête dans ce cas. Normal à la fin du culte ; sinon gardez l\'écran allumé et l\'application ouverte.');
  /* 6) Code, deuxième source OBS, reconnexions de la page OBS */
  if(r.deniedIps.size)D.push('⚠ Mauvais code d\'appairage essayé depuis '+[...r.deniedIps].join(', ')+' : vérifiez le code dans les réglages de ce téléphone.');
  if(r.busy>20)D.push('⚠ '+r.busy+' refus « caméra occupée » : une 2e source OBS (ou un onglet) essaie la même caméra. Gardez une seule source par caméra.');
  if(r.viewClose>=8)D.push('⚠ La page OBS s\'est reconnectée '+r.viewClose+' fois : source OBS cachée ou rafraîchie, ou 2e source. À vérifier si l\'image a saccadé.');
  /* 7) Bonnes nouvelles : longues connexions sans coupure */
  for(const c of r.pc)if(c.secs>=1800)D.push('✓ Connexion stable pendant '+fmtDur(c.secs)+' (de '+clock(c.t-c.secs*1000)+' à '+clock(c.t)+').');
  if(!D.length&&n>=30)D.push('✓ Rien d\'anormal détecté.');
  return D}
function summarizeSession(ev,L){
  const rooms={};
  const R=k=>rooms[k]||(rooms[k]={pubJoin:0,pubClose:0,viewJoin:0,viewClose:0,dead:0,left:0,needOffer:0,codes:{},outages:[],snaps:[],client:{},busy:0,denied:0,since:null,sets:[],remote:0,dev:[],pc:[],pj:[],deniedIps:new Set(),hidden:[],tests:[],w24:[],notices:[]});
  const starts=[],PJ=[],DV=[];
  for(const e of ev){
    if(e.ev==='server-start'){starts.push(e.t);continue}
    if(!e.room)continue;const r=R(e.room);
    if(e.ev==='join'){if(e.role==='publisher'){r.pubJoin++;r.pj.push({t:e.t,ip:e.ip,id:e.id});PJ.push({room:e.room,ip:e.ip,id:e.id,t:e.t});if(r.since!=null){r.outages.push({from:r.since,to:e.t,secs:(e.t-r.since)/1000});r.since=null}}else r.viewJoin++}
    else if(e.ev==='close'){const k=e.role+':'+e.code;r.codes[k]=(r.codes[k]||0)+1;
      if(e.role==='publisher'){r.pubClose++;r.pc.push({t:e.t,code:e.code,secs:e.secs||0});if(![4000,1000,1001,1005].includes(e.code)&&r.since==null)r.since=e.t}else r.viewClose++}   /* 1000/1001/1005 : arrêt normal ; 4000 : remplacé par le même téléphone */
    else if(e.ev==='dead')r.dead++;
    else if(e.ev==='left')r.left++;
    else if(e.ev==='need-offer')r.needOffer++;
    else if(e.ev==='busy')r.busy++;
    else if(e.ev==='denied'){r.denied++;if(e.why==='code'&&e.ip)r.deniedIps.add(e.ip)}
    else if(e.ev==='remote-set')r.remote++;
    else if(e.ev==='test-result')r.tests.push(e);
    else if(e.ev==='wifi24-alert')r.w24.push(e);
    else if(e.ev==='notice-sent')r.notices.push(e);
    else if(e.ev==='settings')r.sets.push(e);
    else if(e.ev==='snap')r.snaps.push(e);
    else if(e.ev.startsWith('c:')){if(e.ev==='c:device'){r.dev.push(e);DV.push(e)}if(e.ev==='c:app-hidden')r.hidden.push(e.t);const k=(e.role||'?')+' '+e.ev.slice(2);r.client[k]=(r.client[k]||0)+1}
  }
  if(starts.length)L.push('Serveur démarré à : '+starts.map(dm).join(', ')+'.');
  for(const [name,r] of Object.entries(rooms)){
    L.push('','--- Caméra « '+name+' » ---');
    const dg=diagnose(r,ev[ev.length-1].t);if(dg.length){L.push('Diagnostic automatique :');for(const d of dg)L.push('   → '+d)}
    const live=r.snaps.filter(s=>s.pub&&s.view);
    if(r.dev.length){const seen=new Set();for(const e of r.dev){const m=/Android [\d.]+; ([^)]*)\)/.exec(e.ua||'');
      seen.add((m?m[1].replace(/ Build\/.*/,''):String(e.ua||'?').slice(0,40))+(e.cores?', '+e.cores+' cœurs':'')+(e.ram?', '+e.ram+' Go de mémoire':''))}
      L.push('Téléphone(s) utilisé(s) : '+[...seen].join(' ; ')+'.')}
    if(!r.pubJoin&&!r.pubClose&&r.viewJoin)L.push('Aucun téléphone n\'a utilisé cette caméra (seulement la source OBS).');
    L.push('Téléphone : '+r.pubJoin+' connexion(s), '+r.pubClose+' fermeture(s). OBS : '+r.viewJoin+' connexion(s), '+r.viewClose+' fermeture(s).');
    L.push('Liaisons détectées mortes par le serveur : '+r.dead+'. Départs annoncés (coupure > 4 s) : '+r.left+'. Renégociations demandées par OBS : '+r.needOffer+'.');
    if(r.busy||r.denied)L.push('Refus : '+r.busy+' caméra occupée, '+r.denied+' mauvais code.'+(r.busy>20?' → une 2e source OBS (ou un onglet) essaie la même caméra : gardez une seule source par caméra.':''));
    const codes=Object.entries(r.codes).map(([k,v])=>k+' ×'+v).join(', ');if(codes)L.push('Codes de fermeture : '+codes+' (1006 = coupure brutale du réseau, 4000 = remplacé, 4001 = occupé, 4003 = code refusé).');
    if(r.outages.length){const worst=Math.max(...r.outages.map(o=>o.secs));
      L.push('Coupures du téléphone : '+r.outages.length+' (plus longue : '+fmtDur(worst)+', moyenne : '+fmtDur(avg(r.outages.map(o=>o.secs)))+').');
      for(const o of r.outages.slice(0,15))L.push('   • '+dm(o.from)+' → '+dm(o.to)+'  ('+fmtDur(o.secs)+')');
      if(r.outages.length>15)L.push('   … et '+(r.outages.length-15)+' autres.')}
    if(r.since!=null){const end=ev[ev.length-1].t;
      L.push('⚠ Le téléphone ne s\'est PAS reconnecté après la coupure de '+dm(r.since)+' : aucun retour jusqu\'à la fin du journal ('+fmtDur((end-r.since)/1000)+' sans caméra).')}
    else if(!r.outages.length)L.push('Aucune coupure du téléphone.');
    if(r.tests.length){L.push('Tests d’aptitude des téléphones :');for(const t of r.tests)L.push('   • '+clock(t.t)+(t.ip?' '+t.ip:'')+(t.model?' ('+t.model+')':'')+' : '+t.title+(t.quality?' en '+t.quality+'p':'')+(t.band?' ('+t.band+' GHz)':'')+(t.cause?' — '+t.cause:'')+(t.why?' — '+t.why:''))}
    if(r.sets.length){const seen=[];for(const e of r.sets){const d='qualité '+e.q+'p, priorité '+e.prio+', fluidité '+e.fluid+', codec '+e.codec+(e.muted?', micro coupé':'');
        if(!seen.length||seen[seen.length-1].d!==d)seen.push({t:e.t,d})}
      L.push('Réglages du téléphone : '+seen.slice(0,6).map(x=>clock(x.t)+' '+x.d).join(' ; ')+(seen.length>6?' ; …':'')+(r.remote?' (réglages envoyés depuis le PC : '+r.remote+')':''))}
    const ps=r.snaps.filter(s=>s.pub);
    if(ps.length){
      const col=k=>ps.map(s=>s[k]).filter(x=>typeof x==='number'),mn=a=>a.length?Math.min(...a):null,mx=a=>a.length?Math.max(...a):null;
      L.push('Pendant le direct ('+fmtDur(live.length*10)+' avec téléphone et OBS reliés) :');
      L.push('   images/s : moyenne '+N(r1(avg(col('fps'))))+', minimum '+N(mn(col('fps')))+'   |   débit : moyenne '+N(r1(avg(col('mbps'))))+' Mb/s, minimum '+N(mn(col('mbps'))));
      L.push('   latence : moyenne '+N(r1(avg(col('rtt'))))+' ms, maximum '+N(mx(col('rtt')))+' ms   |   pertes : moyenne '+N(r1(avg(col('loss'))))+' %, maximum '+N(mx(col('loss')))+' %');
      L.push('   gigue côté OBS : max '+N(mx(col('vjitter')))+' ms   |   images perdues par OBS : '+col('vdropped').reduce((a,b)=>a+b,0)+'   |   paquets perdus : '+col('vlost').reduce((a,b)=>a+b,0));
      L.push('   Wi-Fi : signal le plus faible '+N(mn(col('rssi')))+' dBm   |   vitesse de liaison moyenne '+N(r1(avg(col('link'))))+' Mb/s (minimum '+N(mn(col('link')))+')'+(()=>{const f=col('freq');if(!f.length)return '';const a=Math.round(f.filter(x=>x<3000).length/f.length*100);return '   |   bande : '+(a===100?'2,4 GHz':a===0?'5 GHz':'2,4 GHz '+a+' % / 5 GHz '+(100-a)+' %')})()+'   |   batterie : minimum '+N(mn(col('battery')))+' %   |   chauffe max : '+N(mx(col('thermal'))));
      const lim={};for(const s of ps)if(s.limit&&s.limit!=='none')lim[s.limit]=(lim[s.limit]||0)+1;
      const ls=Object.entries(lim).map(([k,v])=>k+' '+v*10+' s').join(', ');if(ls)L.push('   Qualité limitée par : '+ls);
      const bad=ps.filter(s=>s.level==='bad').length*10;if(bad)L.push('   Temps en alerte « mauvais » : '+fmtDur(bad));
      const wl={};for(const s of ps){const b=typeof s.freq==='number'?(s.freq<3000?'2,4 GHz':'5 GHz'):'bande inconnue',k=(s.ssid?'« '+s.ssid+' » ':'')+b;wl[k]=(wl[k]||0)+1}
      L.push('   Wi-Fi utilisé : '+Object.entries(wl).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' ('+Math.round(v/ps.length*100)+' % du temps)').join(' ; ')+(ps.some(s=>s.ssid)?'':'   (nom du réseau non lisible : Android ne le donne qu\'avec l\'autorisation de localisation)'));
      const bs=ps.filter(s=>typeof s.battery==='number');
      if(bs.length){const low=bs.find(s=>s.battery<=20);
        L.push('   Batterie : '+bs[0].battery+' % ('+clock(bs[0].t)+') → '+bs[bs.length-1].battery+' % ('+clock(bs[bs.length-1].t)+')'+(low?'  ⚠ sous 20 % dès '+clock(low.t)+' : branchez le téléphone':'')+(bs.some(s=>typeof s.charging==='boolean')?'  |  branché '+fmtDur(bs.filter(s=>s.charging===true).length*10)+', non branché '+fmtDur(bs.filter(s=>s.charging===false).length*10):''))}
      /* Chronologie : où ça allait bien, où ça allait mal */
      const tl={};for(const s of r.snaps){const d=new Date(s.t),k=pad(d.getHours())+':'+pad(Math.floor(d.getMinutes()/10)*10);(tl[k]=tl[k]||[]).push(s)}
      L.push('   Chronologie par tranche de 10 min (heure | téléphone connecté | OBS connecté | à l\'antenne | images/s | latence | batterie) :');
      for(const k of Object.keys(tl).sort().slice(0,80)){const a=tl[k],p=a.filter(s=>s.pub),nn=f=>p.map(s=>s[f]).filter(x=>typeof x==='number');
        L.push('      '+k+' | '+fmtDur(p.length*10)+' | '+fmtDur(a.filter(s=>s.view).length*10)+' | '+fmtDur(a.filter(s=>s.onair).length*10)+' | '+N(r1(avg(nn('fps'))))+' | '+N(r1(avg(nn('rtt'))))+' ms | '+N(r1(avg(nn('battery'))))+' %')}
    }
    const cl=Object.entries(r.client).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' ×'+v);
    if(cl.length)L.push('Événements signalés par les appareils : '+cl.join(', '));
  }
  /* Comparaison des téléphones : qui a bien tenu, qui a ramé, et pourquoi. On suit chaque téléphone par son identifiant
     (stable), pas par son adresse IP, qui change à chaque reconnexion au Wi-Fi. */
  const by={},camName=k=>k==='main'?'caméra 1':'caméra '+String(k).replace(/^cam/,'');
  for(const [name,r] of Object.entries(rooms))for(const s of r.snaps){if(!s.pub)continue;let j=null;
    for(const x of PJ){if(x.room!==name)continue;if(x.t<=s.t)j=x;else break}
    if(!j||!(j.id||j.ip))continue;const key=(j.id||j.ip)+'|'+name;(by[key]=by[key]||{id:j.id,ip:j.ip,room:name,s:[]}).s.push(s)}
  const rows=Object.values(by).filter(o=>o.s.length>=6).sort((a,b)=>a.room<b.room?-1:a.room>b.room?1:(a.id||a.ip)<(b.id||b.ip)?-1:1);
  const mine=(x,o)=>x.room===o.room&&(o.id?x.id===o.id:x.ip===o.ip);
  if(rows.length>=2){
    L.push('','--- Comparaison des téléphones (suivis par identifiant ; un même téléphone peut changer d\'adresse IP en se reconnectant) ---');
    for(const o of rows){const a=o.s,nn=f=>a.map(s=>s[f]).filter(x=>typeof x==='number'&&isFinite(x)),rt=nn('rtt').sort((x,y)=>x-y),fr=nn('freq'),bt=nn('battery');
      const ips=[];let ch=0;for(const x of PJ){if(!mine(x,o))continue;if(!ips.length||ips[ips.length-1]!==x.ip){if(ips.length)ch++;ips.push(x.ip)}}
      let model='';for(const d of DV){if(d.room!==o.room)continue;let j=null;for(const x of PJ){if(x.room!==o.room)continue;if(x.t<=d.t)j=x;else break}
        if(j&&mine(j,o)){const m=/Android [\d.]+; ([^)]*)\)/.exec(d.ua||'');model=' | '+(m?m[1].replace(/ Build\/.*/,''):'modèle inconnu')+(d.cores?', '+d.cores+' cœurs':'');}}
      L.push('   '+[...new Set(ips.filter(Boolean))].join(' / ')+(o.id?' [id '+o.id+']':'')+' ('+camName(o.room)+') : '+fmtDur(a.length*10)+' | '+N(r1(avg(nn('fps'))))+' images/s | latence '+N(rt.length?rt[Math.floor(rt.length/2)]:null)+' ms (max '+N(rt.length?rt[rt.length-1]:null)+') | Wi-Fi '+N(r1(avg(nn('link'))))+' Mb/s'
        +(fr.length?' en '+(fr.filter(x=>x<3000).length/fr.length>=0.5?'2,4':'5')+' GHz':'')+' | alerte '+Math.round(a.filter(s=>s.level==='bad').length/a.length*100)+' % | batterie '+N(bt[0])+' → '+N(bt[bt.length-1])+' %'+model+(ch?' | adresse IP changée '+ch+' fois':'')+(()=>{const c={};for(const s of a)if(s.ssid)c[s.ssid]=(c[s.ssid]||0)+1;const t=Object.entries(c).sort((x,y)=>y[1]-x[1])[0];return t?' | réseau « '+t[0]+' »':''})()+(a.length>=21?' | verdict : '+evaluateDevice(a,{}).title:''))}}
  return Object.keys(rooms);
}
/* Résumé lisible, découpé par session (une session = une période d'activité, séparée de la suivante par plus de 15 minutes de silence) */
function summarize(ev){
  if(!ev.length)return{text:'Aucun événement enregistré pour la période demandée.',rooms:[],sessions:0};
  const S=sessions(ev),L=[];
  L.push('JOURNAL TPR LIVE — '+ev.length+' événements, '+S.length+' session(s) du '+dm(ev[0].t)+' au '+dm(ev[ev.length-1].t));
  L.push('Sessions :');
  S.forEach((x,i)=>L.push('   '+(i+1)+') '+longDate(x.start)+', '+clock(x.start)+' → '+(longDate(x.end)!==longDate(x.start)?dm(x.end):clock(x.end))+' ('+fmtDur((x.end-x.start)/1000)+')'));
  const all=new Set();
  S.forEach((x,i)=>{
    L.push('','==================== SESSION '+(i+1)+' — '+longDate(x.start)+', '+clock(x.start)+' → '+(longDate(x.end)!==longDate(x.start)?dm(x.end):clock(x.end))+' ====================');
    for(const k of summarizeSession(x.ev,L))all.add(k)});
  /* Preuve par comparaison : le même téléphone testé sur le 2,4 GHz puis sur le 5 GHz */
  const TR=ev.filter(e=>e.ev==='test-result'&&e.id),byTel={};for(const e of TR)(byTel[e.id]=byTel[e.id]||[]).push(e);
  const rank={apte:3,conditions:2,non:1,insuffisant:0};
  for(const [id,a] of Object.entries(byTel)){const last={};for(const e of a)if(e.band&&e.verdict!=='insuffisant')last[e.band]=e;
    if(last['2,4']&&last['5']){const x=last['2,4'],y=last['5'],rx=rank[x.verdict],ry=rank[y.verdict];
      L.push('','=== Comparaison des tests du téléphone [id '+id+'] : 2,4 GHz contre 5 GHz ===');
      L.push('   '+dm(x.t)+' en 2,4 GHz : '+x.title+(x.why?' — '+x.why:''));
      L.push('   '+dm(y.t)+' en 5 GHz   : '+y.title+(y.why?' — '+y.why:''));
      L.push(ry>rx?'   ⇒ PREUVE : le résultat est meilleur en 5 GHz. La bande 2,4 GHz était bien la cause : gardez ce téléphone sur le 5 GHz.'
        :ry===rx?'   ⇒ Le résultat ne change pas avec la bande : la cause est ailleurs (le téléphone lui-même ou le réseau).'
        :'   ⇒ Le résultat est meilleur en 2,4 GHz : la bande n\'est pas la cause (autre endroit, autre moment, ou variations du réseau).')}}
  return{text:L.join('\n'),rooms:[...all],sessions:S.length};
}

/* Contrôle automatique d'un téléphone qui vient de se connecter : on le compare au téléphone de référence : celui qui a très bien tenu le culte du 15 novembre (c'était sur l'emplacement « Caméra 1 »).
   Ces valeurs sont FIXES, mémorisées ici : elles ne dépendent jamais du téléphone actuellement branché sur un emplacement, y compris « Caméra 1 »
   (4 Go de mémoire, Android 10, Wi-Fi 5 GHz, 30 images/s, latence d'environ 10 ms, aucune perte). Même verdict que le test d'aptitude. */
const REFERENCE={ram:4,android:10,text:'téléphone de référence (4 Go de mémoire, Android 10, Wi-Fi 5 GHz, 30 images/s, latence d\'environ 10 ms)'};
function staticChecks(info){
  info=info||{};const out=[],num=x=>typeof x==='number'&&isFinite(x);
  const C=(key,name,status,detail,advice)=>out.push({key,name,status,detail,advice:advice||''});
  /* mémoire (valeur approchée donnée par le téléphone : 2, 4 ou 8 Go) */
  if(num(info.ram))C('ram','Mémoire',info.ram>=4?'ok':info.ram>=2?'warn':'fail','environ '+info.ram+' Go (le téléphone de référence en a 4)',
    info.ram>=4?'':info.ram>=2?'Mémoire juste : redémarrez le téléphone avant le culte, fermez toutes les autres applications et, si l\'image saccade, baissez la qualité à 480p.':'Mémoire trop faible pour un direct fluide : gardez ce téléphone en secours et utilisez un téléphone de 4 Go de mémoire ou plus.');
  /* version d'Android */
  const am=/Android (\d+)/.exec(info.ua||''),av=am?+am[1]:null;
  if(av!=null)C('android','Version d\'Android',av>=10?'ok':av===9?'warn':'fail','Android '+av+' (le téléphone de référence : Android 10)',av>=10?'':'Mettez Android à jour si une mise à jour existe ; sinon utilisez un téléphone plus récent.');
  /* alimentation : en direct, la batterie du téléphone de référence perdait environ 40 % par heure */
  const b=num(info.battery)?info.battery:null;
  if(info.charging===true)C('plug','Alimentation','ok','branché'+(b!=null?' ('+b+' %)':''),'');
  else if(info.charging===false)C('plug','Alimentation',b!=null&&b<20?'fail':'warn','non branché'+(b!=null?' ('+b+' %)':''),
    (b!=null&&b<20?'Batterie presque vide : branchez le téléphone tout de suite. ':'')+'Branchez le téléphone au chargeur pendant tout le direct : en direct, la batterie du téléphone de référence perdait environ 40 % par heure.');
  return out}
function evaluateQuick(samples,info){
  info=info||{};
  const r=evaluateDevice(samples,{...info,quick:true,step:info.step||2});
  const S=staticChecks(info),live=r.checks.filter(c=>c.key!=='bat'),all=S.concat(live);   /* « bat » est remplacé par le contrôle d'alimentation */
  const F=all.filter(c=>c.status==='fail'),W=all.filter(c=>c.status==='warn'),tooShort=r.verdict==='insuffisant';
  r.checks=all;r.verdict=F.length?'non':W.length?'conditions':tooShort?'insuffisant':'apte';
  r.title=F.length?'Non apte au direct':W.length?'Apte sous conditions':tooShort?'Contrôle trop court':'Apte au direct';
  r.advice=[];for(const c of F.concat(W))if(c.advice&&!r.advice.includes(c.advice))r.advice.push(c.advice);
  if(tooShort&&!r.advice.length)r.advice.push('Le téléphone s\'est déconnecté avant la fin du contrôle : reconnectez-le et laissez-le diffuser une minute.');
  r.why=F.concat(W).map(c=>c.name+' ('+c.detail+')').join(' ; ').slice(0,110);
  if(r.cause&&(r.cause.kind==='ok'||r.cause.kind==='insuffisant')&&(F.length||W.length))r.cause={kind:'unknown',title:'Points à régler avant le direct',why:F.concat(W).map(c=>c.name+' : '+c.detail),proof:''};
  r.scope='Contrôle automatique de '+Math.round((r.fig&&r.fig.secs)||0)+' secondes, comparé au '+REFERENCE.text+'.'+(r.scope?' '+r.scope:'');
  return r}

module.exports={createJournal,cleanClientLog,summarize,evaluateDevice,evaluateQuick,staticChecks,REFERENCE};
