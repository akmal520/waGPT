const { Configuration, OpenAIApi } = require("openai");
const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const axios = require('axios');
const port = process.env.PORT || 1512;

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    allowEIO3: false
});

app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));


app.get('/', (req, res) => {
    res.sendFile('index.html', {
        root: __dirname
    });
});

const sessions = [];
const SESSIONS_FILE = './Akmal.json';

const createSessionsFileIfNotExists = function () {
    if (!fs.existsSync(SESSIONS_FILE)) {
        try {
            fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
            console.log('Sessions file created successfully.');
        } catch (err) {
            console.log('Failed to create sessions file: ', err);
        }
    }
}

createSessionsFileIfNotExists();

const setSessionsFile = function (sessions) {
    fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function (err) {
        if (err) {
            console.log(err);
        }
    });
}

const getSessionsFile = function () {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

const createSession = function (id, description) {
    console.log('Creating session: ' + id);
    const client = new Client({
        restartOnAuthFail: true,
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process', // <- this one doesn't works in Windows
                '--disable-gpu'
            ],
        },
        authStrategy: new LocalAuth({
            clientId: id
        })
    });

    client.initialize();

    client.on('qr', (qr) => {
        console.log('QR RECEIVED', qr);
        qrcode.toDataURL(qr, (err, url) => {
            io.emit('qr', { id: id, src: url });
            io.emit('message', { id: id, text: 'QR Code received, scan please!' });
        });
    });

    client.on('ready', () => {
        io.emit('ready', { id: id });
        io.emit('message', { id: id, text: 'Whatsapp is ready!' });

        const savedSessions = getSessionsFile();
        const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
        savedSessions[sessionIndex].ready = true;
        setSessionsFile(savedSessions);
    });

    client.on('authenticated', () => {
        io.emit('authenticated', { id: id });
        io.emit('message', { id: id, text: 'Whatsapp is authenticated!' });
    });

    client.on('auth_failure', function () {
        io.emit('message', { id: id, text: 'Auth failure, restarting...' });
    });

    client.on('disconnected', (reason) => {
        io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
        client.destroy();
        client.initialize();

        // Menghapus pada file sessions
        const savedSessions = getSessionsFile();
        const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
        savedSessions.splice(sessionIndex, 1);
        setSessionsFile(savedSessions);

        io.emit('remove-session', id);
    });

    client.on('message', async msg => {
        const pesan = msg.body;
        const ketik = await msg.getChat();
        console.log(pesan);

        if (typeof pesan === "string") {

            ketik.sendStateTyping();
            await ketik.mute;

            try {
                const api_key = getSessionsFile();
                let key;
                api_key.forEach(keys => {
                    key = keys.description
                });

                const configuration = new Configuration({
                    apiKey: key
                });

                const openai = new OpenAIApi(configuration);
                const response = await openai.createCompletion({
                    model: "text-davinci-003",
                    prompt: pesan,
                    temperature: 0.3,
                    max_tokens: 300,
                    top_p: 1,
                    frequency_penalty: 0.0,
                    presence_penalty: 0.0,
                });

                msg.reply(`${response.data.choices[0].text}\n\n`);

            } catch (error) {
                console.log(error)
                message.reply('Tahan dulu bosku, ada yang error nih');
            }
        }

    });

    // Tambahkan client ke sessions
    sessions.push({
        id: id,
        description: description,
        client: client
    });

    // Menambahkan session ke file
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

    if (sessionIndex == -1) {
        savedSessions.push({
            id: id,
            description: description,
            ready: false,
        });
        setSessionsFile(savedSessions);
    }
}

const init = function (socket) {
    const savedSessions = getSessionsFile();

    if (savedSessions.length > 0) {
        if (socket) {
            savedSessions.forEach((e, i, arr) => {
                arr[i].ready = false;
            });

            socket.emit('init', savedSessions);
        } else {
            savedSessions.forEach(sess => {
                createSession(sess.id, sess.description);
            });
        }
    }
}

init();

// Socket IO
io.on('connection', function (socket) {
    init(socket);

    socket.on('create-session', function (data) {
        console.log('Create session: ' + data.id);
        createSession(data.id, data.description);
    });
});

server.listen(port, function () {
    console.log('App running on *: ' + port);
});
