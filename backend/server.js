const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();

app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.get('/', (req, res) => {
    res.send('UniSync Backend is running! 🚀');
});

// Ендпоінт для перевірки підключення
app.post('/check-email', async (req, res) => {
    const { email, appPassword } = req.body;

    if (!email || !appPassword) {
        return res.status(400).send({ success: false, error: 'Введіть email та пароль' });
    }

    try {
        const transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 587, // 🔥 Змінено з 465 на 587
            secure: false, // 🔥 Для 587 має бути false
            requireTLS: true, // 🔥 Примусове шифрування
            auth: {
                user: email,
                pass: appPassword 
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        await transporter.verify();
        console.log(`✅ Підключення успішне для: ${email}`);
        res.status(200).send({ success: true, message: 'З\'єднання успішне' });
    } catch (error) {
        console.error(`❌ Помилка перевірки пошти ${email}:`, error.message);
        res.status(401).send({ success: false, error: error.message });
    }
});

// Ендпоінт для відправки розсилки
app.post('/api/send-single', async (req, res) => {
    const { senderAccount, subject, emailData } = req.body;
    const password = senderAccount?.smtpPassword || senderAccount?.appPassword || senderAccount?.password;

    if (!senderAccount || !senderAccount.email || !password) {
        return res.status(400).send({ 
            success: false, 
            error: 'Відсутні обов\'язкові дані авторизації в БД.' 
        });
    }

    try {
        const transporter = nodemailer.createTransport({
            host: senderAccount.smtpHost || 'smtp.gmail.com',
            port: 587, // 🔥 Змінено на 587
            secure: false, // 🔥 Для 587 має бути false
            requireTLS: true, 
            auth: {
                user: senderAccount.email,
                pass: password 
            },
            tls: {
                rejectUnauthorized: false
            }
        });

        const senderName = `${senderAccount.firstName || ''} ${senderAccount.lastName || ''}`.trim() || 'Розподіл навантаження';

        await transporter.sendMail({
            from: `"${senderName}" <${senderAccount.email}>`,
            to: emailData.to,
            subject: subject,
            html: emailData.htmlBody
        });

        console.log(`✅ Лист успішно надіслано на адресу: ${emailData.to}`);
        res.status(200).send({ success: true, message: 'Лист успішно надіслано' });

    } catch (error) {
        console.error(`❌ Помилка SMTP при спробі відправки для ${emailData.to}:`, error);
        res.status(500).send({ 
            success: false, 
            error: error.message,
            code: error.code
        });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`==================================================`);
    console.log(`🚀 Бекенд розсилки UniSync успішно запущено!`);
    console.log(`📡 Сервер очікує на запити на порту: ${PORT}`);
    console.log(`==================================================`);
});
module.exports = app;