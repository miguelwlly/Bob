const fs=require('fs'),path=require('path');
const DIR=path.join(__dirname,'data'), ORD=path.join(DIR,'orders.json'), CFG=path.join(DIR,'config.json'), SET=path.join(DIR,'settings.json');
function init(f,v){fs.mkdirSync(DIR,{recursive:true});if(!fs.existsSync(f))fs.writeFileSync(f,JSON.stringify(v,null,2))}
init(ORD,[]);init(CFG,{deliveryFee:5,whatsapp:'5594991670523',schedule:'Seg–Dom: 18h às 23h',address:'Av. Getúlio Vargas - Centro, Breu Branco - PA, CEP 68488-000',allowedCity:'Breu Branco',allowedUf:'PA'});
init(SET,{enabled:false,environment:'test',publicKey:'',accessTokenEncrypted:null,accessTokenLast4:null,webhookSecretEncrypted:null,webhookSecretLast4:null,lastTestStatus:null,lastTestAt:null});
function read(f,d){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}} function write(f,v){fs.writeFileSync(f,JSON.stringify(v,null,2))}
module.exports={
readOrders(){return read(ORD,[])},saveOrder(o){const x=read(ORD,[]);x.push(o);write(ORD,x)},
updateOrder(id,p){const x=read(ORD,[]),i=x.findIndex(o=>o.id===id);if(i<0)return null;x[i]={...x[i],...p,updatedAt:new Date().toISOString()};write(ORD,x);return x[i]},
findOrderById(id){return read(ORD,[]).find(o=>o.id===id)||null},
findOrderByExternalReference(r){return read(ORD,[]).find(o=>o.externalReference===r)||null},
findOrderByIdempotencyKey(k){return read(ORD,[]).find(o=>o.idempotencyKey===k)||null},
readConfig(){return read(CFG,{})},writeConfig(v){write(CFG,v)},
readPaymentSettings(){return read(SET,{})},writePaymentSettings(v){write(SET,v)}
};
