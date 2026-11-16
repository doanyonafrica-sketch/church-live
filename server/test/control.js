/* Vue simple de la fenêtre du PC : un état et une phrase claire par caméra */
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/control.html'),'utf8');
const slice=(a,b)=>{const i=html.indexOf(a),j=html.indexOf(b,i);assert(i>=0&&j>i,'repère introuvable : '+a);return html.slice(i,j)};
const ctx=vm.runInContext(slice('const hq=','function statHtml(')+';({hq,conn,verdict,lowBat,testHtml})',vm.createContext({}));

/* définition en mots */
assert.strictEqual(ctx.hq('1920×1080'),'Full HD 1080p');assert.strictEqual(ctx.hq('1280×720'),'HD 720p');assert.strictEqual(ctx.hq('854×480'),'480p');assert.strictEqual(ctx.hq(''),'—');

/* connexion : le pire des trois critères (Wi-Fi, pertes, latence) décide */
assert.strictEqual(ctx.conn({rssi:-50,loss:0,rtt:10})[0],'Excellente');
assert.strictEqual(ctx.conn({rssi:-65,loss:0,rtt:10})[0],'Bonne');
assert.strictEqual(ctx.conn({rssi:-75,loss:0,rtt:10})[0],'Moyenne');
assert.strictEqual(ctx.conn({rssi:-85,loss:0,rtt:10})[0],'Mauvaise');
assert.strictEqual(ctx.conn({rssi:null,loss:0,rtt:10})[0],'Excellente','en USB (sans Wi-Fi) : on juge sur le réseau');
assert.strictEqual(ctx.conn({rssi:-50,loss:5,rtt:10})[0],'Mauvaise','beaucoup de pertes : mauvaise même avec un bon signal');
assert.strictEqual(ctx.conn({rssi:-50,loss:0,rtt:200})[0],'Mauvaise');
assert.strictEqual(ctx.conn({rssi:-50,loss:2,rtt:10})[0],'Moyenne');

/* état et phrase */
const v=(x,st,vs)=>ctx.verdict(x,st,vs);
let r=v({viewer:false},null,null);assert(r.lv===''&&/OBS/.test(r.t)&&/Ajoutez/.test(r.d),'téléphone prêt, OBS absent');
r=v({viewer:true},null,null);assert(r.lv===''&&/Connexion/.test(r.t),'connexion en cours');
r=v({viewer:true},{level:'ok'},{dropped:0,lost:0});assert(r.lv==='ok'&&r.t==='Tout va bien','tout va bien');
r=v({viewer:true},{level:'ok'},{dropped:2,lost:0});assert(r.lv==='warn'&&/OBS perd/.test(r.d),'OBS perd des images');
r=v({viewer:true},{level:'warn',diag:'Batterie faible (15 %).'},null);assert(r.lv==='warn'&&/Batterie/.test(r.d),'le conseil du téléphone est repris');
r=v({viewer:true},{level:'bad',diag:'Le réseau est instable.'},null);assert(r.lv==='bad'&&r.t==='Problème'&&/réseau/.test(r.d));
r=v({viewer:false},{level:'ok'},null);assert(/OBS n'est pas connecté/.test(r.d),'on signale qu\'OBS n\'est pas branché sur cette caméra');
/* alerte batterie en haut de la fenêtre */
const rm=(room,b,ch,age)=>({room,stats:{battery:b,charging:ch,age:age==null?1000:age}});
assert.strictEqual(ctx.lowBat([rm('main',80,false),rm('cam2',50,false)]),null,'batteries correctes : pas d\'alerte');
assert.strictEqual(ctx.lowBat([rm('main',12,true)]),null,'faible mais en charge : pas d\'alerte');
assert.strictEqual(ctx.lowBat([rm('main',12,false,9000)]),null,'mesure trop ancienne : pas d\'alerte');
let lb=ctx.lowBat([rm('main',24,false),rm('cam2',80,false)]);assert(lb&&lb.cls===''&&/Caméra 1 \(24 %\)/.test(lb.html)&&!/Caméra 2/.test(lb.html),'alerte orange pour la caméra 1 seulement');
lb=ctx.lowBat([rm('main',24,false),rm('cam3',9,undefined)]);assert(lb.cls==='bad'&&/Caméra 3 \(9 %\)/.test(lb.html),'rouge sous 15 %, et un téléphone qui ne dit pas s\'il est branché est traité comme non branché');
lb=ctx.lowBat([rm('<b>x</b>',10,false)]);assert(!/<b>/.test(lb.html),'le nom de la caméra ne peut pas injecter de HTML');
/* test d'aptitude : boutons, progression, verdict */
assert.strictEqual(ctx.testHtml(null,{room:'main',publisher:false}),'','pas de téléphone, pas de test proposé');
let th=ctx.testHtml(null,{room:'main',publisher:true});assert(/data-test="start"/.test(th)&&/data-room="main"/.test(th)&&/Test rapide \(5 min\)/.test(th)&&/data-min="10"/.test(th)&&/Test complet \(10 min\)/.test(th),'boutons de démarrage (5 et 10 minutes)');
th=ctx.testHtml({running:true,elapsed:125000,dur:300000,drops:1},{room:'cam2',publisher:true});assert(/2:05 \/ 5:00/.test(th)&&/width:42%/.test(th)&&/data-test="stop"/.test(th)&&/1 coupure/.test(th),'progression et arrêt');
th=ctx.testHtml({running:false,result:{verdict:'non',title:'Non apte au direct',scope:'Testé en 720p. ',device:'moto g pure',checks:[{status:'fail',name:'Fluidité',detail:'12 images/s'},{status:'ok',name:'Pertes',detail:'0 %'}],advice:['Baissez la qualité.']}},{room:'cam2',publisher:true});
assert(/tv non/.test(th)&&/Non apte au direct/.test(th)&&/✗ <b>Fluidité/.test(th)&&/✓ <b>Pertes/.test(th)&&/Baissez la qualité/.test(th)&&/Refaire \(5 min\)/.test(th)&&/Refaire \(10 min\)/.test(th),'carte du verdict');
th=ctx.testHtml({running:false,result:{verdict:'apte',title:'<img src=x onerror=alert(1)>',checks:[],advice:[]}},{room:'<b>x</b>',publisher:true});assert(!/<img|<b>x/.test(th),'aucune injection de HTML');
console.log('OK vue simple du PC (états, connexion en mots)');
