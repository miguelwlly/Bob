
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

function clientFor(accessToken) {
  return new MercadoPagoConfig({
    accessToken,
    options: { timeout: 8000 }
  });
}

async function createPreference(order, token, urls) {
  if (!urls?.success || !urls?.pending || !urls?.failure) {
    throw new Error('URLs de retorno não configuradas.');
  }

  const preference = new Preference(clientFor(token));

  const items = order.items.map(i => ({
    title: i.productName + (i.additionals?.length
      ? ` (+ ${i.additionals.map(a => a.name).join(', ')})`
      : ''),
    quantity: i.quantity,
    unit_price: Number(
      (i.unitPrice + (i.additionals || []).reduce((s, a) => s + a.price, 0)).toFixed(2)
    ),
    currency_id: 'BRL'
  }));

  if (order.deliveryFee > 0) {
    items.push({
      title: 'Taxa de entrega',
      quantity: 1,
      unit_price: Number(order.deliveryFee.toFixed(2)),
      currency_id: 'BRL'
    });
  }

  const body = {
    items,
    external_reference: order.externalReference,
    payer: {
      name: order.customerName,
      phone: {
        number: String(order.phone || '').replace(/\D/g, '')
      }
    },
    back_urls: {
      success: urls.success,
      pending: urls.pending,
      failure: urls.failure
    },
    auto_return: 'approved',
    statement_descriptor: 'BOB BURGUER'
  };

  if (urls.webhook) {
    body.notification_url = urls.webhook;
  }

  return preference.create({ body });
}

async function getPayment(id, token) {
  const payment = new Payment(clientFor(token));
  return payment.get({ id });
}

async function testConnection(token) {
  const r = await fetch('https://api.mercadopago.com/v1/payment_methods', {
    headers: {
      Authorization: 'Bearer ' + token
    }
  });

  if (r.status === 401 || r.status === 403) {
    return { ok: false, reason: 'invalid' };
  }

  return { ok: r.ok, reason: r.ok ? undefined : 'error' };
}

function mapPaymentStatus(status) {
  return ({
    approved: 'APPROVED',
    pending: 'PENDING',
    in_process: 'PENDING',
    authorized: 'PENDING',
    rejected: 'REJECTED',
    cancelled: 'CANCELLED',
    refunded: 'REFUNDED',
    charged_back: 'REFUNDED'
  })[status] || 'PENDING';
}

module.exports = {
  createPreference,
  getPayment,
  testConnection,
  mapPaymentStatus
};
