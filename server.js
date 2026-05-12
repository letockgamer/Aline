const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Resend } = require('resend');

const resend = new Resend('re_VbhqVWve_9TovVRqoLYB6eXqD4DtxEX5Y');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
    const { valor, plano, nome, cpf, email, telefone } = req.body;
    if (!valor || !nome || !cpf || !email || !telefone) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
    }
    try {
        const token = await getToken();
        const response = await fetch(`${BASE_URL}/api/partner/v1/cash-in`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                amount: valor,
                description: plano || 'Assinatura',
                webhook_url: 'https://aline-production.up.railway.app/webhook',
                client: {
                    name: nome,
                    cpf: cpf.replace(/\D/g, ''),
                    email: email,
                    phone: telefone.replace(/\D/g, '')
                }
            })
        });
        const data = await response.json();
        process.stdout.write('CashIn: ' + JSON.stringify(data) + '\n');

        if (data.pix_code) {
            // Salva dados do cliente para usar no webhook
            if (data.identifier) {
                tokens[data.identifier] = { nome, email, plano, status: 'pending' };
            }
            return res.json({ pixCode: data.pix_code, identifier: data.identifier });
        } else {
            return res.status(500).json({ error: 'PIX não gerado', raw: data });
        }
    } catch (err) {
        process.stdout.write('ERRO: ' + err.message + '\n');
        return res.status(500).json({ error: err.message });
    }
});

// Webhook SyncPay — chamado quando pagamento é confirmado
app.post('/webhook', async (req, res) => {
    const body = req.body;
    process.stdout.write('Webhook: ' + JSON.stringify(body) + '\n');

    const identifier = body.identifier || body.id;
    const status = body.status;

    if (status === 'paid' || status === 'approved' || status === 'completed') {
        const cliente = tokens[identifier];
        if (cliente && cliente.status === 'pending') {
            const accessToken = gerarToken();
            tokens[accessToken] = {
                nome: cliente.nome,
                email: cliente.email,
                plano: cliente.plano,
                criadoEm: Date.now()
            };
            tokens[identifier].status = 'paid';

            // Envia email com link de acesso
            try {
                await enviarEmail(cliente.email, cliente.nome, accessToken, cliente.plano);
                process.stdout.write('Email enviado para: ' + cliente.email + '\n');
            } catch (err) {
                process.stdout.write('Erro email: ' + err.message + '\n');
            }
        }
    }

    res.json({ ok: true });
});

// Área de membros — valida token e serve a página
app.get('/membros', (req, res) => {
    const { token } = req.query;
    const cliente = tokens[token];

    if (!cliente) {
        return res.send(`
            <html><body style="font-family:sans-serif;text-align:center;padding:40px;">
                <h2>❌ Link inválido ou expirado</h2>
                <p>Acesse novamente pelo link enviado no seu email.</p>
            </body></html>
        `);
    }

    res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Área de Membros - Aline Oliveira</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Inter', sans-serif; background: #0a0a0a; color: #fff; min-height: 100vh; }
        header {
            background: #111;
            border-bottom: 1px solid #222;
            padding: 16px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .logo { font-size: 20px; font-weight: 800; color: #fff; letter-spacing: -0.05em; }
        .logo span { color: #e89c30; }
        .badge {
            background: linear-gradient(90deg, #e89c30, #f5bc6a);
            color: #000;
            font-size: 12px;
            font-weight: 700;
            padding: 4px 12px;
            border-radius: 999px;
        }
        .hero {
            text-align: center;
            padding: 40px 20px 24px;
        }
        .hero-avatar {
            width: 80px; height: 80px;
            border-radius: 50%;
            border: 3px solid #e89c30;
            object-fit: cover;
            margin: 0 auto 12px;
            display: block;
        }
        .hero h1 { font-size: 22px; font-weight: 800; }
        .hero p { color: #888; font-size: 14px; margin-top: 4px; }
        .welcome {
            background: #111;
            border: 1px solid #222;
            border-radius: 16px;
            padding: 16px 20px;
            margin: 0 16px 24px;
            text-align: center;
        }
        .welcome h2 { font-size: 16px; font-weight: 700; color: #e89c30; }
        .welcome p { font-size: 14px; color: #aaa; margin-top: 4px; }
        .drive-btn {
            display: block;
            margin: 0 16px 24px;
            background: linear-gradient(90deg, #e89c30, #f5bc6a);
            color: #000;
            font-size: 16px;
            font-weight: 700;
            padding: 16px;
            border-radius: 16px;
            text-align: center;
            text-decoration: none;
        }
        .info {
            margin: 0 16px;
            background: #111;
            border: 1px solid #222;
            border-radius: 16px;
            padding: 16px 20px;
        }
        .info p { font-size: 13px; color: #666; line-height: 1.6; }
    </style>
</head>
<body>
    <header>
        <div class="logo">privacy<span>.</span></div>
        <div class="badge">✓ Membro VIP</div>
    </header>
    <div class="hero">
        <img src="/img/aline_profile.png" alt="Aline" class="hero-avatar" onerror="this.style.display='none'">
        <h1>Aline Oliveira 🔥</h1>
        <p>Bem-vindo ao conteúdo exclusivo</p>
    </div>
    <div class="welcome">
        <h2>Olá, ${cliente.nome}! 🎉</h2>
        <p>Seu acesso está liberado — plano ${cliente.plano}</p>
    </div>
    <a href="https://drive.google.com/drive/folders/1PFcvnySsdlwkzSy_RSXUBk3DSVp3Rkdn" target="_blank" class="drive-btn">
        🔓 Acessar conteúdo exclusivo
    </a>
    <div class="info">
        <p>⚠️ Este link é pessoal e intransferível. Não compartilhe com ninguém. O compartilhamento pode resultar no cancelamento do seu acesso.</p>
    </div>
</body>
</html>
    `);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => process.stdout.write('Servidor rodando na porta ' + PORT + '\n'));
