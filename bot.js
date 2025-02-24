const express = require("express");
const app = express();
const PORT = 3000;

// Adicionando uma rota para "/"
app.get("/", (req, res) => {
    res.send("Servidor rodando corretamente! 🚀");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
