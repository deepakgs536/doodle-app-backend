// server.js
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const dbConnection = require("./config/dbConnection");
const errorHandler = require("./middleware/errorHandler");
const { protect } = require("./middleware/auth");

dotenv.config();
dbConnection();

const app = express();
const port = process.env.PORT || 5000;

// ===== Express Middlewares =====
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
}));
app.use(express.json());

// ===== REST Routes =====
app.use("/", require("./routers/auth"));
app.use("/user", protect, require("./routers/userRouter"));
app.use("/room", protect, require("./routers/roomRouter"));
app.use(errorHandler);

// ===== HTTP + Socket.IO =====
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

    // ===== Models =====
    const Rooms = require("./models/roomModel");
    const Chats = require("./models/chatModel");
    const mongoose = require("mongoose");
    const { generateWords } = require("./utils/generateWords");

    // ---- Global round state (shared across all sockets) ----
    const roundTimers = new Map();     // key: roomId string -> setInterval handle
    const roundEnding = new Set();     // key: roomId string -> lock to avoid double end

    const keyOf = (id) => id?.toString?.() || String(id);

    function clearRoomTimer(roomId) {
      const k = keyOf(roomId);
      const t = roundTimers.get(k);
      if (t) {
        clearInterval(t);
        roundTimers.delete(k);
      }
    }

    // ===== SINGLE Socket.IO Connection Block =====
    io.on("connection", (socket) => {

    // Safely stringify ObjectId-like values
    const toId = (v) => (v && typeof v === "object" && v.toString ? v.toString() : String(v || ""));

    async function startRound(io, roomId) {
      const k = keyOf(roomId);
      const room = await Rooms.findOne({ _id: roomId });
      if (!room) return;

      // start timestamp & round token (guards against stale intervals)
      const startTime = Date.now();
      const totalTime = room.roundDuration * 1000;
      room.roundStartTime = startTime;
      // optional: round token to detect stale enders
      room.roundToken = String(startTime);
      await room.save();

      clearRoomTimer(k);

      const handle = setInterval(async () => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(totalTime - elapsed, 0);

        for (const p of room.participants) {
          if (p.socketId) io.to(p.socketId).emit("timerUpdate", Math.ceil(remaining / 1000));
        }

        if (remaining <= 0) {
          await endCurrentRound(io, roomId);
        }
      }, 1000);

      roundTimers.set(k, handle);
        }

    async function endCurrentRound(io, roomId) {
      const k = keyOf(roomId);

      // prevent double execution
      if (roundEnding.has(k)) return;
      roundEnding.add(k);

      try {
        clearRoomTimer(k);

        const room = await Rooms.findOne({ _id: roomId });
        if (!room) return;

        // 1) Reveal answer & clear canvas on clients
        for (const p of room.participants) {
          if (p.socketId) {
            io.to(p.socketId).emit("canvasCleared");
            io.to(p.socketId).emit("showAnswer", true);
          }
        }

        // 2) Small pause then cleanup & next turn
        setTimeout(async () => {
          await Chats.updateOne(
            { roomCode: room.roomId },
            { $set: { canvasChange: [] } }
          );

          for (const p of room.participants) {
            if (p.socketId) io.to(p.socketId).emit("showAnswer", false);
          }

          const chatDoc = await Chats.findOne({ roomCode: room.roomId });
          if (chatDoc) {
            chatDoc.correctAnswers = [];
            await chatDoc.save();
          }

          await nextTurn(io, roomId);
        }, 5000);
      } finally {
        roundEnding.delete(k);
      }
    }

    async function nextTurn(io, roomId) {
      // IMPORTANT: this runs outside socket scope; same code as yours but keep:
      // - call clearRoomTimer(roomId) first
      // - at the very end call startRound(io, roomId)
      let room = await Rooms.findOne({ _id: roomId });
      if (!room || !room.isStarted) return;

      clearRoomTimer(roomId);

      if (!room.participants || room.participants.length === 0) {
        room.isStarted = false;
        await room.save();
        return;
      }

      if (room.currentTurnIndex === 0) room.maxRounds -= 1;

      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.participants.length;

      if (room.maxRounds <= 0) {
        for (const p of room.participants) {
          if (p.socketId) {
            io.to(p.socketId).emit("receiveMessage", { userId: "1", user: "", message: "Game over!" });
            io.to(p.socketId).emit("showResult", room);
          }
        }
        setTimeout(async () => { await Chats.deleteOne({ roomCode: room.roomId }); }, 12000);
        return;
      }

      // ====== Fetch new word ======
      let wordList = room.words || [];

      if (wordList.length > 0) {
        const randomIndex = Math.floor(Math.random() * wordList.length);
        room.currentWord = wordList[randomIndex];

        // Remove used word so it’s not repeated
        wordList.splice(randomIndex, 1);
        room.words = wordList;
      } else {
        for (const participant of room.participants) {
          if (participant.socketId) {
            io.to(participant.socketId).emit("receiveMessage", { userId: "1", user: "", text: "Game has ended" });
            io.to(participant.socketId).emit("showResult", room);
          }
        }
      }

      // word selection (same as yours) ...

      const currentDrawer = room.participants[room.currentTurnIndex];
      room.currentTurnUserId = currentDrawer?.userId || null;

      await room.save();

      for (const p of room.participants) {
        if (p.socketId) {
          io.to(p.socketId).emit("receiveMessage", { userId: "1", user: "", message: `It's ${currentDrawer?.username}'s turn to draw!` });
          io.to(p.socketId).emit("roomData", room);
          io.to(p.socketId).emit("gotAnswer", false);
        }
      }

      await startRound(io, roomId);
    }

    socket.on("submitAnswer", async ({ roomId, userId, answer }) => {
      try {
        const objectId = new mongoose.Types.ObjectId(roomId);
        const room = await Rooms.findOne({ _id: objectId });
        if (!room) return;

        const uid = toId(userId);
        const player = (room.participants || []).find((p) => toId(p.userId) === uid);
        if (!player) return;

        const givenAnswer = (answer || "").trim().toLowerCase();
        const correctWord = (room.currentWord || "").trim().toLowerCase();

        let delta = 0;

        if (givenAnswer === correctWord) {
          // Calculate based on time left
          const elapsed = Date.now() - room.roundStartTime;
          const remaining = Math.max(room.roundDuration * 1000 - elapsed, 0);

          const basePoints = 50;
          const bonusPoints = 50;

          delta = basePoints + Math.floor((remaining / (room.roundDuration * 1000)) * bonusPoints);

          // ✅ Save correct answer in Chats collection
          const chatDoc = await Chats.findOne({ roomCode: room.roomId });
          if (chatDoc) {
            socket.emit("gotAnswer", true);
            chatDoc.correctAnswers.push({
              userId,
              timestamp: new Date(),
            });

          await chatDoc.save();
          
          if(chatDoc.correctAnswers.length >= room.participants.length - 1){
            clearRoomTimer(roomId); // prevent old timer from firing
            endCurrentRound(io, roomId, room); // Use roomId, not room.roomId
          }
        }
          // ✅ Reward current drawer with 30% of delta
          if (room.currentTurnUserId) {
            const drawer = (room.participants || []).find(
              (p) => toId(p.userId) === toId(room.currentTurnUserId)
            );
            if (drawer) {
              const drawerBonus = Math.floor(delta * 0.2);
              drawer.score = (drawer.score || 0) + drawerBonus;
            }
          }
        }

        // Update score
        player.score = (player.score || 0) + delta;

        await room.save();

        for (const participant of room.participants) {
          if (participant.socketId) {
            io.to(participant.socketId).emit("roomData", room);
          }
        }

      } catch (err) {
        console.error("submitAnswer error:", err);
      }
    });

    socket.on("startGame", async ({ roomId }) => {
      try {
        if (!roomId) return;
        
        const objectId = new mongoose.Types.ObjectId(roomId);
        let room = await Rooms.findOne({ _id: objectId });
        if (!room) return;

        if (room.participants.length < 2) {
          socket.emit("errorMessage", "At least need 2 Players to start");
          return;
        }

        // ✅ FIXED: Clear any existing timers before starting
        if (roundTimers[roomId]) {
          clearInterval(roundTimers[roomId]);
          delete roundTimers[roomId];
        }

        room.isStarted = true;
        room.isActive = true;
        room.currentRound = 1;
        room.currentTurnIndex = 0;
        room.maxRounds = Number(room.maxRounds) > 0 ? Number(room.maxRounds) : 3;
        room.roundDuration = Number(room.roundDuration) > 0 ? Number(room.roundDuration) : 30;

        // Initialize leaderboard if it doesn't exist
        if (!room.leaderboard) room.leaderboard = [];

        // ✅ FIXED: Initialize scores for all participants
        room.participants.forEach(participant => {
          if (participant.score === undefined) {
            participant.score = 0;
          }
        });

        // Assign current drawer
        const currentDrawer = room.participants[room.currentTurnIndex];
        room.currentTurnUserId = currentDrawer?.userId;

        const wordCount = ((room.participants.length * 3) || 20) + 2;

        const generatedWords = await generateWords(room.difficultyLevel, room.wordCategory, wordCount);
        console.log(generatedWords);

        // Update the words of a room by roomId
        const updatedRoom = await Rooms.findOneAndUpdate(
          { _id: objectId },                // Filter: find the room by roomId
          { $set: { words: generatedWords } }, // Only update words
          { new: true }              // Return the updated document
        );

        // ✅ FIXED: Set initial word
        const room_code = await Rooms.findOne({ _id: objectId });
        let wordList = room_code?.words || [];
        if (wordList.length > 0) {
          const randomIndex = Math.floor(Math.random() * wordList.length);
          room.currentWord = wordList[randomIndex];
          // Remove used word
          wordList.splice(randomIndex, 1);
          room_code.words = wordList;
          await room_code.save();
        } else {
          for (const participant of room.participants) {
            if (participant.socketId) {
              io.to(participant.socketId).emit("receiveMessage", { userId: "1", user: "", text: "Game has ended" });
              io.to(participant.socketId).emit("showResult", room);
            }
          }
        }

        await room.save();

        // ✅ FIXED: Broadcast to ALL users in the room
        for (const participant of room.participants) {
          if (participant.socketId) {
            io.to(participant.socketId).emit("roomData", room);
          }
        }
        for (const participant of room.participants) {
          if (participant.socketId) {
            io.to(participant.socketId).emit("receiveMessage", {
              userId: "1",
              user: "",
              message: `It's ${currentDrawer?.username}'s turn to draw!`,
            });
          }
        }

        // Start the first round
        startRound(io, roomId);

      } catch (err) {
        console.error("startGame error:", err);
        socket.emit("errorMessage", "Failed to start game");
      }
    });

    // === joinRoom ===
    socket.on("joinRoom", async ({ roomId, userId, username }) => {
    try {
        if (!roomId || !userId || !username) {
        return socket.emit("errorMessage", "Missing roomId/userId/username");
        }

        socket.join(roomId);

        const objectId = new mongoose.Types.ObjectId(roomId);

        // Find room by custom roomId
        let room = await Rooms.findOne({ _id: objectId });
        if (!room) return socket.emit("errorMessage", "Room not found");

        // ✅ Fix: type-safe check
        const isExist = room.participants.some(
            p => String(p.userId) === String(userId)
        );

        if (!isExist) {
        // New participant
        await Rooms.updateOne(
            { _id: objectId },
            { $push: {
                participants: { userId, username, score: 0, socketId: socket.id } 
              }
            }
        );

        for (const participant of room.participants) {
          if (participant.socketId) {
            io.to(participant.socketId).emit("receiveMessage", {
              userId: "1",
              user: "",
              message: `${username} joined the room`,
            });
          }
        }

        } else {
            // User already exists → just update socketId
            await Rooms.updateOne(
                { _id: objectId, "participants.userId": userId },
                { $set: { "participants.$.socketId": socket.id } }
            );
        }

        // Get fresh room data
        room = await Rooms.findOne({ _id: objectId });

        const room_code = await Rooms.findOne({ _id: objectId });
        let chatDoc = await Chats.findOne({ roomCode: room_code.roomId });

        // ✅ FIXED: Send updated room + chat history to the new user
        socket.emit("roomData", room_code);
        if (chatDoc) {
          socket.emit("chatHistory", chatDoc.chats);
          socket.emit("canvasHistory", chatDoc.canvasChange);
        }

        // 🚀 Brute force: send roomData to EACH participant individually
        for (const participant of room.participants) {
          if (participant.socketId) {
            io.to(participant.socketId).emit("roomData", room);
          }
        }

        } catch (err) {
            console.error("joinRoom error:", err);
            socket.emit("errorMessage", "Failed to join room");
        }
    });

    // Drawing event
    const Chats = require("./models/chatModel"); // adjust path if needed

    // Drawing event
    socket.on("drawing", async (data) => {
      try {
        // 1. Broadcast to other users in the same room
        socket.broadcast.emit("drawing", data);

        // 2. Find the room and chat doc
        const room = await Rooms.findOne({_id : data.roomId}); // frontend must send roomId
        if (!room) return console.error("Room not found:", data.roomId);

        // 3. Save the canvas change into Chats
        await Chats.updateOne(
          { roomCode: room.roomId },
          {
            $push: {
              canvasChange: {
                x: data.x,
                y: data.y,
                color: data.color,
                lineWidth: data.lineWidth,
                mode: data.mode,
                type: data.type,
                timestamp: new Date()
              }
            }
          },
          { upsert: true } // create Chats doc if missing
        );
      } catch (err) {
        console.error("Error saving drawing:", err);
      }
    });

    // Optional: Load existing canvas data when user joins room
    socket.on("loadCanvas", async ({ roomId }) => {
    try {
        const objectId = new mongoose.Types.ObjectId(roomId);
        const room_code = await Rooms.findOne({ _id: objectId });
        
        if (!room_code) return;

        const chatDoc = await Chats.findOne({ roomCode: room_code.roomId });
        
        if (chatDoc && chatDoc.canvasChange.length > 0) {
        // Send existing canvas data to the requesting client
        socket.emit("canvasData", { canvasChange: chatDoc.canvasChange });
        }
        
    } catch (err) {
        console.error("loadCanvas error:", err);
    }
    });

    // === sendChat ===
    socket.on("sendChat", async ({ roomId, userId, user, message }) => {
    try {
        if (!roomId || !message) return;

        // Save to DB
        const objectId = new mongoose.Types.ObjectId(roomId);
        const room_code = await Rooms.findOne({ _id: objectId });

        await Chats.findOneAndUpdate(
        { roomCode: room_code.roomId },
        {
            $push: {
            chats: { userId, username: user, message },
            },
        },
        { new: true, upsert: true }
        );

        // Emit new message to room
        for (const participant of room_code.participants) {
          if (participant.socketId) {
            io.to(participant.socketId).emit("receiveMessage", {
              userId,
              user,
              message,
            });
          }
        }

    } catch (err) {
        console.error("sendChat error:", err);
        socket.emit("errorMessage", "Failed to send message");
    }
    });

    // Leave Room
    socket.on("leaveRoom", async ({ roomId, userId, username }) => {
      try {
        if (!roomId || !userId) return;
        socket.leave(roomId);

        let room = await Rooms.findOne({ _id : roomId });
        if (!room) return;

        const uid = toId(userId);
        room.participants = (room.participants || []).filter((p) => toId(p.userId) !== uid);

        await room.save();

        for (const participant of room.participants) {
          if (participant.socketId) {
            io.to(participant.socketId).emit("receiveMessage", {
              userId: "1",
              user: "",
              message: `${username} left the room`,
            });
          }
        }

      } catch (err) {
        console.error("leaveRoom error:", err);
        socket.emit("errorMessage", "Failed to leave room");
      }
    });

    // End Game
    socket.on("endGame", async ({ roomId }) => {
      try {
        if (!roomId) return;
        const room = await Rooms.findOneAndUpdate(
          { roomId },
          { isStarted: false, isActive: false },
          { new: true }
        );
        if (!room) return;

        for (const participant of room.participants) {
          if (participant.socketId) {
            io.to(participant.socketId).emit("receiveMessage", { userId: "1", user: "", text: "Game has ended" });
            io.to(participant.socketId).emit("showResult", room);
          }
        }
      } catch (err) {
        console.error("endGame error:", err);
        socket.emit("errorMessage", "Failed to end game");
      }
    });

    socket.on("disconnect", () => {
      // console.log("User disconnected:", socket.id);
    });
});

// ===== Start Server =====
server.listen(port, () => {
  // console.log(`Server running on port ${port}`);
});
