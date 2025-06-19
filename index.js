const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const PORT = 5000;

app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: false }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

let qrData = null;
let clientReady = false;
let qrScanned = false;

const client = new Client({
    authStrategy: new LocalAuth()
});

client.on('qr', async (qr) => {
    qrData = await qrcode.toDataURL(qr);
    clientReady = false;
    qrScanned = false;
    console.log('📲 QR siap, buka /qr untuk scan');
});

client.on('authenticated', () => {
    qrScanned = true;
    console.log('🔓 QR berhasil discan!');
});

client.on('auth_failure', (msg) => {
    console.log('❌ Autentikasi gagal:', msg);
    qrScanned = false;
});

client.on('ready', () => {
    qrData = null;
    clientReady = true;
    console.log('✅ WhatsApp siap digunakan');
});

client.initialize();

// Halaman QR
app.get('/qr', (req, res) => {
    if (clientReady && qrScanned) {
        return res.redirect('/');
    }

    if (qrData) {
        return res.render('qr-base', { qrImage: qrData });
    }

    res.send('<p>⏳ Menunggu QR code dibuat...</p><script>setTimeout(()=>location.reload(), 2000)</script>');
});

// Halaman utama
app.get('/', (req, res) => {
    if (!clientReady || !qrScanned) return res.redirect('/qr');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Kirim pesan
app.post('/send', async (req, res) => {
    if (!clientReady || !qrScanned) return res.redirect('/qr');

    const entries = req.body.entries.split('\n').map(line => line.trim()).filter(Boolean);
    const template = req.body.message;
    let success = 0;
    let failed = [];

    for (let line of entries) {
        const parts = line.split(',');
        const number = parts[0].replace(/\D/g, '');
        const chatId = `${number}@c.us`;

        try {
            const valid = await client.isRegisteredUser(chatId);
            if (!valid) throw new Error('Tidak terdaftar');

            // Ambil parameter (tanpa nomor)
            const rawParams = parts.slice(1).map(p => p.trim());
            const param1 = rawParams[0] || ''; // nama (untuk {1})
            let param2 = rawParams[1] || '';   // slug (untuk {2})

            // Jika param2 kosong, gunakan param1 dengan spasi jadi +
            if (!param2) {
                param2 = param1.replace(/\s+/g, '+');
            }

            // Gabungkan semua parameter final (bisa lebih dari 2)
            const allParams = [param1, param2, ...rawParams.slice(2)];

            // Ganti {1}, {2}, dst dalam template
            let msg = template;
            allParams.forEach((val, i) => {
                msg = msg.replace(new RegExp(`\\{${i + 1}\\}`, 'g'), val);
            });

            await client.sendMessage(chatId, msg);
            console.log(`✅ ${number} OK`);
            success++;
        } catch (e) {
            console.log(`❌ ${number} gagal: ${e.message}`);
            failed.push(number);
        }

        await new Promise(r => setTimeout(r, 1500));
    }

    res.send(`
        <!DOCTYPE html>
        <html lang="id">
        <head>
        <meta charset="UTF-8" />
        <title>Hasil Pengiriman</title>
        <style>
            body {
            font-family: 'Segoe UI', sans-serif;
            background: #f4f4f4;
            padding: 40px;
            max-width: 600px;
            margin: auto;
            text-align: center;
            }

            .card {
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            padding: 30px;
            }

            h2 {
            margin-bottom: 20px;
            color: #28a745;
            }

            p {
            font-size: 16px;
            margin: 10px 0;
            }

            .failed {
            color: #dc3545;
            font-weight: bold;
            }

            a {
            display: inline-block;
            margin-top: 20px;
            padding: 10px 20px;
            background-color: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            }

            a:hover {
            background-color: #0056b3;
            }
        </style>
        </head>
        <body>
        <div class="card">
            <h2>✅ Kirim Selesai</h2>
            <p><strong>Berhasil:</strong> ${success}</p>
            <p class="failed"><strong>Gagal:</strong> ${failed.length > 0 ? failed.join(', ') : 'Tidak ada'}</p>
            <a href="/">⬅️ Kembali ke Form</a>
        </div>
        </body>
        </html>
        `);
});

const fs = require('fs');
const authFolder = './.wwebjs_auth/session-default'; // ganti sesuai clientId

app.get('/logout', async (req, res) => {
    try {
        await client.logout();
        console.log('🚪 client.logout() dipanggil');

        if (fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
            console.log('🧹 Session file dihapus');
        }

        clientReady = false;
        qrScanned = false;
        qrData = null;

        await client.destroy();
        client.initialize();

        res.send(`
            <h3>📴 Berhasil logout total</h3>
            <a href="/qr">🔄 Scan QR lagi</a>
        `);
    } catch (err) {
        res.status(500).send(`❌ Gagal logout: ${err.message}`);
    }
});


// AJAX status check
app.get('/status', (req, res) => {
    res.json({ ready: clientReady && qrScanned });
});


app.listen(PORT, () => {
    console.log(`🌐 Web aktif di http://localhost:${PORT}`);
});

