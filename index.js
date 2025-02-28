require("dotenv").config();
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const app = express();
const PORT = 3000;
const speech = require('@google-cloud/speech');

app.use(bodyParser.json());

// Pegando as variáveis do .env
const TOKEN = process.env.TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_BUSINESS_ID = process.env.WHATSAPP_BUSINESS_ID;
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL;

const client = new speech.SpeechClient();
const conversations = {};

// **Correção do Problema 4: Transcrição de áudio sem salvar no disco**
async function transcribeAudio(audioUrl) {
  try {
    const response = await axios({
      url: audioUrl,
      method: "GET",
      responseType: "arraybuffer", // Obtém os dados como um buffer
    });

    const audioBytes = Buffer.from(response.data).toString("base64");

    const request = {
      audio: { content: audioBytes },
      config: {
        encoding: "OGG_OPUS",
        sampleRateHertz: 16000,
        languageCode: "pt-BR",
      },
    };

    const [transcriptionResponse] = await client.recognize(request);
    return transcriptionResponse.results
      .map(result => result.alternatives[0].transcript)
      .join(" ");
  } catch (error) {
    console.error("Erro ao processar áudio:", error);
    return "Não consegui entender o áudio.";
  }
}

// **Correção do Problema 5: Melhorando a consulta ao Gemini**
async function chatWithAI(userMessage, senderPhone) {
  try {
    if (!conversations[senderPhone]) {
      conversations[senderPhone] = [];
    }

    // Adiciona a mensagem do usuário ao histórico
    conversations[senderPhone].push({ role: "user", text: userMessage });

    // Mantém apenas as últimas 5 mensagens para evitar um histórico muito grande
    if (conversations[senderPhone].length > 10) {
      conversations[senderPhone] = conversations[senderPhone].slice(-5);
    }

    const payload = {
      contents: [
        {
          parts: [
            {
              text: "Você é um assistente de viagens especializado em encontrar passagens aéreas para os usuários. Responda com informações úteis e diretas.",
            },
            ...conversations[senderPhone].map(msg => ({ text: msg.text })),
          ],
        },
      ],
    };

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_GEMINI_API_KEY}`,
      payload,
      { headers: { "Content-Type": "application/json" } }
    );

    let aiResponse = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    // Se o Gemini não responder corretamente, use um fallback
    if (!aiResponse) {
      aiResponse = "Não entendi sua solicitação. Você pode reformular a pergunta?";
    }

    conversations[senderPhone].push({ role: "assistant", text: aiResponse });
    return aiResponse;
  } catch (error) {
    console.error("❌ Erro ao consultar Google Gemini:", error.response?.data || error.message);
    return "Houve um erro ao processar sua mensagem. Tente novamente mais tarde!";
  }
}

// Webhook para receber mensagens do WhatsApp
app.post("/webhook", async (req, res) => {
  console.log("📩 Webhook recebido:", JSON.stringify(req.body, null, 2));

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
        } else {
          responseMessage = "Não consegui entender o áudio. Por favor, tente novamente.";
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
