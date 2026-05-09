const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CLIENT_ID     = 'f11da241-3e4b-40a6-b365-b8660080fe70';
const CLIENT_SECRET = '4723fbf4-a28a-4366-b894-77890e18c71f';
const BASE_URL      = 'https://api.syncpayments.com.br';

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
    if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

    const res = await fetch(`${BASE_URL}/api/partner/v1/auth-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET })
    });

    const data = await res.json();
    process.stdout.write('Auth response: ' + JSON.stringify(data) + '\n');

    if (!data.access_token) throw new Error('Token falhou: ' + JSON.stringify(data));

    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (55 * 60 * 1000);
    return cachedToken;
}

app.get('/status', (req, res) => {
    res.json({ status: 'ok', message: 'Backend SyncPay rodando!' });
});

// Rota de teste — acesse no navegador para ver se o token funciona
app.get('/testar-token', async (req, res) => {
    try {
        const token = await getToken();
        res.json({ sucesso: true, token: token.substring(0, 20) + '...' });
    } catch (err) {
        res.json({ sucesso: false, erro: err.message });
    }
});

app.post('/criar-pix', async (req, res) => {
    const { valor, plano, nome, cpf, email, telefone } = req.body;

    process.stdout.write('Recebido: ' + JSON.stringify({ valor, plano, nome, cpf, email, telefone }) + '\n');

    if (!valor || !nome || !cpf || !email || !telefone) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }

    try {
        const token = await getToken();

        const payload = {
            amount: valor,
            description: plano || 'Assinatura',
            client: {
                name: nome,
                cpf: cpf.replace(/\D/g, ''),
                email: email,
                phone: telefone.replace(/\D/g, '')
            }
        };

        process.stdout.write('Enviando para SyncPay: ' + JSON.stringify(payload) + '\n');

        const response = await fetch(`${BASE_URL}/api/partner/v1/cash-in`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        process.stdout.write('CashIn response: ' + JSON.stringify(data) + '\n');

        if (data.pix_code) {
            return res.json({ pixCode: data.pix_code, identifier: data.identifier });
        } else {
            return res.status(500).json({ error: 'PIX não gerado', raw: data });
        }

    } catch (err) {
        process.stdout.write('ERRO: ' + err.message + '\n');
        return res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => process.stdout.write('Servidor rodando na porta ' + PORT + '\n'));
