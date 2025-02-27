require("dotenv").config();
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const FormData = require("form-data");
const fs = require("fs");
const { exec } = require("child_process");
const speech = require('@google-cloud/speech');

// Configuração do cliente do Google Speech-to-Text
const client = new speech.SpeechClient();

async function transcribeAudio(audioUrl) {
  try {
    const response = await axios({
      url: audioUrl,
      method: "GET",
      responseType: "stream",
    });

    const filePath = `audio.ogg`;
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", async () => {
        const file = fs.readFileSync(filePath);
        const audioBytes = file.toString('base64');

        const audio = {
          content: audioBytes,
        };

        const config = {
          encoding: 'OGG_OPUS',
          sampleRateHertz: 16000,
          languageCode: 'pt-BR', // Altere para o idioma desejado
        };

        const request = {
          audio: audio,
          config: config,
        };

        try {
          const [response] = await client.recognize(request);
          const transcription = response.results
            .map(result => result.alternatives[0].transcript)
            .join('\n');
          fs.unlinkSync(filePath);
          resolve(transcription);
        } catch (error) {
          console.error("Erro ao transcrever áudio:", error);
          reject("Não consegui entender o áudio.");
        }
      });

      writer.on("error", reject);
    });
  } catch (error) {
    console.error("Erro ao baixar o áudio:", error);
    return "Não consegui baixar o áudio.";
  }
}

const app = express();
const PORT = 3000;
app.use(bodyParser.json());

// Pegando as variáveis do .env
const TOKEN = process.env.TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_BUSINESS_ID = process.env.WHATSAPP_BUSINESS_ID;
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const conversations = {};

// Função para transcrever áudio
async function transcribeAudio(audioUrl) {
  try {
    const response = await axios({
      url: audioUrl,
      method: "GET",
      responseType: "stream",
    });
    
    const filePath = `audio.ogg`;
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on("finish", async () => {
        const formData = new FormData();
        formData.append("file", fs.createReadStream(filePath));
        formData.append("model", "whisper-1");
        
        const whisperResponse = await axios.post(
          "https://api.openai.com/v1/audio/transcriptions",
          formData,
          { headers: { ...formData.getHeaders(), Authorization: `Bearer ${OPENAI_API_KEY}` } }
        );
        
        fs.unlinkSync(filePath);
        resolve(whisperResponse.data.text);
      });
      writer.on("error", reject);
    });
  } catch (error) {
    console.error("Erro ao transcrever áudio:", error);
    return "Não consegui entender o áudio.";
  }
}

// Função para conversar com o Google Gemini
async function chatWithAI(userMessage, senderPhone) {
  try {
    if (!conversations[senderPhone]) {
      conversations[senderPhone] = [];
    }

    conversations[senderPhone].push({ role: "user", text: userMessage });

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_GEMINI_API_KEY}`,
      { contents: [{ parts: conversations[senderPhone].map(msg => ({ text: msg.text })) }] },
      { headers: { "Content-Type": "application/json" } }
    );

    const aiResponse = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "Não entendi, pode repetir?";
    conversations[senderPhone].push({ role: "assistant", text: aiResponse });
    return aiResponse;
  } catch (error) {
    console.error("Erro ao consultar Google Gemini:", error);
    return "Houve um erro ao processar sua mensagem.";
  }
}

// Webhook para verificação inicial
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    console.log("Webhook verificado!");
    res.status(200).send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

// Webhook para receber mensagens
app.post("/webhook", async (req, res) => {
  if (req.body.object === "whatsapp_business_account") {
    let message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (message) {
      let senderPhone = message.from;
      let responseMessage = "";
      
      if (message.text) {
        responseMessage = await chatWithAI(message.text.body, senderPhone);
      } else if (message.type === "audio") {
        const audioUrl = message.audio?.url;
        if (audioUrl) {
          const transcribedText = await transcribeAudio(audioUrl);
          responseMessage = await chatWithAI(transcribedText, senderPhone);
        }
      }
      
      await sendMessage(senderPhone, responseMessage);
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// Função para enviar mensagens no WhatsApp
async function sendMessage(to, text) {
  try {
    await axios.post(
      `${WHATSAPP_API_URL}${WHATSAPP_BUSINESS_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
      { headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } }
    );
    console.log(`Mensagem enviada para ${to}: ${text}`);
  } catch (error) {
    console.error("Erro ao enviar mensagem:", error);
  }
}

// Inicia o servidor
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
