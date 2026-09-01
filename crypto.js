const crypto=require('crypto');
function key(){const h=process.env.PAYMENT_ENCRYPTION_KEY;if(!/^[0-9a-fA-F]{64}$/.test(h||''))throw new Error('PAYMENT_ENCRYPTION_KEY inválida.');return Buffer.from(h,'hex')}
function encrypt(s){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv);const d=Buffer.concat([c.update(String(s),'utf8'),c.final()]);return [iv.toString('base64'),c.getAuthTag().toString('base64'),d.toString('base64')].join(':')}
function decrypt(v){if(!v)return null;const [i,t,d]=v.split(':');const c=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(i,'base64'));c.setAuthTag(Buffer.from(t,'base64'));return Buffer.concat([c.update(Buffer.from(d,'base64')),c.final()]).toString('utf8')}
function last4(v){return v?v.slice(-4):null} module.exports={encrypt,decrypt,last4};
