require("dotenv").config();
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const app = express();
const PORT = 3000;
const speech = require('@google-cloud/speech');

app.use(bodyParser.json());

const TOKEN = process.env.TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_BUSINESS_ID = process.env.WHATSAPP_BUSINESS_ID;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL;

const client = new speech.SpeechClient();
const conversations = {};
const lastGreeting = {}; 

function shouldGreetUser(senderPhone) {
  if (!lastGreeting[senderPhone] || Date.now() - lastGreeting[senderPhone] > 300000) {
    lastGreeting[senderPhone] = Date.now();
    return true;
  }
  return false;
}

async function transcribeAudio(audioUrl) {
  try {
    const response = await axios.get(audioUrl, { responseType: "arraybuffer" });
    const audioBytes = Buffer.from(response.data).toString("base64");
    
    const request = {
      audio: { content: audioBytes },
      config: { encoding: "OGG_OPUS", sampleRateHertz: 16000, languageCode: "pt-BR" },
    };

    const [transcriptionResponse] = await client.recognize(request);
    return transcriptionResponse.results.map(result => result.alternatives[0].transcript).join(" ");
  } catch (error) {
    console.error("Erro ao processar áudio:", error);
    return "Não consegui entender. Pode tentar novamente ou me enviar um texto?";
  }
}

async function chatWithAI(userMessage, senderPhone) {
  if (!conversations[senderPhone]) conversations[senderPhone] = [];
  conversations[senderPhone].push({ role: "user", text: userMessage });
  if (conversations[senderPhone].length > 10) {
    conversations[senderPhone] = conversations[senderPhone].slice(-5);
  }

  const payload = {
    contents: [
      { parts: [{ text: "Você é um assistente de viagens especializado em encontrar passagens." },
        ...conversations[senderPhone].map(msg => ({ text: msg.text })) ] }
    ]
  };

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_GEMINI_API_KEY}`,
      payload, { headers: { "Content-Type": "application/json" } }
    );

    let aiResponse = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 
                     "Não entendi sua solicitação. Você pode reformular?";
    
    conversations[senderPhone].push({ role: "assistant", text: aiResponse });
    return aiResponse;
  } catch (error) {
    console.error("Erro ao consultar AI:", error.response?.data || error.message);
    return "Houve um erro. Tente novamente mais tarde!";
  }
}

app.post("/webhook", async (req, res) => {
  if (req.body.object === "whatsapp_business_account") {
    let message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (message) {
      let senderPhone = message.from;
      let responseMessage = "";
      
      if (message.text) {
        let userMessage = message.text.body.trim();
        if (/^\w{1,3}$/.test(userMessage)) {
          responseMessage = `Você quis dizer algo específico ou foi um erro de digitação?`;
        } else {
          responseMessage = await chatWithAI(userMessage, senderPhone);
        }
      } else if (message.type === "audio" && message.audio?.url) {
        const transcribedText = await transcribeAudio(message.audio.url);
        responseMessage = await chatWithAI(transcribedText, senderPhone);
      }

      if (shouldGreetUser(senderPhone)) {
        responseMessage = `Oi! Como posso ajudar na sua próxima viagem?` + "\n" + responseMessage;
      }

      await sendMessage(senderPhone, responseMessage);
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

async function sendMessage(to, text) {
  try {
    await axios.post(
      `${WHATSAPP_API_URL}${WHATSAPP_BUSINESS_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "text", text: { body: text } },
      { headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } }
    );
    console.log(`Mensagem enviada para ${to}: ${text}`);
  } catch (error) {
    console.error("Erro ao enviar mensagem:", error.response?.data || error.message);
  }
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
});
