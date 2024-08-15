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

// <!- MONGODB SECTION >
const mongoDbUri = `mongodb+srv://${DB_LOGIN}:${DB_PASS}@cluster0.j9yo8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
let dbClient = null;

async function mongoDbStartServer () {
  try {
    const client = new MongoClient(mongoDbUri, {
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
// <!- MONGODB SECTION >

const getPlayerInfo = async () => {
  const KEGLYA_DB = await dbClient.db("keglya_db");
  const SETTINGS_COLLECTION = await KEGLYA_DB.collection("settings");
  const PLAYER_INFO = await SETTINGS_COLLECTION.findOne({ TWITCH_ID: "GENERAL_HS_"});

  const RESPONSE_USER = await fetch(`https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${PLAYER_INFO.SUMMONER}?api_key=${PLAYER_INFO.RIOT_API_KEY}`)
      .then(res => res.json())

  return { PLAYER_INFO, RESPONSE_USER };
}

app.get('/getLastGames', async (req, res) => {
  try {
    const { RESPONSE_USER, PLAYER_INFO } = await getPlayerInfo();
    if (!RESPONSE_USER) {
      throw new Error("Не удалось получить информацию из БД")
    }

    const PUUID = RESPONSE_USER.puuid;

    if (!PUUID) throw new Error('Ошибка. Необходимо обновить RIOT_API_KEY.');

    const lastGames = await fetch(`https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${PUUID}/ids?start=0&count=5&api_key=${PLAYER_INFO.RIOT_API_KEY}`)
        .then(res => res.json());

    res.send(lastGames);
  } catch (error) {
    console.log(error);
  }
})

app.get('/getGameById/:gameId', async (req, res) => {
  const gameId = req.params.gameId;

  try {
    const { PLAYER_INFO, RESPONSE_USER } = await getPlayerInfo();

    const PUUID = RESPONSE_USER.puuid;

    if (!PUUID) {
      throw new Error('Ошибка. Необходимо обновить RIOT_API_KEY.');
    }

    const game = await fetch(
        `https://europe.api.riotgames.com/lol/match/v5/matches/${gameId}?api_key=${PLAYER_INFO.RIOT_API_KEY}`
    ).then(res => res.json());

    const participant = game.info.participants.find(player => {
      return player.puuid === PUUID;
    });

    const parsedInfo = {
      championName: participant.championName.toUpperCase(),
      kda: participant.challenges.kda,
      role: participant.lane.toUpperCase(),
      name: participant.riotIdGameName,
      win: participant.win,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      minions: participant.totalMinionsKilled + participant.neutralMinionsKilled,
    }

    res.send(`
      ${parsedInfo.win ? "Победил" : "Проиграл"} за ${parsedInfo.championName} на ${parsedInfo.role}. 
      КДА - ${parsedInfo.kills}/${parsedInfo.deaths}/${parsedInfo.assists}. Нафармил - ${parsedInfo.minions} мобов.
      `
    );
  } catch (error) {
    console.error(error);
  }
})
 
// Получаем инфу по текущей игре
const getCurrentGame = async function(){
  try {
    const { RESPONSE_USER, PLAYER_INFO } = await getPlayerInfo();

    const PUUID = RESPONSE_USER.puuid;

    if (!PUUID) {
      throw new Error('Ошибка. Необходимо обновить RIOT_API_KEY.');
    }

    const currentGame = await fetch(
      `https://euw1.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${PUUID}?api_key=${PLAYER_INFO.RIOT_API_KEY}`
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

io.on("connection", async () => {
  console.log('Вебсокет соединение установлено');
})

server.listen(SERVER_PORT,async ()=>{
  await mongoDbStartServer()
      .then(res => {
        dbClient = res
      })
      .catch(console.dir);

  await getCurrentGame().then(r => console.log("Поехало крутиться"))
})

process.on('SIGTERM', () => {
  server.close((err) => {
    process.exit(err ? 1 : 0);
  });
});