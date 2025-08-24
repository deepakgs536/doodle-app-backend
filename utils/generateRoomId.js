const Rooms = require("../models/roomModel");

async function generateRoomId() {
  let roomId;
  let exists = true;

  while (exists) {
    // Generate 6-digit number (leading zeros possible)
    roomId = Math.floor(100000 + Math.random() * 900000).toString();

    // Check uniqueness in DB
    const room = await Rooms.findOne({ roomId });
    if (!room) exists = false;
  }

  return roomId;
}

module.exports = generateRoomId;
