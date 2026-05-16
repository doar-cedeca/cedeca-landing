'use strict';

const ASAAS_URLS = {
  sandbox:    'https://sandbox.asaas.com/api/v3',
  production: 'https://www.asaas.com/api/v3',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed.' });

  // Parse body (Vercel auto-parses JSON, but guard for strings)
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON.' }); }
  }

  const { type, amount } = body || {};

  // Validate type
  if (!type || !['single', 'monthly'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido. Use "single" ou "monthly".' });
  }

  // Validate amount
  const numAmount = parseFloat(String(amount || '').replace(',', '.'));
  if (isNaN(numAmount) || numAmount < 5) {
    return res.status(400).json({ error: 'Valor mínimo de doação é R$ 5,00.' });
  }

  // API key
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) {
    console.error('[CEDECA] ASAAS_API_KEY não configurada.');
    return res.status(503).json({ error: 'Serviço de pagamento não configurado.' });
  }

  const env     = (process.env.ASAAS_ENVIRONMENT || 'sandbox').toLowerCase();
  const baseUrl = ASAAS_URLS[env] ?? ASAAS_URLS.sandbox;

  const isMonthly = type === 'monthly';

  const payload = {
    name:       isMonthly ? 'Apoio mensal ao CEDECA'  : 'Doação única ao CEDECA',
    description: isMonthly
      ? 'Doação mensal recorrente — Casa dos Direitos | CEDECA Tocantins'
      : 'Apoie a Casa dos Direitos — CEDECA Tocantins',
    value:       Math.round(numAmount * 100) / 100,
    billingType: isMonthly ? 'CREDIT_CARD' : 'UNDEFINED',
    chargeType:  isMonthly ? 'RECURRENT'   : 'DETACHED',
    ...(isMonthly  && { subscriptionCycle: 'MONTHLY' }),
    ...(!isMonthly && { dueDateLimitDays: 3 }),
    isAddressRequired:   false,
    notificationDisabled: false,
    ...(process.env.DONATION_SUCCESS_URL && { successUrl: process.env.DONATION_SUCCESS_URL }),
  };

  try {
    const asaasRes = await fetch(`${baseUrl}/paymentLinks`, {
      method:  'POST',
      headers: { 'access_token': apiKey, 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    const data = await asaasRes.json();

    if (!asaasRes.ok) {
      const msg = data?.errors?.[0]?.description || 'Erro na API do Asaas.';
      console.error('[CEDECA] Asaas error:', JSON.stringify(data));
      return res.status(502).json({ error: msg });
    }

    const checkoutUrl = data.url;
    if (!checkoutUrl) {
      console.error('[CEDECA] URL não retornada pelo Asaas:', JSON.stringify(data));
      return res.status(502).json({ error: 'URL de checkout não retornada.' });
    }

    return res.status(200).json({ checkoutUrl });

  } catch (err) {
    console.error('[CEDECA] Fetch error:', err.message);
    return res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
};
