require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const { assertProductionEnv } = require('./config/env');
const { createApp } = require('./app');
const setupEditorSockets = require('./sockets/editorSockets');

assertProductionEnv();

const { app, corsOptions } = createApp();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
let shuttingDown = false;

const io = new Server(server, {
  cors: corsOptions,
  maxHttpBufferSize: 1e6
});

setupEditorSockets(io);

const shutdown = (reason, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down server: ${reason}`);
  server.close(() => {
    process.exit(exitCode);
  });
  setTimeout(() => process.exit(exitCode || 1), 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  shutdown('uncaughtException', 1);
});

connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
});
