const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// ========== CONFIGURAÇÕES ==========
// Cole aqui suas chaves da SyncPay
const SYNCPAY_API_KEYS = [
  'f981adad-8afa-4a7c-bbf9-3896e886f262',
  'f04a8fb0-2ad9-4911-91e0-b79e3b08779a'
];

// Use a primeira chave como principal (ajuste conforme documentação deles)
const SYNCPAY_API_KEY = SYNCPAY_API_KEYS[0];
const SYNCPAY_BASE_URL = 'https://api.syncpay.pro/v1'; // confirmar URL na doc deles

// ========== ROTA CRIAR PIX ==========
app.post('/criar-pix', async (req, res) => {
  const { nome, email, cpf, valor, plano } = req.body;

  if (!nome || !email || !cpf || !valor) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  try {
    const response = await fetch(`${SYNCPAY_BASE_URL}/transactions/pix`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SYNCPAY_API_KEY}`
      },
      body: JSON.stringify({
        amount: valor, // em centavos (ex: 1388 = R$13,88)
        customer: {
          name: nome,
          email: email,
          cpf: cpf
        },
        items: [
          {
            title: plano,
            quantity: 1,
            unitPrice: valor,
            tangible: false
          }
        ],
        pix: {
          expiresInDays: 1
        },
        postbackUrl: `https://SEU-BACKEND.up.railway.app/webhook`
      })
    });

    const data = await response.json();

    // Retorna o código PIX para o frontend
    // (ajustar campo conforme resposta real da API SyncPay)
    if (data.pix && data.pix.qrcode) {
      return res.json({ pixCode: data.pix.qrcode });
    } else if (data.pixCode) {
      return res.json({ pixCode: data.pixCode });
    } else {
      console.error('Resposta SyncPay:', JSON.stringify(data));
      return res.status(500).json({ error: 'Erro ao gerar PIX', detalhes: data });
    }

  } catch (err) {
    console.error('Erro:', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
});

// ========== WEBHOOK ==========
app.post('/webhook', (req, res) => {
  const payload = req.body;
  console.log('Webhook recebido:', JSON.stringify(payload));
  // Aqui você pode processar a confirmação de pagamento
  res.sendStatus(200);
});

// ========== HEALTH CHECK ==========
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Backend SyncPay rodando!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
