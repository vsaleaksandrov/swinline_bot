// require('dotenv').config();
// const { webhookCallback  } = require("grammy");
// const express = require('express');
// const cors = require('cors');
// const bot = require("./../src/index");
// const JSONdb = require('simple-json-db');
//
// const { RIOT_API_KEY, SUMMONER_ID , SUMMONER_NAME   } = process.env;
//
// const app = express();
// app.use(express.json())
// app.use(cors({
//     origin: ['http://localhost:3002', 'http://localhost:5173'],
//     methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
//     credentials: true
// }));
//
// const port = process.env.PORT || 3002;
// app.listen(port, () => {
//     updateUserInfo().catch(error => console.log(error))
// });
//
// const updateUserInfo = async function(){
//     const responseUser = await fetch(`https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${SUMMONER_NAME}/${SUMMONER_ID}?api_key=${RIOT_API_KEY}`)
//         .then(res => res.json())
//
//     const PUUID = responseUser.puuid;
//
//     return new Promise((done, reject) => {
//         setInterval(async () => {
//             try {
//                 const lastGames = await fetch(`https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/${PUUID}/ids?start=0&count=5&api_key=${RIOT_API_KEY}`)
//                     .then(res => res.json())
//
//                 const lastGameStats = await fetch(`https://europe.api.riotgames.com/lol/match/v5/matches/${lastGames[0]}?api_key=${RIOT_API_KEY}`).then(res => res.json());
//
//                 // if (lastGameStats.info.endOfGameResult !== "GameComplete") {
//                 //     console.log("Игра идёт");
//                 // } else {
//                 //     console.log("Сейчас нет игр")
//                 // }
//
//                 const playerStat = lastGameStats.info.participants.find(player => {
//                     return player.puuid === PUUID
//                 });
//
//                 done({
//                     championName: playerStat.championName,
//                     kda: playerStat.challenges.kda,
//                     role: playerStat.lane,
//                     name: playerStat.riotIdGameName,
//                     win: playerStat.win,
//                     kills: playerStat.kills,
//                     deaths: playerStat.deaths,
//                     assists: playerStat.assists,
//                     minions: playerStat.totalMinionsKilled + playerStat.neutralMinionsKilled,
//                 });
//             } catch (e) {
//                 reject();
//             }
//         }, 1000 * 60);
//     });
// }