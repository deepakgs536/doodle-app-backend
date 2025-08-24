const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema({
  roomCode: { type: String, required: true },
  chats: [
    {
      userId: String,
      username: String,
      message: String,
      timestamp: { type: Date, default: Date.now }
    }
  ],

  canvasChange: [
    {
      x: Number,
      y: Number,
      color: String,
      lineWidth: Number, // changed from strokeWidth to lineWidth
      mode: { type: String, enum: ["draw", "erase"] },
      type: { type: String, enum: ["start", "draw", "end", "clear"] },
      timestamp: { type: Date, default: Date.now }
    }
  ],

  correctAnswers: [
    {
      userId: { type: String, required: true },
      timestamp: { type: Date, default: Date.now }
    }
  ],

  words: {
    type: [String],   // array of strings
    required: true
  },
  
});

module.exports = mongoose.model("Chats", chatSchema);
