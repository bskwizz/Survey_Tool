'use strict';

const http = require('http');
const config = require('./config');
const { createSocketServer } = require('./sockets/socketServer');
const { createApp } = require('./app');

// Socket.IO needs the raw HTTP server up front, and the Express app needs
// `io` to emit events from within routes - so we create the HTTP server
// and socket layer first, then build the app around them.
const httpServer = http.createServer();
const io = createSocketServer(httpServer);
const { app } = createApp({ io });

httpServer.on('request', app);

httpServer.listen(config.port, () => {
  console.log(`[classroom-survey] backend listening on port ${config.port} (${config.nodeEnv})`);
  console.log(`[classroom-survey] storage engine: ${config.storageEngine}`);
  console.log(`[classroom-survey] synthesis provider: ${config.synthesisProvider}`);
  console.log(`[classroom-survey] public base URL: ${config.publicBaseUrl}`);
});

module.exports = { httpServer, io, app };
