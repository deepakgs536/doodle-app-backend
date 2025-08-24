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
  origin: process.env.CORS_ORIGIN || "http://localhost:5173",
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
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

    // ===== Models =====
    const Rooms = require("./models/roomModel");
    const Chats = require("./models/chatModel");
    const mongoose = require("mongoose");

    // ===== SINGLE Socket.IO Connection Block =====
    io.on("connection", (socket) => {

    // Safely stringify ObjectId-like values
    const toId = (v) => (v && typeof v === "object" && v.toString ? v.toString() : String(v || ""));

    const roundTimers = {};

    // Utility to clear any existing timer for a room
    function clearRoomTimer(roomId) {
      if (roundTimers[roomId]) {
        clearInterval(roundTimers[roomId]);
        delete roundTimers[roomId];
      }
    }

    async function nextTurn(io, roomId) {
      let room = await Rooms.findOne({ _id: roomId });
      if (!room || !room.isStarted) return;

      // Clear any existing timer first
      clearRoomTimer(roomId);

      // Guard against empty participants
      if (!room.participants || room.participants.length === 0) {
        room.isStarted = false;
        await room.save();
        io.to(roomId).emit("gameStatus", { isStarted: false, isActive: false });
        return;
      }

      // Advance turn index
      room.currentTurnIndex = (room.currentTurnIndex + 1) % room.participants.length;

      // If we wrapped around, increment round
      if (room.currentTurnIndex === 0) room.currentRound += 1;

      // ✅ Game over check
      if (room.currentRound > room.maxRounds) {
        room.isStarted = false;
        room.isActive = false;

        // Build leaderboard
        room.leaderboard = (room.participants || [])
          .map((p) => ({ username: p.username, score: p.score || 0 }))
          .sort((a, b) => b.score - a.score);

        await room.save();
        io.to(roomId).emit("roomData", room);
        io.to(roomId).emit("receiveMessage", { userId: "1", user: "", message: "Game over!" }); // Fixed: removed extra 'f'
        return;
      }

      // ====== Fetch words from Chats model ======
      const room_code = await Rooms.findOne({ _id: roomId });
      const chatDoc = await Chats.findOne({ roomCode: room_code.roomId });

      let wordList = chatDoc?.words || [];

      if (wordList.length > 0) {
        const randomIndex = Math.floor(Math.random() * wordList.length);
        room.currentWord = wordList[randomIndex];

        // Remove used word in Chats so it’s not repeated
        wordList.splice(randomIndex, 1);
        chatDoc.words = wordList;
        await chatDoc.save();
      } else {
        room.currentWord = "current word";
      }

      // Assign current drawer
      const currentDrawer = room.participants[room.currentTurnIndex];
      room.currentTurnUserId = currentDrawer?.userId || null;

      await room.save();

      // Broadcast new state
      io.to(roomId).emit("roomData", room);
      io.to(roomId).emit("gameStatus", { isStarted: true, isActive: true });
      io.to(roomId).emit("receiveMessage", {
        userId: "1",
        user: "",
        message: `It's ${currentDrawer?.username}'s turn to draw!`,
      });

      // Start the round timer (unified approach)
      startRound(io, roomId);
    }

    // Utility to start a round with timer
    async function startRound(io, roomId) {
      const room = await Rooms.findOne({ _id: roomId }); // Fixed: use _id instead of roomId
      
      if (!room) return;

      const totalTime = room.roundDuration * 1000;
      const startTime = Date.now();

      room.roundStartTime = startTime;
      await room.save();

      // Clear any existing timer
      clearRoomTimer(roomId);

      // Broadcast countdown every second
      roundTimers[roomId] = setInterval(async () => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(totalTime - elapsed, 0);

        io.to(roomId).emit("timerUpdate", Math.ceil(remaining / 1000));

        // Round end
        if (remaining <= 0) {
          clearRoomTimer(roomId);
          io.to(roomId).emit("roundEnded");
          
          // Move to next turn after a short delay

          // 1. Clear canvas and Show the answer immediately
          
          io.to(roomId).emit("canvasCleared");
          io.to(roomId).emit("showAnswer", true);

          // 2. Wait for some time (e.g., 2 seconds)
          setTimeout(async() => {
            // hide answer
            await Chats.updateOne(
              { roomCode: room.roomId },
              { $set: { canvasChange: [] } }
            );

            io.to(roomId).emit("showAnswer", false);

            // move to next turn
            nextTurn(io, roomId);
          }, 5000); // adjust duration as needed

        }
      }, 1000);
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
          }
        }

        // Update score
        player.score = (player.score || 0) + delta;

        await room.save();

        io.to(roomId).emit("scoreUpdate", room.leaderboard);
        io.to(roomId).emit("roomData", room);

      } catch (err) {
        console.error("submitAnswer error:", err);
      }
    });

    // Start Game (host only in ideal case; here we don't enforce host, but you can)
    socket.on("startGame", async ({ roomId }) => {
      try {
        if (!roomId) return;
        let room = await Rooms.findOne({ _id: roomId });
        if (!room) return;

        if(room.participants.length < 2) {
          socket.emit("errorMessage", "Atleast need 2 Playes to start");
          return;
        }

        room.isStarted = true;
        room.isActive = true;
        room.currentRound = 1;
        room.currentTurnIndex = 0;
        room.maxRounds = Number(room.maxRounds) > 0 ? Number(room.maxRounds) : 3;
        room.roundDuration = Number(room.roundDuration) > 0 ? Number(room.roundDuration) : 30;

        // Initialize leaderboard if it doesn't exist
        if (!room.leaderboard) room.leaderboard = [];

        // ====== Fetch words from Chats model ======

        const room_code = await Rooms.findOne({ _id: roomId });
        const chatDoc = await Chats.findOne({ roomCode: room_code.roomId });

        let wordList = chatDoc?.words || [];

        if (wordList.length > 0) {
          const randomIndex = Math.floor(Math.random() * wordList.length);
          room.currentWord = wordList[randomIndex];

          // Remove used word in Chats so it’s not repeated
          wordList.splice(randomIndex, 1);
          chatDoc.words = wordList;
          await chatDoc.save();
        } else {
          room.currentWord = "";
        }

        // Assign current drawer
        const currentDrawer = room.participants[room.currentTurnIndex];
        room.currentTurnUserId = currentDrawer?.userId; // Fixed: added optional chaining
        room.isStarted = true;
        room.isActive = true;

        await room.save();

        // Broadcast updated room to everyone
        io.to(roomId).emit("roomData", room);

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

    io.to(roomId).emit("receiveMessage", {
        userId: "1",
        user: "",
        message: `${username} joined the room`,
    });
        } else {
            // User already exists → just update socketId
            await Rooms.updateOne(
                { _id: objectId, "participants.userId": userId },
                { $set: { "participants.$.socketId": socket.id } }
            );
        }

        // Get fresh room data
        room = await Rooms.findOne({ _id: objectId });

        // Fetch chat history
        const room_code = await Rooms.findOne({ _id: objectId });

        let chatDoc = await Chats.findOne({ roomCode: room_code.roomId })

        // Send updated room + chat history to the new user
        socket.emit("roomData", room);
        socket.emit("chatHistory", chatDoc.chats);
        socket.emit("canvasHistory", chatDoc.canvasChange);

        // Broadcast updated room to everyone else
        io.to(roomId).emit("roomData", room);

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
        io.to(roomId).emit("receiveMessage", {
        userId,
        user,
        message,
        });
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

      //   //If host left, reassign first participant as host
      //   if (!room.participants.some((p) => p.isHost) && room.participants.length > 0) {
      //     return ;
      //   }

        await room.save();

        io.to(roomId).emit("roomData", room);
        // Broadcast system join message
          io.to(roomId).emit("receiveMessage", {
          userId: "1",
          user: "",
          message: `${username} left the room`,
          });
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

        io.to(roomId).emit("gameStatus", { isStarted: false, isActive: false });
        io.to(roomId).emit("receiveMessage", { userId: "1", user: "", text: "Game has ended" });
        io.to(roomId).emit("roomData", room);
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
  console.log(`Server running on port ${port}`);
});
