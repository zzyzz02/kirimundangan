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
app.post('/send', (req, res) => {
    if (!clientReady) return res.redirect('/qr');

    const entries = req.body.entries.split('\n').map(line => line.trim()).filter(Boolean);
    const template = req.body.message;

    // Jalankan pengiriman di latar belakang
    (async () => {
        for (let line of entries) {
            const parts = line.split(',');
            let number = parts[0].trim().replace(/[^+\d]/g, ''); // hanya angka dan +
            if (number.startsWith('+')) number = number.slice(1); // hilangkan +
            if (number.startsWith('0')) number = '62' + number.slice(1); // 0xxxxx → 62xxxxx

            const chatId = `${number}@c.us`;

            try {
                const valid = await client.isRegisteredUser(chatId);
                if (!valid) throw new Error('Tidak terdaftar');

                const rawParams = parts.slice(1).map(p => p.trim());
                const param1 = rawParams[0] || '';
                let param2 = rawParams[1] || '';
                if (!param2) param2 = param1.replace(/\s+/g, '+');

                const allParams = [param1, param2, ...rawParams.slice(2)];
                let msg = template;
                allParams.forEach((val, i) => {
                    msg = msg.replace(new RegExp(`\\{${i + 1}\\}`, 'g'), val);
                });

                await client.sendMessage(chatId, msg);
                console.log(`✅ ${number} OK`);
            } catch (e) {
                console.log(`❌ ${number} gagal: ${e.message}`);
            }

            await new Promise(r => setTimeout(r, 1000));
        }
    })();

    // Langsung balas ke user
    res.send(`
        <h3>✅ Pesan dalam proses pengiriman</h3>
        <a href="/">⬅️ Kembali</a>
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

