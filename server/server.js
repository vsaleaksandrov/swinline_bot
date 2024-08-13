require('dotenv').config({ path: "../.env" });
const { MongoClient, ServerApiVersion } = require('mongodb');
const http = require("http");
const express = require('express');
const socketio = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const { SUMMONER_NAME, SUMMONER_ID, RIOT_API_KEY, SERVER_PORT } = process.env;

// Таймаут запросов
const delay = ms => new Promise(res => setTimeout(res, ms));
 
// Получаем инфу по текущей игре
const getCurrentGame = async function(){
  try {
    const responseUser = await fetch(
      `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${SUMMONER_NAME}/${SUMMONER_ID}?api_key=${RIOT_API_KEY}`
    )
    .then(res => res.json())

    const PUUID = responseUser.puuid;

    if (!PUUID) {
      throw new Error('Ошибка. Необходимо обновить RIOT_API_KEY.');
    }

    const currentGame = await fetch(
      `https://euw1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${PUUID}?api_key=${RIOT_API_KEY}`
    )
    .then(res => res.json())

    if (currentGame.gameId && currentGame.gameLength) {
      io.sockets.emit('currentGame', {
        id: currentGame.gameId, // айди игры
        gameLength: currentGame.gameLength, // сколько длится игра
      });
    } else {
      io.sockets.emit('currentGame', null);
    }

    await delay(20000);
    await getCurrentGame();
  } catch(error) {
    console.log(error);
  }
}

io.on("connection", () => {
  console.log('Вебсокет соединение установлено');
})

app.get('/', (req, res) => {
  io.sockets.emit('message', async function (message) {
    console.log('A client is speaking to me! They’re saying: ' + SUMMONER_ID);
  });
  res.send(SUMMONER_ID)
})

server.listen(SERVER_PORT,()=>{
  getCurrentGame().then(r => console.log("Поехало крутиться"));
})

process.on('SIGTERM', () => {
  server.close((err) => {
    process.exit(err ? 1 : 0);
  });
});