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
// Armazena as conversas dos usuários
const conversations = {};

// Função para consultar o Google Gemini
async function chatWithAI(userMessage, senderPhone) {
  try {
    // Inicializa o histórico se ainda não existir
    if (!conversations[senderPhone]) {
      conversations[senderPhone] = [];
    }

    // Adiciona a mensagem do usuário ao histórico
    conversations[senderPhone].push({ role: "user", text: userMessage });

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_GEMINI_API_KEY}`,
      {
        contents: [
          { parts: conversations[senderPhone].map(msg => ({ text: msg.text })) }
        ]
      },
      { headers: { "Content-Type": "application/json" } }
    );

    const aiResponse = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "Não entendi, pode repetir?";

    // Adiciona a resposta da IA ao histórico
    conversations[senderPhone].push({ role: "assistant", text: aiResponse });

    return aiResponse;
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
          console.log("URL do áudio recebida:", audioUrl); // Log da URL do áudio
  
          if (audioUrl) {
            const transcribedText = await transcribeAudio(audioUrl);
            console.log("Texto transcrito:", transcribedText); // Log do texto transcrito
  
            if (transcribedText && transcribedText.trim() !== "") {
              responseMessage = await chatWithAI(transcribedText, senderPhone);
            } else {
              responseMessage = "Não consegui entender o áudio. Por favor, tente novamente.";
            }
          }
        }
  
        await sendMessage(senderPhone, responseMessage);
      }
      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  });

  if (req.body.object === "whatsapp_business_account") {
    let entry = req.body.entry?.[0];
    let changes = entry?.changes?.[0];
    let message = changes?.value?.messages?.[0];

    if (message) {
      let senderPhone = message.from;
      let text = message.text?.body || "Mensagem recebida sem texto";

      console.log(`📩 Mensagem de ${senderPhone}: ${text}`);

      // Obtém resposta do Google Gemini
      let responseMessage = await chatWithAI(text, senderPhone);

      // Envia resposta para o usuário
      await sendMessage(senderPhone, responseMessage);
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
