/* Vue simple de la fenêtre du PC : un état et une phrase claire par caméra */
const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'../public/control.html'),'utf8');
const slice=(a,b)=>{const i=html.indexOf(a),j=html.indexOf(b,i);assert(i>=0&&j>i,'repère introuvable : '+a);return html.slice(i,j)};
const ctx=vm.runInContext(slice('const hq=','function statHtml(')+';({hq,conn,verdict})',vm.createContext({}));

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
console.log('OK vue simple du PC (états, connexion en mots)');
