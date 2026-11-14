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
setTimeout(()=>{
  const x=summarize(K.read(1)).text;
  assert(/ne s'est PAS reconnecté après la coupure/.test(x),'coupure non terminée signalée');
  assert(!/null/.test(x),'aucune valeur « null » dans le résumé');
  assert(/Aucun téléphone n'a utilisé cette caméra/.test(x));
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
