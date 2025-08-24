const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      unique: true, // 6-digit unique code
      trim: true,
    },
    roomName: {
      type: String,
      required: true,
      trim: true,
    },
    difficultyLevel: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
    roundDuration: {
      type: Number, // seconds
      default: 60,
    },
    wordCategory: {
      type: String,
      default: "general",
    },
    participants: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "Users" },
        username: { type: String, required: true },
        score: { type: Number, default: 0 },
        socketId: { type: String }, // ✅ store socket.id for targeting
      },
    ],

    hostId: {
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Users"
    },

    // ✅ Turn management
    currentTurnIndex: {
      type: Number,
      default: 0, // index of current drawer in participants[]
    },
    currentTurnUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Users",
      default: null,
    },

    // ✅ Word for current round
    currentWord: {
      type: String,
      default: "",
    },

    roundStartTime: { type: Number }, // store Date.now() timestamp

    // NEW: leaderboard (array of { username, score })
    leaderboard: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "Users" },
        username: { type: String, required: true },
        score: { type: Number, default: 0 },
      },
    ],

    words: {
      type: [String],   // array of strings
      required: true,
      default: [],
    },

    // NEW: game status
    isStarted: { type: Boolean, default: false },

    isActive: {
      type: Boolean,
      default: true,
    },

    maxRounds: {
      type: Number,
      default: 3,
    }

  },
  { timestamps: true }
);

module.exports = mongoose.model("Rooms", roomSchema);
