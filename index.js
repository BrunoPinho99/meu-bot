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
const SKYSCANNER_API_KEY = process.env.SKYSCANNER_API_KEY;

const client = new speech.SpeechClient();
const conversations = {};

function isValidFlightQuery(message) {
  const flightRegex = /(quero viajar|tem voo|passagem|ida e volta|só ida|quanto custa|quero ir para)/i;
  return flightRegex.test(message);
}

function extractFlightDetails(message) {
  const flightPattern = /(?:quero ir para|tem voo para|passagem para) ([^,]+),? saindo de ([^,]+)(?:.*?(dia|de|para|no)? (\d{1,2} de \w+|\d{1,2}\/\d{1,2}\/\d{4}))?/i;
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

async function fetchFlights(origin, destination, date) {
  try {
    const response = await axios.get("https://partners.api.skyscanner.net/apiservices/browsequotes/v1.0/BR/BRL/pt-BR", {
      params: {
        country: "BR",
        currency: "BRL",
        locale: "pt-BR",
        originplace: origin,
        destinationplace: destination,
        outbounddate: date || "anytime",
        apikey: SKYSCANNER_API_KEY,
      },
    });

    if (response.data.Quotes.length === 0) {
      return "Nenhuma passagem encontrada para essa rota. Tente outra data ou ajuste sua busca.";
    }

    return response.data.Quotes.slice(0, 3).map((quote, index) => 
      `✈️ Opção ${index + 1}: R$${quote.MinPrice}, com ${quote.Direct ? "voo direto" : "escala"}`
    ).join("\n");
    
  } catch (error) {
    console.error("Erro ao buscar voos:", error);
    return "Não consegui encontrar passagens agora. Tente novamente mais tarde.";
  }
}

async function chatWithAI(userMessage, senderPhone) {
  try {
    if (!conversations[senderPhone]) {
      conversations[senderPhone] = [];
    }
    conversations[senderPhone].push({ role: "user", text: userMessage });
    if (conversations[senderPhone].length > 10) {
      conversations[senderPhone] = conversations[senderPhone].slice(-5);
    }
    const payload = {
      contents: [
        {
          parts: [
            { text: "Você é um assistente de viagens especializado em encontrar passagens aéreas." },
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
    if (!aiResponse) {
      aiResponse = "Não entendi sua solicitação. Reformule a pergunta.";
    }
    conversations[senderPhone].push({ role: "assistant", text: aiResponse });
    return aiResponse;
  } catch (error) {
    console.error("Erro ao consultar Google Gemini:", error.response?.data || error.message);
    return "Erro ao processar sua mensagem. Tente novamente.";
  }
}

app.post("/webhook", async (req, res) => {
  console.log("📩 Webhook recebido:", JSON.stringify(req.body, null, 2));
  if (req.body.object === "whatsapp_business_account") {
    let message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (message) {
      let senderPhone = message.from;
      let responseMessage = "";
      if (message.text && isValidFlightQuery(message.text.body)) {
        const flightDetails = extractFlightDetails(message.text.body);
        if (flightDetails) {
          responseMessage = await fetchFlights(flightDetails.origin, flightDetails.destination, flightDetails.date);
        } else {
          responseMessage = await chatWithAI(message.text.body, senderPhone);
        }
      }
      await sendMessage(senderPhone, responseMessage);
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

