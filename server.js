const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Suas chaves SyncPay
const SYNCPAY_SECRET_KEY = 'f981adad-8afa-4a7c-bbf9-3896e886f262';
const SYNCPAY_PUBLIC_KEY = 'f04a8fb0-2ad9-4911-91e0-b79e3b08779a';

// Rota de saúde
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/status', (req, res) => {
    res.json({ status: 'ok', message: 'Backend SyncPay rodando!' });
});

// Gerar PIX — sem precisar de CPF/nome
app.post('/criar-pix', async (req, res) => {
    const { valor, plano } = req.body;

    if (!valor) {
        return res.status(400).json({ error: 'Valor obrigatório' });
    }

    try {
        const response = await fetch('https://api.syncpay.pro/v1/transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SYNCPAY_SECRET_KEY}`,
                'x-api-key': SYNCPAY_SECRET_KEY
            },
            body: JSON.stringify({
                amount: valor,          // valor em centavos (ex: 1388 = R$13,88)
                payment_method: 'pix',
                description: plano || 'Assinatura'
            })
        });

        const data = await response.json();
        console.log('SyncPay response:', JSON.stringify(data));

        // Tenta pegar o código PIX em diferentes campos possíveis
        const pixCode =
            data?.pix_code ||
            data?.pixCode ||
            data?.qr_code ||
            data?.brcode ||
            data?.data?.pix_code ||
            data?.data?.qr_code ||
            data?.transaction?.pix_code ||
            null;

        if (pixCode) {
            return res.json({ pixCode });
        } else {
            console.error('PIX code não encontrado na resposta:', data);
            return res.status(500).json({ error: 'PIX não gerado', raw: data });
        }

    } catch (err) {
        console.error('Erro ao chamar SyncPay:', err);
        return res.status(500).json({ error: 'Erro interno', details: err.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
