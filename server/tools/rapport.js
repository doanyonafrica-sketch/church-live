/* Résumé du journal en ligne de commande :  node tools/rapport.js [jours] [dossier-de-donnees]
   Sans dossier : ~/.tpr-live (ou la variable TPR_DATA). L'application Windows garde ses données dans %APPDATA%\TPR Live. */
const {createJournal,summarize}=require('../journal');
const days=parseInt(process.argv[2],10)||1,J=createJournal(process.argv[3]);
console.log(summarize(J.read(days)).text);
