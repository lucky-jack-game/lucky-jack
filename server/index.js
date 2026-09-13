import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import cors from "cors";
// 1対1の対戦（server/match.js）が唯一の対戦実装。旧16人トーナメント(tournament.js)は
// 撤去済み。
import {
  joinQueue, leaveQueue, submitKJChoice, submitCardPick,
  submitBetAction, leaveMatch, handleDisconnect,
} from "./match.js";

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: CLIENT_ORIGIN } });

io.on("connection", (socket) => {
  socket.data.name = "プレイヤー";

  socket.on("match:queue", (payload) => joinQueue(io, socket, payload));
  socket.on("match:cancel", () => leaveQueue(io, socket));
  socket.on("match:leave", () => leaveMatch(io, socket));
  socket.on("match:kj_choose", ({ mode } = {}) => submitKJChoice(io, socket.data.matchId, socket.id, mode));
  socket.on("match:card_pick", ({ cardId } = {}) => submitCardPick(io, socket.data.matchId, socket.id, cardId));
  socket.on("match:bet_action", ({ action, fraction } = {}) =>
    submitBetAction(io, socket.data.matchId, socket.id, action, fraction));

  socket.on("disconnect", () => handleDisconnect(io, socket));
});

httpServer.listen(PORT, () => {
  console.log(`LUCKY JACK server listening on http://localhost:${PORT}`);
});
