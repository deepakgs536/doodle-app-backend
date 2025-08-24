const asyncHandler = require("express-async-handler");
const Rooms = require("../models/roomModel");
const Chats = require("../models/chatModel");
const generateRoomId = require("../utils/generateRoomId");
const { generateWords } = require("../utils/generateWords");

const createRoom = asyncHandler(async (req, res) => {
  const { roomName, difficultyLevel, roundDuration, wordCategory } = req.body;
  const user = req.user;

  const roomId = await generateRoomId();

  // 2. Create chat document with initial system message
  const generatedWords = await generateWords(difficultyLevel, wordCategory);

  const newRoom = await Rooms.create({
    roomId,
    roomName,
    difficultyLevel,
    roundDuration,
    wordCategory,
    participants: [],
    words: generatedWords,
    hostId: user._id,
  });

  await Chats.create({
    roomCode: roomId, // link chat to this room
    chats: [
      {
        userId: "1", // system user
        username: "",
        message: "Welcome to the room! Waiting for host to start the game...",
      },
    ],
    canvasChange: [],
  });

  res.status(201).json(newRoom); // send full room
});

const joinRoom = asyncHandler(async (req, res) => {
  try {
    const { roomCode } = req.body;

    // 1. Find room by code
    const room = await Rooms.findOne({ roomId: roomCode });
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    if(room.isStarted){
      res.status(404) ;
      throw new Error("Game already started") ;
    }

    res.json(room); // send full room
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

const roomDetail = asyncHandler(async (req,res) => {
  try {
    const room = await Rooms.findOne({ _id: req.params.roomId });
    if (!room) return res.status(404).json({ message: "Room not found" });

    res.json(room);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
})  

module.exports = { createRoom , joinRoom , roomDetail} ;
