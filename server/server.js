require('dotenv').config({ path: "../.env" });
const { MongoClient, ServerApiVersion } = require('mongodb');
const http = require("http");
const express = require('express');
const socketio = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const { DB_LOGIN, DB_PASS, SERVER_PORT } = process.env;

// Таймаут запросов
const delay = ms => new Promise(res => setTimeout(res, ms));

const uri = `mongodb+srv://${DB_LOGIN}:${DB_PASS}@cluster0.j9yo8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
let dbClient = null;

async function run () {
  try {
    const client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      }
    });

    await client.connect();
    return client;
  } catch (error) {
    console.error(error);
  }
}
 
// Получаем инфу по текущей игре
const getCurrentGame = async function(){
  try {
    const KEGLYA_DB = await dbClient.db("keglya_db");
    const SETTINGS_COLLECTION = await KEGLYA_DB.collection("settings");
    const { RIOT_API_KEY, SUMMONER } = await SETTINGS_COLLECTION.findOne({ TWITCH_ID: "GENERAL_HS_"});

    const responseUser = await fetch(
      `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${SUMMONER}?api_key=${RIOT_API_KEY}`
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

server.listen(SERVER_PORT,()=>{
  run().then(res => {
    dbClient = res
    getCurrentGame().then(r => console.log("Поехало крутиться"))
  }).catch(console.dir);
})

process.on('SIGTERM', () => {
  server.close((err) => {
    process.exit(err ? 1 : 0);
  });
});