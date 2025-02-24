const ngrok = require("ngrok");

(async function() {
  const url = await ngrok.connect(3000); // Porta do seu servidor Node.js
  console.log(`Webhook rodando em: ${url}`);
})();

console.log("📩 Webhook recebeu uma solicitação!", JSON.stringify(req.body, null, 2));

