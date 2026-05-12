const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { Resend } = require('resend');

const resend = new Resend('re_VbhqVWve_9TovVRqoLYB6eXqD4DtxEX5Y');

const app = express();
app.use(cors());
app.use(express.json());
// Serve arquivos estáticos exceto index.html da raiz
app.use('/img', express.static(path.join(__dirname, 'public', 'img')));
app.use('/gringo.html', express.static(path.join(__dirname, 'public', 'gringo.html')));
app.use('/membros', (req, res, next) => next());

const CLIENT_ID     = 'a53e2156-5a0b-467a-9515-ae70028bce02';
const CLIENT_SECRET = '361fe073-0a63-43cf-b3e5-35ece72440f3';
const BASE_URL      = 'https://api.syncpayments.com.br';

// ID da pasta do Google Drive
const DRIVE_FOLDER_ID = '1PFcvnySsdlwkzSy_RSXUBk3DSVp3Rkdn';

// Banco de tokens em memória (use Redis/DB em produção)
const tokens = {};

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
    if (!data.access_token) throw new Error('Token falhou: ' + JSON.stringify(data));
    cachedToken = data.access_token;
    tokenExpiry = Date.now() + (55 * 60 * 1000);
    return cachedToken;
}

function gerarToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function enviarEmail(email, nome, accessToken, plano) {
    const link = `https://aline-production.up.railway.app/membros?token=${accessToken}`;

    await resend.emails.send({
        from: 'Aline Oliveira <onboarding@resend.dev>',
        to: email,
        subject: '🔥 Seu acesso exclusivo está pronto!',
        html: `
            <div style="font-family: Inter, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
                <h2 style="color: #e89c30;">Olá, ${nome}! 🔥</h2>
                <p>Seu pagamento foi confirmado! Clique no botão abaixo para acessar o conteúdo exclusivo:</p>
                <a href="${link}" style="display: inline-block; background: linear-gradient(90deg, #e89c30, #f5bc6a); color: #000; font-weight: 700; padding: 14px 28px; border-radius: 12px; text-decoration: none; margin: 16px 0;">
                    Acessar conteúdo exclusivo 🔓
                </a>
                <p style="color: #888; font-size: 13px;">Plano: ${plano}</p>
                <p style="color: #888; font-size: 13px;">Este link é pessoal e intransferível.</p>
            </div>
        `
    });
}

// Status
app.get('/status', (req, res) => {
    res.json({ status: 'ok', message: 'Backend SyncPay rodando!' });
});

// Rota principal — detecta país e serve a página certa
app.get('/', async (req, res) => {
    try {
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '';
        const cleanIp = ip.split(',')[0].trim();
        
        // Ignora IPs locais
        if (cleanIp === '127.0.0.1' || cleanIp === '::1' || cleanIp.startsWith('192.168')) {
            return res.sendFile(require('path').join(__dirname, 'public', 'index.html'));
        }

        const geoRes = await fetch(`https://ipapi.co/${cleanIp}/country/`);
        const country = await geoRes.text();

        if (country.trim() === 'BR') {
            res.sendFile(require('path').join(__dirname, 'public', 'index.html'));
        } else {
            res.sendFile(require('path').join(__dirname, 'public', 'gringo.html'));
        }
    } catch (err) {
        res.sendFile(require('path').join(__dirname, 'public', 'index.html'));
    }
});

// Teste token
app.get('/testar-token', async (req, res) => {
    try {
        const token = await getToken();
        res.json({ sucesso: true, token: token.substring(0, 20) + '...' });
    } catch (err) {
        res.json({ sucesso: false, erro: err.message });
    }
});

// Rota de teste — simula pagamento aprovado
app.get('/testar-acesso', async (req, res) => {
    const { email, nome } = req.query;
    if (!email || !nome) return res.json({ erro: 'Passe email e nome na URL' });
    const accessToken = gerarToken();
    tokens[accessToken] = { nome, email, plano: '1 Mes (teste)', criadoEm: Date.now() };
    try {
        await enviarEmail(email, nome, accessToken, '1 Mes (teste)');
        res.json({ sucesso: true, mensagem: 'Email enviado para ' + email, link: 'https://aline-production.up.railway.app/membros?token=' + accessToken });
    } catch (err) {
        res.json({ sucesso: false, erro: err.message, link: 'https://aline-production.up.railway.app/membros?token=' + accessToken });
    }
});

// Criar PIX
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
