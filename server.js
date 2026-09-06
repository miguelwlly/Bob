require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const menu = require('./menu');
const db = require('./db');
const enc = require('./crypto');
const settings = require('./configurações');
const mp = require('./mercadopago');
const { createPixPayment } = require('./mercadopago');

let adminConfig;
try {
  adminConfig = require('./admin-config.js');
} catch (e) {
  console.error('❌ admin-config.js não encontrado!');
  adminConfig = { ADMIN_PASSWORD: 'burgerbob2727@', PRODUCTS: [], ADDITIONALS: [], STORE_CONFIG: {} };
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BACKEND_URL = (process.env.BACKEND_URL || APP_URL).replace(/\/$/, '');

function env(n) {
  if (!process.env[n]) throw new Error(`${n} não configurada`);
  return process.env[n];
}

function adminAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'Não autorizado.' });
  try {
    const p = jwt.verify(t, env('ADMIN_JWT_SECRET'));
    if (p.role !== 'admin') throw 0;
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão expirada ou inválida.' });
  }
}

app.get('/api/health', (q, s) => s.json({ ok: true }));

app.get('/api/menu', (q, s) => {
  const c = db.readConfig();
  const p = db.readPaymentSettings();
  s.json({
    products: menu.products,
    additionals: menu.additionals,
    config: {
      deliveryFee: c.deliveryFee,
      schedule: c.schedule,
      address: c.address,
      storeName: 'Bob Burguer',
      allowedCity: c.allowedCity,
      allowedUf: c.allowedUf
    },
    mercadopago: {
      enabled: !!p.enabled,
      publicKey: p.enabled ? p.publicKey : null
    }
  });
});

app.post('/api/admin/login', (req, res) => {
  try {
    if (String(req.body?.username || '') !== env('ADMIN_USERNAME') || !bcrypt.compareSync(String(req.body?.password || ''), env('ADMIN_PASSWORD_HASH'))) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }
    res.json({ token: jwt.sign({ role: 'admin' }, env('ADMIN_JWT_SECRET'), { expiresIn: '12h' }) });
  } catch (e) {
    res.status(500).json({ error: 'Admin não configurado corretamente.' });
  }
});

function calcOrder(p, c) {
  const e = [];
  if (!Array.isArray(p.items) || !p.items.length) e.push('Carrinho vazio.');
  if (!['entrega', 'retirada'].includes(p.deliveryType)) e.push('Tipo de entrega inválido.');
  if (!p.customer?.name || !p.customer?.phone) e.push('Dados do cliente incompletos.');
  if (p.deliveryType === 'entrega') {
    const a = p.address;
    if (!a?.street || !a?.number || !a?.neighborhood || !a?.cep) e.push('Endereço incompleto.');
    if (a && (a.city || '').toLowerCase() !== (c.allowedCity || 'Breu Branco').toLowerCase()) {
      e.push(`Só entregamos em ${c.allowedCity || 'Breu Branco'} - ${c.allowedUf || 'PA'}.`);
    }
  }
  if (e.length) return { errors: e };
  const items = [];
  for (const r of p.items) {
    const x = menu.products.find(z => z.id === r.productId);
    if (!x) { e.push(`Produto inválido: ${r.productId}`); continue; }
    const q = Math.max(1, Math.min(99, parseInt(r.quantity, 10) || 1));
    const adds = [];
    if (x.allowsAdditionals && Array.isArray(r.additionalIds)) {
      for (const id of r.additionalIds) {
        const a = [...menu.additionals.lunch, ...menu.additionals.sides].find(z => z.id === id && z.active);
        if (a) adds.push({ id: a.id, name: a.name, price: Number(a.price) });
      }
    }
    items.push({ productId: x.id, productName: x.name, unitPrice: Number(x.price), quantity: q, additionals: adds });
  }
  if (e.length) return { errors: e };
  const sub = items.reduce((s, i) => s + (i.unitPrice + i.additionals.reduce((a, x) => a + x.price, 0)) * i.quantity, 0);
  const fee = p.deliveryType === 'entrega' ? Number(c.deliveryFee || 0) : 0;
  return { items, subtotal: Number(sub.toFixed(2)), deliveryFee: Number(fee.toFixed(2)), total: Number((sub + fee).toFixed(2)) };
}

function nextNumber() {
  const y = new Date().getFullYear();
  const n = db.readOrders().filter(o => o.orderNumber?.startsWith(`BOB-${y}-`)).length + 1;
  return `BOB-${y}-${String(n).padStart(6, '0')}`;
}

app.post('/api/orders', async (req, res) => {
  try {
    const p = req.body || {};
    const c = db.readConfig();
    const ps = db.readPaymentSettings();

    if (p.idempotencyKey) {
      const old = db.findOrderByIdempotencyKey(p.idempotencyKey);
      if (old) return res.json({ orderId: old.id, orderNumber: old.orderNumber, checkoutUrl: old.checkoutUrl });
    }

    const calc = calcOrder(p, c);
    if (calc.errors) return res.status(400).json({ error: calc.errors.join(' ') });

    if (!ps.enabled || !ps.accessTokenEncrypted) {
      return res.status(503).json({ error: 'Mercado Pago ainda não está configurado no painel administrativo.' });
    }

    const o = {
      id: crypto.randomUUID(),
      orderNumber: nextNumber(),
      externalReference: '',
      createdAt: new Date().toISOString(),
      customerName: p.customer.name,
      phone: p.customer.phone,
      deliveryType: p.deliveryType,
      address: p.deliveryType === 'entrega' ? p.address : null,
      ...calc,
      paymentStatus: 'PENDING',
      orderStatus: 'RECEBIDO',
      paymentProvider: 'mercadopago',
      paymentId: null,
      checkoutUrl: null,
      idempotencyKey: p.idempotencyKey || null
    };

    o.externalReference = o.orderNumber;

    const webhook = /^https:\/\//i.test(BACKEND_URL) ? `${BACKEND_URL}/api/payments/webhook` : null;

    const pref = await mp.createPreference(o, enc.decrypt(ps.accessTokenEncrypted), {
      success: `${APP_URL}/sucesso.html?order=${encodeURIComponent(o.id)}`,
      pending: `${APP_URL}/pendente.html?order=${encodeURIComponent(o.id)}`,
      failure: `${APP_URL}/falha.html?order=${encodeURIComponent(o.id)}`,
      webhook
    });

    o.checkoutUrl = ps.environment === 'production' ? (pref.init_point || null) : (pref.sandbox_init_point || pref.init_point || null);

    if (!o.checkoutUrl) throw Error('Checkout URL ausente');

    db.saveOrder(o);

    res.json({ orderId: o.id, orderNumber: o.orderNumber, checkoutUrl: o.checkoutUrl });
  } catch (e) {
    console.error('ERRO MERCADO PAGO:', e.response?.data || e.message || e);
    res.status(502).json({ error: e.response?.data?.message || e.message || 'Não foi possível iniciar o pagamento agora.' });
  }
});

function validWebhook(req) {
  const secret = settings.getWebhookSecret();
  if (!secret) return true;
  const sig = req.headers['x-signature'];
  const rid = req.headers['x-request-id'];
  const id = req.query['data.id'] || req.body?.data?.id || '';
  if (!sig || !rid || !id) return false;
  let ts = '', v1 = '';
  for (const p of String(sig).split(',')) {
    const [k, ...r] = p.trim().split('=');
    if (k === 'ts') ts = r.join('=');
    if (k === 'v1') v1 = r.join('=');
  }
  if (!ts || !v1) return false;
  const m = `id:${id};request-id:${rid};ts:${ts};`;
  const h = crypto.createHmac('sha256', secret).update(m).digest('hex');
  if (h.length !== v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(v1));
}

app.post('/api/payments/webhook', async (req, res) => {
  try {
    if (!validWebhook(req)) return res.sendStatus(401);
    const topic = req.query.type || req.query.topic || req.body?.type;
    const id = req.query['data.id'] || req.body?.data?.id || req.query.id;
    if (topic && topic !== 'payment' || !id) return res.sendStatus(200);
    const token = settings.getAccessToken();
    if (!token) return res.sendStatus(200);
    const pay = await mp.getPayment(id, token);
    const ref = pay.external_reference;
    if (!ref) return res.sendStatus(200);
    const o = db.findOrderByExternalReference(ref);
    if (!o) return res.sendStatus(200);
    if (pay.status === 'approved') {
      const valorPago = Number(pay.transaction_amount);
      const valorPedido = Number(o.total);
      if (pay.currency_id !== 'BRL' || valorPago !== valorPedido) {
        return res.sendStatus(200);
      }
      db.updateOrder(o.id, { paymentStatus: 'APPROVED', paymentId: String(pay.id) });
    } else {
      db.updateOrder(o.id, { paymentStatus: mp.mapPaymentStatus(pay.status), paymentId: String(pay.id) });
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('Webhook', e);
    res.sendStatus(500);
  }
});

app.get('/api/admin/orders', adminAuth, (q, s) => s.json({ orders: db.readOrders().slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) }));

app.patch('/api/admin/orders/:id', adminAuth, (req, res) => {
  const allowed = ['RECEBIDO', 'EM PREPARAÇÃO', 'PRONTO', 'SAIU PARA ENTREGA', 'FINALIZADO', 'CANCELADO'];
  if (!allowed.includes(req.body?.orderStatus)) return res.status(400).json({ error: 'Status inválido.' });
  const o = db.updateOrder(req.params.id, { orderStatus: req.body.orderStatus });
  if (!o) return res.status(404).json({ error: 'Pedido não encontrado.' });
  res.json({ order: o });
});

app.get('/api/admin/config', adminAuth, (q, s) => s.json(db.readConfig()));

app.put('/api/admin/config', adminAuth, (req, res) => {
  const c = db.readConfig();
  const n = { ...c, deliveryFee: Number(req.body?.deliveryFee ?? c.deliveryFee) || 0, whatsapp: String(req.body?.whatsapp ?? c.whatsapp), schedule: String(req.body?.schedule ?? c.schedule), address: String(req.body?.address ?? c.address) };
  db.writeConfig(n);
  res.json(n);
});

app.get('/api/admin/settings/mercadopago', adminAuth, (q, s) => s.json(settings.publicSettings()));

app.post('/api/admin/settings/mercadopago', adminAuth, async (req, res) => {
  try {
    const c = db.readPaymentSettings();
    const b = req.body || {};
    const n = { ...c, enabled: !!b.enabled, environment: b.environment === 'production' ? 'production' : 'test', publicKey: typeof b.publicKey === 'string' ? b.publicKey.trim() : (c.publicKey || '') };
    if (typeof b.accessToken === 'string' && b.accessToken.trim()) {
      const t = b.accessToken.trim();
      const test = await mp.testConnection(t);
      if (!test.ok) return res.status(400).json({ error: 'Access Token inválido ou não aceito pela API.' });
      n.accessTokenEncrypted = enc.encrypt(t);
      n.accessTokenLast4 = enc.last4(t);
      n.lastTestStatus = 'connected';
      n.lastTestAt = new Date().toISOString();
    }
    if (typeof b.webhookSecret === 'string' && b.webhookSecret.trim()) {
      n.webhookSecretEncrypted = enc.encrypt(b.webhookSecret.trim());
      n.webhookSecretLast4 = enc.last4(b.webhookSecret.trim());
    }
    if (n.enabled && !n.accessTokenEncrypted) return res.status(400).json({ error: 'Informe um Access Token antes de ativar o Mercado Pago.' });
    db.writePaymentSettings(n);
    res.json(settings.publicSettings());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erro ao salvar configurações do Mercado Pago.' });
  }
});

app.post('/api/admin/settings/mercadopago/test', adminAuth, async (req, res) => {
  try {
    const t = settings.getAccessToken();
    if (!t) return res.json({ status: 'incomplete', message: 'Nenhum Access Token configurado.' });
    const r = await mp.testConnection(t);
    const st = r.ok ? 'connected' : r.reason === 'invalid' ? 'invalid' : 'error';
    const c = db.readPaymentSettings();
    db.writePaymentSettings({ ...c, lastTestStatus: st, lastTestAt: new Date().toISOString() });
    res.json({ status: st, message: st === 'connected' ? 'Conexão funcionando.' : st === 'invalid' ? 'Credencial inválida.' : 'Erro ao conectar com o Mercado Pago.' });
  } catch {
    res.status(500).json({ status: 'error', message: 'Erro ao testar a conexão.' });
  }
});

app.post('/api/create-pix', async (req, res) => {
  try {
    const { order, email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email é obrigatório' });
    const ps = db.readPaymentSettings();
    if (!ps.enabled || !ps.accessTokenEncrypted) return res.status(503).json({ error: 'Mercado Pago não configurado.' });
    const accessToken = enc.decrypt(ps.accessTokenEncrypted);
    const result = await createPixPayment(order, accessToken, email);
    const qrData = result.body.point_of_interaction?.transaction_data;
    if (!qrData) return res.status(500).json({ error: 'Erro ao gerar QR Code' });
    res.json({ qr_code_base64: qrData.qr_code_base64string, qr_code_text: qrData.qr_code, payment_id: result.body.id, status: result.body.status });
  } catch (error) {
    console.error('Erro ao gerar Pix:', error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================
// ROTAS ADMIN COM admin-config.js
// =============================================

app.get('/api/products', (req, res) => {
  try {
    let status = {};
    try { status = JSON.parse(fs.readFileSync('./product_status.json', 'utf8')); } catch (e) {}
    const products = adminConfig.PRODUCTS.map(p => ({ ...p, available: status[p.id] !== false }));
    res.json({ products, additionals: adminConfig.ADDITIONALS, config: adminConfig.STORE_CONFIG });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar produtos' });
  }
});

app.post('/api/admin/login-v2', (req, res) => {
  try {
    const { password } = req.body;
    if (password === adminConfig.ADMIN_PASSWORD) {
      const token = jwt.sign({ role: 'admin' }, env('ADMIN_JWT_SECRET'), { expiresIn: '24h' });
      res.json({ success: true, token });
    } else {
      res.status(401).json({ error: 'Senha incorreta' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro no login' });
  }
});

app.post('/api/admin/toggle-product', adminAuth, (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ error: 'ID do produto é obrigatório' });
    let status = {};
    try { status = JSON.parse(fs.readFileSync('./product_status.json', 'utf8')); } catch (e) {}
    status[productId] = status[productId] === false ? true : false;
    fs.writeFileSync('./product_status.json', JSON.stringify(status, null, 2));
    res.json({ success: true, productId, available: status[productId] });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao alternar produto' });
  }
});

app.get('/api/admin/product-status', adminAuth, (req, res) => {
  try {
    let status = {};
    try { status = JSON.parse(fs.readFileSync('./product_status.json', 'utf8')); } catch (e) {}
    res.json({ status });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar status' });
  }
});

app.get('/api/admin/orders-v2', adminAuth, (req, res) => {
  try {
    const orders = db.readOrders();
    const { status, deliveryType, search } = req.query;
    let filtered = orders.slice();
    if (status && status !== 'todos') filtered = filtered.filter(o => o.paymentStatus === status);
    if (deliveryType && deliveryType !== 'todos') filtered = filtered.filter(o => o.deliveryType === deliveryType);
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(o => (o.customerName || '').toLowerCase().includes(q) || (o.phone || '').includes(q) || (o.orderNumber || '').toLowerCase().includes(q));
    }
    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ orders: filtered });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar pedidos' });
  }
});

app.get('/api/admin/stats', adminAuth, (req, res) => {
  try {
    const orders = db.readOrders();
    const total = orders.length;
    const pending = orders.filter(o => o.paymentStatus === 'PENDING').length;
    const approved = orders.filter(o => o.paymentStatus === 'APPROVED').length;
    const rejected = orders.filter(o => o.paymentStatus === 'REJECTED').length;
    let status = {};
    try { status = JSON.parse(fs.readFileSync('./product_status.json', 'utf8')); } catch (e) {}
    const totalProducts = adminConfig.PRODUCTS.length;
    const availableProducts = adminConfig.PRODUCTS.filter(p => status[p.id] !== false).length;
    res.json({ orders: { total, pending, approved, rejected }, products: { total: totalProducts, available: availableProducts } });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar estatísticas' });
  }
});

app.get('/api/admin/store-config', adminAuth, (req, res) => {
  try {
    const c = db.readConfig();
    res.json({ deliveryFee: c.deliveryFee || adminConfig.STORE_CONFIG.deliveryFee, whatsapp: c.whatsapp || adminConfig.STORE_CONFIG.whatsapp, schedule: c.schedule || adminConfig.STORE_CONFIG.horario, address: c.address || adminConfig.STORE_CONFIG.endereco });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao carregar configurações' });
  }
});

app.put('/api/admin/store-config', adminAuth, (req, res) => {
  try {
    const c = db.readConfig();
    const n = { ...c, deliveryFee: Number(req.body.deliveryFee ?? c.deliveryFee) || 0, whatsapp: String(req.body.whatsapp ?? c.whatsapp), schedule: String(req.body.schedule ?? c.schedule), address: String(req.body.address ?? c.address) };
    db.writeConfig(n);
    res.json(n);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao salvar configurações' });
  }
});

app.listen(PORT, () => console.log(`Bob Burguer rodando em http://localhost:${PORT}`));
