require("dotenv").config();
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");

const app = express();
const PORT = 3000;
app.use(bodyParser.json());

// Pegando as variáveis do .env
const TOKEN = process.env.TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_BUSINESS_ID = process.env.WHATSAPP_BUSINESS_ID;
const WHATSAPP_BUSINESS_NUMBER = process.env.WHATSAPP_BUSINESS_NUMBER;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = "skyscanner44.p.rapidapi.com";
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL;

// Exibe as variáveis no console para debug
console.log("TOKEN:", TOKEN);
console.log("VERIFY_TOKEN:", VERIFY_TOKEN);
console.log("RAPIDAPI_KEY:", RAPIDAPI_KEY);
console.log("GOOGLE_GEMINI_API_KEY:", GOOGLE_GEMINI_API_KEY);
console.log("WHATSAPP_BUSINESS_ID:", WHATSAPP_BUSINESS_ID);
console.log("WHATSAPP_BUSINESS_NUMBER:", WHATSAPP_BUSINESS_NUMBER);

// Função para consultar o Google Gemini
async function chatWithAI(userMessage) {
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: userMessage }] }]
      },
      {
        headers: { "Content-Type": "application/json" }
      }
    );

    // Corrigindo a extração da resposta
    return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "Não entendi, pode repetir?";
  } catch (error) {
    console.error("❌ Erro ao consultar Google Gemini:", error.response?.data || error.message);
    return "Houve um erro ao processar sua mensagem. Tente novamente mais tarde!";
  }
}
// Webhook para verificação inicial do WhatsApp
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ WEBHOOK VERIFICADO COM SUCESSO!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Webhook para receber mensagens do WhatsApp
app.post("/webhook", async (req, res) => {
  console.log("📩 Webhook recebido:", JSON.stringify(req.body, null, 2));

  if (req.body.object === "whatsapp_business_account") {
    let entry = req.body.entry?.[0];
    let changes = entry?.changes?.[0];
    let message = changes?.value?.messages?.[0];

    if (message) {
      let senderPhone = message.from;
      let text = message.text?.body || "Mensagem recebida sem texto";

      console.log(`📩 Mensagem de ${senderPhone}: ${text}`);

      // Obtém resposta do Google Gemini
      let responseMessage = await chatWithAI(text);

      // Teste temporário da função chatWithAI
      (async () => {
        const resposta = await chatWithAI("Olá, como você está?");
        console.log("Resposta do Google Gemini:", resposta);
      })();

      // Envia resposta para o usuário
      await sendMessage(senderPhone, responseMessage);
      const conversations = {}; // Salvar mensagens anteriores

async function chatWithAI(userMessage, senderPhone) {
  if (!conversations[senderPhone]) {
    conversations[senderPhone] = 
    
    [

      { role: "assistant", text: "Olá! Como posso te ajudar?" }

    ];

  };
  

  conversations[senderPhone].push({ role: "user", text: userMessage });

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${GOOGLE_GEMINI_API_KEY}`,
      {
        contents: [
          { parts: conversations[senderPhone].map(msg => ({ text: msg.text })) }
        ]
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const aiResponse = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "Não entendi, pode repetir?";

    conversations[senderPhone].push({ role: "assistant", text: aiResponse });

    return aiResponse;
  } catch (error) {
    console.error("❌ Erro ao consultar Google Gemini:", error.response?.data || error.message);
    return "Houve um erro ao processar sua mensagem. Tente novamente mais tarde!";
  }
}

    }

    return res.sendStatus(200);
  }

  res.sendStatus(404);
});

// Função para enviar mensagens no WhatsApp
async function sendMessage(to, text) {
  try {
    await axios.post(
      `${WHATSAPP_API_URL}${WHATSAPP_BUSINESS_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✅ Mensagem enviada para ${to}: ${text}`);
  } catch (error) {
    console.error("❌ Erro ao enviar mensagem:", error.response?.data || error.message);
  }
}

// Inicia o servidor
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`🌐 Webhook URL: https://0.0.0.0:${PORT}/webhook`);
});
