const Room = require('../models/Room');

// In-memory storage for temporary data
const roomChats = new Map(); // roomId -> messages array
const roomCanvasData = new Map(); // roomId -> canvas drawing data
const roomTimers = new Map(); // roomId -> timer interval

class GameHandlers {
  constructor(io) {
    this.io = io;
  }

  // Join room handler
  async joinRoom(socket, { roomId, userId, username }) {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Check if user already in room
      let participant = room.participants.find(p => p.userId === userId);
      if (!participant) {
        participant = {
          userId,
          username,
          score: 0,
          isHost: room.participants.length === 0, // First person becomes host
          drawingTurns: 0,
          socketId: socket.id
        };
        room.participants.push(participant);
      } else {
        participant.socketId = socket.id;
      }

      await room.save();
      socket.join(roomId);

      // Initialize chat for room if not exists
      if (!roomChats.has(roomId)) {
        roomChats.set(roomId, []);
      }

      // Send room data to all participants
      this.io.to(roomId).emit('roomUpdate', {
        room: {
          _id: room._id,
          roomId: room.roomId,
          roomName: room.roomName,
          participants: room.participants,
          leaderboard: room.leaderboard,
          gameState: room.gameState
        },
        chats: roomChats.get(roomId) || []
      });

    } catch (error) {
      console.error('Join room error:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  }

  // Leave room handler
  async leaveRoom(socket, { roomId, userId }) {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) return;

      // Remove participant
      room.participants = room.participants.filter(p => p.userId !== userId);

      // If room becomes empty, clean up
      if (room.participants.length === 0) {
        roomChats.delete(roomId);
        roomCanvasData.delete(roomId);
        if (roomTimers.has(roomId)) {
          clearInterval(roomTimers.get(roomId));
          roomTimers.delete(roomId);
        }
        await Room.findOneAndDelete({ roomId });
        return;
      }

      // Assign new host if current host left
      if (!room.participants.some(p => p.isHost)) {
        room.participants[0].isHost = true;
      }

      // If current drawer left, move to next player
      if (room.gameState.currentDrawer === userId && room.gameState.isActive) {
        await this.nextTurn(roomId);
      }

      await room.save();
      socket.leave(roomId);

      this.io.to(roomId).emit('roomUpdate', {
        room: {
          _id: room._id,
          roomId: room.roomId,
          roomName: room.roomName,
          participants: room.participants,
          leaderboard: room.leaderboard,
          gameState: room.gameState
        },
        chats: roomChats.get(roomId) || []
      });

    } catch (error) {
      console.error('Leave room error:', error);
    }
  }

  // Start game handler
  async startGame(socket, { roomId, userId }) {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      const host = room.participants.find(p => p.userId === userId && p.isHost);
      if (!host) {
        socket.emit('error', { message: 'Only host can start the game' });
        return;
      }

      if (room.participants.length < 2) {
        socket.emit('error', { message: 'Need at least 2 players to start' });
        return;
      }

      // Reset game state
      room.gameState.isActive = true;
      room.gameState.round = 1;
      room.participants.forEach(p => {
        p.drawingTurns = 0;
        p.score = 0;
      });
      room.leaderboard = [];

      // Start first turn
      const firstDrawer = room.participants[0];
      room.gameState.currentDrawer = firstDrawer.userId;
      room.gameState.currentWord = room.getRandomWord();
      room.gameState.timeLeft = room.roundDuration;

      await room.save();

      // Clear canvas
      roomCanvasData.delete(roomId);

      // Start timer
      this.startTimer(roomId);

      // Notify all players
      this.io.to(roomId).emit('gameStarted', {
        room: {
          _id: room._id,
          roomId: room.roomId,
          roomName: room.roomName,
          participants: room.participants,
          leaderboard: room.leaderboard,
          gameState: room.gameState
        },
        currentWord: room.gameState.currentWord,
        wordWithDashes: room.getWordWithDashes(room.gameState.currentWord)
      });

    } catch (error) {
      console.error('Start game error:', error);
      socket.emit('error', { message: 'Failed to start game' });
    }
  }

  // Stop game handler
  async stopGame(socket, { roomId, userId }) {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) return;

      const host = room.participants.find(p => p.userId === userId && p.isHost);
      if (!host) {
        socket.emit('error', { message: 'Only host can stop the game' });
        return;
      }

      room.gameState.isActive = false;
      room.gameState.currentDrawer = null;
      room.gameState.currentWord = null;
      room.gameState.timeLeft = 0;

      // Clear timer
      if (roomTimers.has(roomId)) {
        clearInterval(roomTimers.get(roomId));
        roomTimers.delete(roomId);
      }

      // Clear canvas
      roomCanvasData.delete(roomId);

      await room.save();

      this.io.to(roomId).emit('gameStopped', {
        room: {
          _id: room._id,
          roomId: room.roomId,
          roomName: room.roomName,
          participants: room.participants,
          leaderboard: room.leaderboard,
          gameState: room.gameState
        }
      });

    } catch (error) {
      console.error('Stop game error:', error);
    }
  }

  // Chat message handler
  async sendMessage(socket, { roomId, userId, username, message }) {
    if (!roomChats.has(roomId)) {
      roomChats.set(roomId, []);
    }

    const chatMessage = {
      id: Date.now(),
      userId,
      username,
      message,
      timestamp: new Date()
    };

    roomChats.get(roomId).push(chatMessage);

    // Keep only last 100 messages
    const messages = roomChats.get(roomId);
    if (messages.length > 100) {
      roomChats.set(roomId, messages.slice(-100));
    }

    this.io.to(roomId).emit('newMessage', chatMessage);
  }

  // Guess handler
  async sendGuess(socket, { roomId, userId, username, guess }) {
    try {
      const room = await Room.findOne({ roomId });
      if (!room || !room.gameState.isActive) return;

      // Don't process guess from current drawer
      if (room.gameState.currentDrawer === userId) return;

      const normalizedGuess = guess.toLowerCase().trim();
      const currentWord = room.gameState.currentWord.toLowerCase();

      let points = 0;
      let isCorrect = false;

      if (normalizedGuess === currentWord) {
        isCorrect = true;
        points = Math.max(10, Math.floor(room.gameState.timeLeft / 2)); // More points for faster guesses
        
        // Update participant score
        const participant = room.participants.find(p => p.userId === userId);
        if (participant) {
          participant.score += points;
        }

        // Update leaderboard
        room.updateLeaderboard(userId, username, points, true);

        await room.save();

        // Notify correct guess
        this.io.to(roomId).emit('correctGuess', {
          userId,
          username,
          word: room.gameState.currentWord,
          points,
          leaderboard: room.leaderboard
        });

        // Move to next turn after short delay
        setTimeout(() => this.nextTurn(roomId), 2000);
      } else {
        // Add guess to chat
        if (!roomChats.has(roomId)) {
          roomChats.set(roomId, []);
        }

        const chatMessage = {
          id: Date.now(),
          userId,
          username,
          message: guess,
          timestamp: new Date()
        };

        roomChats.get(roomId).push(chatMessage);
        this.io.to(roomId).emit('newMessage', chatMessage);
      }

    } catch (error) {
      console.error('Send guess error:', error);
    }
  }

  // Canvas drawing handler
  canvasUpdate(socket, { roomId, canvasData }) {
    roomCanvasData.set(roomId, canvasData);
    socket.to(roomId).emit('canvasUpdate', canvasData);
  }

  // Timer management
  startTimer(roomId) {
    if (roomTimers.has(roomId)) {
      clearInterval(roomTimers.get(roomId));
    }

    const timer = setInterval(async () => {
      try {
        const room = await Room.findOne({ roomId });
        if (!room || !room.gameState.isActive) {
          clearInterval(timer);
          roomTimers.delete(roomId);
          return;
        }

        room.gameState.timeLeft -= 1;

        if (room.gameState.timeLeft <= 0) {
          await this.nextTurn(roomId);
        } else {
          this.io.to(roomId).emit('timerUpdate', {
            timeLeft: room.gameState.timeLeft
          });
        }

        await room.save();
      } catch (error) {
        console.error('Timer error:', error);
      }
    }, 1000);

    roomTimers.set(roomId, timer);
  }

  // Move to next turn
  async nextTurn(roomId) {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) return;

      // Increment drawing turns for current drawer
      const currentDrawer = room.participants.find(p => p.userId === room.gameState.currentDrawer);
      if (currentDrawer) {
        currentDrawer.drawingTurns += 1;
      }

      // Check if game should end
      if (room.shouldGameEnd()) {
        room.gameState.isActive = false;
        room.gameState.currentDrawer = null;
        room.gameState.currentWord = null;

        if (roomTimers.has(roomId)) {
          clearInterval(roomTimers.get(roomId));
          roomTimers.delete(roomId);
        }

        await room.save();

        this.io.to(roomId).emit('gameEnded', {
          leaderboard: room.leaderboard,
          room: {
            _id: room._id,
            roomId: room.roomId,
            roomName: room.roomName,
            participants: room.participants,
            leaderboard: room.leaderboard,
            gameState: room.gameState
          }
        });
        return;
      }

      // Get next drawer
      const nextDrawer = room.getNextDrawer();
      if (!nextDrawer) {
        // This shouldn't happen, but handle it
        room.gameState.isActive = false;
        await room.save();
        return;
      }

      room.gameState.currentDrawer = nextDrawer.userId;
      room.gameState.currentWord = room.getRandomWord();
      room.gameState.timeLeft = room.roundDuration;

      // Clear canvas
      roomCanvasData.delete(roomId);

      await room.save();

      // Start new timer
      this.startTimer(roomId);

      // Notify new turn
      this.io.to(roomId).emit('newTurn', {
        currentDrawer: nextDrawer,
        currentWord: room.gameState.currentWord,
        wordWithDashes: room.getWordWithDashes(room.gameState.currentWord),
        timeLeft: room.gameState.timeLeft,
        room: {
          _id: room._id,
          roomId: room.roomId,
          roomName: room.roomName,
          participants: room.participants,
          leaderboard: room.leaderboard,
          gameState: room.gameState
        }
      });

    } catch (error) {
      console.error('Next turn error:', error);
    }
  }

  // Get room data handler
  async getRoomData(socket, { roomId }) {
    try {
      const room = await Room.findOne({ roomId });
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      socket.emit('roomData', {
        room: {
          _id: room._id,
          roomId: room.roomId,
          roomName: room.roomName,
          participants: room.participants,
          leaderboard: room.leaderboard,
          gameState: room.gameState
        },
        chats: roomChats.get(roomId) || [],
        canvasData: roomCanvasData.get(roomId) || null,
        currentWord: room.gameState.currentWord,
        wordWithDashes: room.gameState.currentWord ? room.getWordWithDashes(room.gameState.currentWord) : null
      });

    } catch (error) {
      console.error('Get room data error:', error);
      socket.emit('error', { message: 'Failed to get room data' });
    }
  }
}

module.exports = GameHandlers;