const db=require('./db'),enc=require('./crypto');
function publicSettings(){const s=db.readPaymentSettings();return{enabled:!!s.enabled,environment:s.environment||'test',publicKey:s.publicKey||'',hasAccessToken:!!s.accessTokenEncrypted,accessTokenMasked:s.accessTokenEncrypted?'••••••••••••'+(s.accessTokenLast4||''):null,hasWebhookSecret:!!s.webhookSecretEncrypted,webhookSecretMasked:s.webhookSecretEncrypted?'••••••••••••'+(s.webhookSecretLast4||''):null,lastTestStatus:s.lastTestStatus||null,lastTestAt:s.lastTestAt||null}}
function getAccessToken(){const s=db.readPaymentSettings();return s.accessTokenEncrypted?enc.decrypt(s.accessTokenEncrypted):null}
function getWebhookSecret(){const s=db.readPaymentSettings();return s.webhookSecretEncrypted?enc.decrypt(s.webhookSecretEncrypted):null}
module.exports={publicSettings,getAccessToken,getWebhookSecret};
