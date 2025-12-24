const { PeerServer } = require('peer');
require('dotenv').config();

// const app = express();
// app.use(cors());

const port = process.env.PORT || 5432;

// const server = app.listen(port, () => {
//   console.log(`Peer server on :${port}`);
// });

// const peerServer = ExpressPeerServer(server, {
//   port: 9000,
//   path: '/',
//   allow_discovery: true,
// });

const peerServer = PeerServer({
  port: port,
  path: '/',
  allow_discovery: true,
});

// Log events
peerServer.on('connection', (client) => {
  console.log('Client connected: ', client.getId());
});

peerServer.on('disconnect', (client) => {
  console.log('Client disconnected: ', client.getId());
});

// app.use('/', peerServer);

// app.use(express.static('build'));
// app.get('*', (req, res) => {
//   res.sendFile(path.resolve(__dirname, 'build', 'index.html'));
// });
