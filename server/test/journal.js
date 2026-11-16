/* Test du journal : horodatage lisible, séparation par session et par jour, nettoyage des événements des appareils */
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert');
const {createJournal,cleanClientLog,summarize}=require('../journal');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'j-'));const J=createJournal(dir);
const D=864e5,now=Date.now();
function session(t,withCut){
  J.log('server-start',{},t);
  J.log('join',{room:'main',role:'viewer'},t+500);J.log('join',{room:'main',role:'publisher',how:'new'},t+1000);
  J.log('settings',{room:'main',q:720,prio:'sharp',fluid:'on',codec:'auto'},t+1500);
  for(let i=0;i<30;i++)J.log('snap',{room:'main',pub:true,view:true,fps:i%10===0?12:30,mbps:3.1,rtt:40+i,loss:i%7===0?4:0,rssi:-55-i,battery:90-i,thermal:1,vjitter:5,vdropped:0,vlost:i%5,limit:i%9===0?'bandwidth':'none',level:'ok'},t+5000+i*10000);
  if(withCut){J.log('close',{room:'main',role:'publisher',code:1006,secs:300},t+400000);J.log('dead',{room:'main',role:'publisher'},t+400100);
    J.log('left',{room:'main',role:'publisher'},t+404000);J.log('join',{room:'main',role:'publisher',how:'resume'},t+425000);
    for(const x of cleanClientLog({items:[{ev:'ws-close',d:{code:1006,'bad key':1},ago:5000},{ev:'BAD EV'},{ev:'pc-failed',d:{x:'<b>a</b>'}}]},t+426000)){const{t:tt,ev,...d}=x;J.log('c:'+ev,{...d,room:'main',role:'publisher'},tt)}}
}
session(now-D-3*3600e3,true);   /* test d'hier */
session(now-3600e3,false);      /* test d'aujourd'hui */
/* Cas du rapport réel : le téléphone tombe (1006) et ne revient pas ; une autre caméra n'a qu'OBS */
const dir2=fs.mkdtempSync(path.join(os.tmpdir(),'j2-'));const K=createJournal(dir2),u=now-600e3;
K.log('server-start',{},u);K.log('join',{room:'main',role:'viewer'},u+100);K.log('join',{room:'main',role:'publisher',how:'new'},u+1000);
K.log('join',{room:'cam2',role:'viewer'},u+200);K.log('snap',{room:'cam2',pub:false,view:true},u+10000);
for(let i=0;i<5;i++)K.log('snap',{room:'main',pub:true,view:true,fps:20,mbps:1,rtt:100,level:'bad'},u+5000+i*10000);
K.log('close',{room:'main',role:'publisher',code:1006,secs:60},u+70000);K.log('dead',{room:'main',role:'publisher'},u+70100);K.log('left',{room:'main',role:'publisher'},u+74000);
K.log('join',{room:'main',role:'publisher',how:'new'},u+90000);K.log('close',{room:'main',role:'publisher',code:1005,secs:5},u+95000);   /* retour puis arrêt volontaire */
K.log('close',{room:'main',role:'publisher',code:1006,secs:5},u+99000);
/* Diagnostic automatique : batterie vide, application en arrière-plan, mauvais code, Wi-Fi lent */
const dir3=fs.mkdtempSync(path.join(os.tmpdir(),'j3-'));const Z=createJournal(dir3),w0=now-4*3600e3;
Z.log('join',{room:'main',role:'publisher',how:'new',ip:'192.168.1.69'},w0);Z.log('join',{room:'main',role:'viewer'},w0+100);
for(let i=0;i<7200/10;i++)Z.log('snap',{room:'main',pub:true,view:true,fps:30,rtt:10,link:150,freq:5200,battery:Math.max(9,Math.round(93-i/720*84)),charging:false,level:'ok'},w0+5000+i*10000);
Z.log('c:app-hidden',{room:'main',role:'publisher'},w0+7195000);
Z.log('close',{room:'main',role:'publisher',code:1001,secs:7200},w0+7200000);Z.log('left',{room:'main',role:'publisher'},w0+7204000);
Z.log('join',{room:'main',role:'publisher',how:'resume'},w0+7800000);
Z.log('denied',{room:'main',role:'publisher',ip:'192.168.1.97',why:'code'},w0+7900000);
Z.log('join',{room:'cam2',role:'publisher',ip:'192.168.1.165'},w0+100);
for(let i=0;i<40;i++)Z.log('snap',{room:'cam2',pub:true,view:true,fps:15,rtt:600,link:i%2?39:72,level:i%2?'bad':'ok'},w0+5000+i*10000);
setTimeout(()=>{
  const d=summarize(Z.read(1)).text;
  assert(/batterie presque vide \(9 %\) : cause très probable/.test(d),'arrêt par batterie détecté');
  assert(/Téléphone absent de .* \(10 min 00 s\)/.test(d),'durée de l\'absence');
  assert(/perd environ \d+ % de batterie par heure/.test(d),'consommation calculée');
  assert(/Connexion stable pendant 2 h 00 min/.test(d),'bonne nouvelle : connexion stable');
  assert(/passée en arrière-plan 1 fois/.test(d)&&/Mauvais code d'appairage essayé depuis 192\.168\.1\.97/.test(d));
  assert(/Vitesse Wi-Fi basse/.test(d),'Wi-Fi lent détecté (caméra 2)');
  assert(/Comparaison des téléphones/.test(d)&&/192\.168\.1\.69 \(caméra 1\)/.test(d)&&/192\.168\.1\.165 \(caméra 2\)/.test(d),'tableau de comparaison des téléphones');
  assert(!/Wi-Fi en 2,4 GHz|Vitesse Wi-Fi basse[\s\S]*Caméra « main »/.test(d.split('Caméra « cam2 »')[0]||''),'pas de fausse alerte Wi-Fi sur la bonne caméra');
},300);
setTimeout(()=>{
  const x=summarize(K.read(1)).text;
  assert(/ne s'est PAS reconnecté après la coupure/.test(x),'coupure non terminée signalée');
  assert(!/null/.test(x),'aucune valeur « null » dans le résumé');
  assert(/Aucun téléphone n'a utilisé cette caméra/.test(x));
  assert(/Chronologie par tranche/.test(x),'chronologie présente');
},300);
setTimeout(()=>{
  const raw=fs.readFileSync(J.files(2)[0],'utf8').split('\n')[0];
  assert(/"h":"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"/.test(raw),'horodatage lisible absent');
  assert.strictEqual(J.files(2).length,2,'un fichier par jour');
  const all=summarize(J.read(2));assert.strictEqual(all.sessions,2,'deux sessions attendues');
  assert(/SESSION 1/.test(all.text)&&/SESSION 2/.test(all.text));
  assert(/Coupures du téléphone : 1/.test(all.text)&&/pc-failed/.test(all.text)&&!/BAD EV/.test(all.text)&&!/<b>/.test(all.text));
  assert(/qualité 720p, priorité sharp/.test(all.text),'réglages absents');
  const today=new Date(now-3600e3),d=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
  const one=summarize(J.read(1,d));assert.strictEqual(one.sessions,1,'un jour précis = une session');assert(!/Coupures du téléphone : 1/.test(one.text));
  console.log('journal : ok');
},300);

/* Test d'aptitude : verdicts sur des mesures simulées */
const {evaluateDevice}=require('../journal');
const mk=(n,o)=>Array.from({length:n},(_,i)=>({t:now+i*10000,pub:true,fps:30,rtt:10,loss:0,level:'ok',thermal:0,limit:'none',res:'1280×720',link:150,battery:80,charging:true,...o}));
let ev1=evaluateDevice(mk(30),{drops:0});assert.strictEqual(ev1.verdict,'apte','un bon téléphone branché est apte');
ev1=evaluateDevice(mk(30,{charging:false}).map((s,i)=>({...s,battery:80-Math.round(i/30*4)})),{drops:0});assert.strictEqual(ev1.verdict,'conditions','non branché et batterie en baisse : conditions');
assert(ev1.advice.some(a=>/Branchez/.test(a)));
ev1=evaluateDevice(mk(30,{fps:12,rtt:600,level:'bad'}),{drops:0});assert.strictEqual(ev1.verdict,'non','téléphone qui rame : non apte');assert(ev1.checks.filter(c=>c.status==='fail').length>=3);
ev1=evaluateDevice(mk(30),{drops:2});assert.strictEqual(ev1.verdict,'non','deux coupures pendant le test : non apte');
ev1=evaluateDevice(mk(30),{drops:1});assert.strictEqual(ev1.verdict,'conditions','une coupure : sous conditions');
ev1=evaluateDevice(mk(10),{drops:0});assert.strictEqual(ev1.verdict,'insuffisant','moins de 3 minutes : test trop court');
ev1=evaluateDevice(mk(30,{res:'854×480'}),{drops:0});assert(/480p/.test(ev1.scope)&&/ne vaut que pour cette qualité/.test(ev1.scope),'qualité testée rappelée');
ev1=evaluateDevice(mk(30,{link:54}),{drops:0});assert.strictEqual(ev1.verdict,'conditions','Wi-Fi lent : sous conditions');
ev1=evaluateDevice(mk(30,{freq:2437,link:54}),{drops:0});assert(/2,4 GHz/.test(ev1.checks.find(c=>c.key==='wifi').detail),'bande 2,4 GHz signalée');
ev1=evaluateDevice(mk(30,{limit:'cpu',thermal:3}),{drops:0});assert.strictEqual(ev1.verdict,'non','processeur saturé et chaud : non apte');
console.log('aptitude : ok');

/* Cadence de la caméra : distingue « la caméra fournit peu d'images » de « le téléphone n'encode pas assez vite » */
let ev3=evaluateDevice(mk(30,{fps:15,cfps:15,rtt:20}),{drops:0}),fpsC=ev3.checks.find(c=>c.key==='fps');
assert(ev3.verdict==='non'&&/la caméra fournit 15 images\/s/.test(fpsC.detail)&&/éclairez davantage/.test(fpsC.advice),'caméra lente : conseil d\'éclairage');
ev3=evaluateDevice(mk(30,{fps:15,cfps:30,rtt:20}),{drops:0});fpsC=ev3.checks.find(c=>c.key==='fps');
assert(/Baissez la qualité/.test(fpsC.advice)&&!/éclairez/.test(fpsC.advice),'caméra rapide mais encodage lent : conseil de baisser la qualité');
{const dir4=fs.mkdtempSync(path.join(os.tmpdir(),'j4-'));const Y=createJournal(dir4),y0=now-3600e3;
 Y.log('join',{room:'cam2',role:'publisher',ip:'192.168.1.165'},y0);
 for(let i=0;i<40;i++)Y.log('snap',{room:'cam2',pub:true,view:true,fps:12,cfps:12,rtt:20,loss:0,level:'bad'},y0+5000+i*10000);
 const x=summarize(Y.read(1)).text;
 assert(/alors que la latence est bonne : le Wi-Fi n'est pas en cause, c'est le téléphone/.test(x)&&/ne fournit que 12 images\/s : éclairez mieux/.test(x),'diagnostic : problème de téléphone et non de Wi-Fi');
 const dir5=fs.mkdtempSync(path.join(os.tmpdir(),'j5-'));const Y2=createJournal(dir5);
 Y2.log('join',{room:'cam3',role:'publisher',ip:'192.168.1.179'},y0);
 for(let i=0;i<40;i++)Y2.log('snap',{room:'cam3',pub:true,view:true,fps:25,rtt:600,loss:1,level:'bad'},y0+5000+i*10000);
 assert(!/c'est le téléphone/.test(summarize(Y2.read(1)).text),'latence élevée : pas accusé le téléphone à tort');}
console.log('cadence caméra : ok');

