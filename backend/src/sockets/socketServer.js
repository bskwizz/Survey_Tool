'use strict';

const { Server } = require('socket.io');
const config = require('../config');

/**
 * Socket.IO wiring.
 *
 * Room model: one room per question, named `question:<questionId>`. Both
 * the participant app (to receive live aggregate/synthesis updates for the
 * question it's currently answering) and the instructor dashboard / the
 * PowerPoint add-in's task pane (to drive the live slide view) join this
 * room. There is also a per-session room `session:<shortCode>` participants
 * join immediately on landing, so the instructor can push a brand-new
 * question to everyone already scanned-in without requiring a re-scan.
 *
 * Emitted events (see product spec):
 *   - response:new        -> { questionId, aggregate }
 *   - synthesis:updated   -> SynthesisSnapshot
 *   - question:status     -> { questionId, status }
 *   - question:push       -> { questionId } (new live question pushed to a session room)
 */
function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigin,
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    socket.on('join:question', (questionId) => {
      if (typeof questionId === 'string') socket.join(`question:${questionId}`);
    });

    socket.on('leave:question', (questionId) => {
      if (typeof questionId === 'string') socket.leave(`question:${questionId}`);
    });

    socket.on('join:session', (shortCode) => {
      if (typeof shortCode === 'string') socket.join(`session:${shortCode}`);
    });

    socket.on('disconnect', () => {
      // Socket.IO automatically cleans up room membership on disconnect.
    });
  });

  return io;
}

/** Instructor dashboard/add-in calls this to push a new live question to everyone in a session. */
function pushQuestionToSession(io, shortCode, questionId) {
  io.to(`session:${shortCode}`).emit('question:push', { questionId });
}

module.exports = { createSocketServer, pushQuestionToSession };
