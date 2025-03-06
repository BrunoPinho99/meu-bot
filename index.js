require("dotenv").config();
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const speech = require("@google-cloud/speech");

const app = express();
const PORT = 3000;

app.use(bodyParser.json());

// 🔹 Pegando variáveis do ambiente
const TOKEN = process.env.TOKEN; // Token de acesso da API do WhatsApp
const VERIFY_TOKEN = process.env.VERIFY_TOKEN; // Token de verificação do webhook
const WHATSAPP_BUSINESS_ID = process.env.WHATSAPP_BUSINESS_ID; // ID da conta do WhatsApp Business
const GOOGLE_GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY; // Chave da API do Google Gemini
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL; // URL base da API do WhatsApp
const SKYSCANNER_API_KEY = process.env.RAPIDAPI_KEY; // Chave da API do Skyscanner (RapidAPI)
const SKYSCANNER_API_HOST = process.env.RAPIDAPI_HOST; // Host da API do Skyscanner (RapidAPI)
const GOOGLE_CLOUD_API_KEY = process.env.GOOGLE_CLOUD_API_KEY; // Chave da API do Google Cloud (Speech-to-Text)

const client = new speech.SpeechClient(); // Cliente do Google Speech-to-Text
const conversations = {}; // Armazena conversas por número de telefone

// 🔹 Função para gerar respostas personalizadas
function generatePersonalizedGreeting(senderPhone) {
  const greetings = [
    "Oi! Pronto para encontrar sua próxima viagem?",
    "Olá! Me diga para onde deseja voar e eu te ajudo.",
    "Oi! Está planejando uma viagem? Vamos encontrar os melhores preços!",
  ];

  // Se já houver histórico, usa uma saudação diferente
  if (conversations[senderPhone] && conversations[senderPhone].name) {
    return `Oi, ${conversations[senderPhone].name}! Como posso ajudar hoje?`;
  }

  return greetings[Math.floor(Math.random() * greetings.length)];
}

// 🔹 Verifica se a mensagem contém uma solicitação válida de voo
function isValidFlightQuery(message) {
  const flightRegex =
    /(quero viajar|tem voo|passagem|ida e volta|só ida|quanto custa|quero ir para|procuro voo)/i;
  return flightRegex.test(message);
}

// 🔹 Extrai detalhes da mensagem sobre voo (origem, destino, data)
function extractFlightDetails(message) {
  const flightPattern =
    /(?:quero ir para|tem voo para|passagem para|procuro voo para) ([^,]+),? saindo de ([^,]+)(?:.*?(dia|de|para|no)? (\d{1,2} de \w+|\d{1,2}\/\d{1,2}\/\d{4}))?/i;
  const match = message.match(flightPattern);

  if (match) {
    return {
      destination: match[1].trim(),
      origin: match[2].trim(),
      date: match[4] ? match[4].trim() : null,
    };
  }
  return null;
}

// 🔹 Busca voos na API Skyscanner
async function fetchFlights(origin, destination, date) {
  try {
    console.log(`🔍 Buscando voos de ${origin} para ${destination} na data ${date || "anytime"}`);

    const response = await axios.get(
      `https://${SKYSCANNER_API_HOST}/apiservices/browsequotes/v1.0/BR/BRL/pt-BR/${origin}/${destination}/${date || "anytime"}`,
      {
        headers: {
          "X-RapidAPI-Key": SKYSCANNER_API_KEY,
          "X-RapidAPI-Host": SKYSCANNER_API_HOST,
        },
      }
    );

    console.log("✅ Resposta da API:", JSON.stringify(response.data, null, 2));

    if (!response.data.Quotes || response.data.Quotes.length === 0) {
      console.warn("⚠️ Nenhuma passagem encontrada, ativando fallback...");
      return generateFakeFlights(origin, destination, date); // Ativa o modo de teste
    }

    return response.data.Quotes.slice(0, 3)
      .map(
        (quote, index) =>
          `✈️ Opção ${index + 1}: R$${quote.MinPrice}, com ${
            quote.Direct ? "voo direto" : "escala"
          }\n🔗 Link: https://www.skyscanner.com.br/transport/flights/${origin}/${destination}/${date || "anytime"}`
      )
      .join("\n\n");
  } catch (error) {
    console.error("❌ Erro ao buscar voos:", error.response?.data || error.message);
    return generateFakeFlights(origin, destination, date); // Ativa fallback em caso de erro
  }
}

// 🔹 Gerador de passagens fake (modo de teste se a API falhar)
function generateFakeFlights(origin, destination, date) {
  return `🔎 Buscando as melhores passagens...\n\n` +
    `✈️ Gol - 12:00 - 13:30 - R$449\n` +
    `✈️ Latam - 15:00 - 16:45 - R$499\n` +
    `✈️ Azul - 20:00 - 21:30 - R$529\n`;
}

// 🔹 Comunicação com Google Gemini para respostas de IA
async function chatWithAI(userMessage, senderPhone) {
  try {
    if (!conversations[senderPhone]) {
      conversations[senderPhone] = { messages: [] };
    }

    conversations[senderPhone].messages.push({ role: "user", text: userMessage });

    if (conversations[senderPhone].messages.length > 10) {
      conversations[senderPhone].messages = conversations[senderPhone].messages.slice(-5);
    }

    const payload = {
      contents: [
        {
          parts: [
            { text: "Você é um assistente de viagens especializado em encontrar passagens aéreas." },
            ...conversations[senderPhone].messages.map((msg) => ({ text: msg.text })),
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
    if (!aiResponse) {
      aiResponse = "Não entendi sua solicitação. Reformule a pergunta.";
    }

    conversations[senderPhone].messages.push({ role: "assistant", text: aiResponse });

    return aiResponse;
  } catch (error) {
    console.error("❌ Erro ao consultar Google Gemini:", error.response?.data || error.message);
    return "Erro ao processar sua mensagem. Tente novamente.";
  }
}

// 🔹 Envia mensagens no WhatsApp usando API do Meta
async function sendMessage(to, message) {
  try {
    await axios.post(
      `${WHATSAPP_API_URL}/${WHATSAPP_BUSINESS_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`✅ Mensagem enviada para ${to}: ${message}`);
  } catch (error) {
    console.error("❌ Erro ao enviar mensagem:", error.response?.data || error.message);
  }
}

// 🔹 Processa áudio recebido
async function processAudio(audioUrl, senderPhone) {
  try {
    const audioResponse = await axios.get(audioUrl, { responseType: "stream" });
    const transcription = await client.recognize({
      audio: { content: audioResponse.data },
      config: {
        encoding: "OGG_OPUS",
        sampleRateHertz: 16000,
        languageCode: "pt-BR",
      },
    });

    const transcribedText = transcription[0].results
      .map((result) => result.alternatives[0].transcript)
      .join("\n");

    console.log(`🎤 Áudio transcrito: ${transcribedText}`);
    return transcribedText;
  } catch (error) {
    console.error("❌ Erro ao processar áudio:", error.message);
    return null;
  }
}

// 🔹 Webhook para receber mensagens do WhatsApp
app.post("/webhook", async (req, res) => {
  console.log("📩 Webhook recebido:", JSON.stringify(req.body, null, 2));

  if (req.body.object === "whatsapp_business_account") {
    let message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {
      let senderPhone = message.from;
      let userMessage = "";

      // Verifica se a mensagem é de texto ou áudio
      if (message.text) {
        userMessage = message.text.body;
      } else if (message.audio) {
        userMessage = await processAudio(message.audio.id, senderPhone);
      }

      // Verifica o gatilho de ativação
      if (!userMessage.toLowerCase().includes("oi, bot") && !userMessage.toLowerCase().includes("procurar passagens")) {
        return res.sendStatus(200); // Ignora mensagens sem gatilho
      }

      let responseMessage = generatePersonalizedGreeting(senderPhone);

      if (isValidFlightQuery(userMessage)) {
        const flightDetails = extractFlightDetails(userMessage);

        if (flightDetails) {
          responseMessage = `🔎 Buscando as melhores passagens de ${flightDetails.origin} para ${flightDetails.destination}...\n\n`;
          responseMessage += await fetchFlights(flightDetails.origin, flightDetails.destination, flightDetails.date);
        } else {
          responseMessage = await chatWithAI(userMessage, senderPhone);
        }
      }

      await sendMessage(senderPhone, responseMessage);
    }

    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});