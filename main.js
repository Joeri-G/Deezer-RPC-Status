const url = require('url');             // used to parse API response
const fs = require('fs');               // used for writing to settings file
const open = require('open');           // used for opening browser window
const settings = require("./settings"); // settings file
const http = require('http');           // used in the authentication process
// Discord RPC client
const client = require('discord-rich-presence')(settings.Discord.client_id);
// declaration of global constants
const REDIRECT_URI = encodeURIComponent(`http://localhost:${settings.auth_server.port}/stage-1`);
const DEEZER_AUTH_URL = `https://connect.deezer.com/oauth/auth.php?app_id=${settings.Deezer.app_id}&redirect_uri=${REDIRECT_URI}&perms=${settings.Deezer.permissions}`;
// declaration of global variables (Bad practice, I know...)
var authServer = null;
var user = {
  id: null,
  accessToken: settings.Deezer.access_token,
  currentSong: null
};

var lastUpdate = Date.now();
var isListeningToNothing = false;
var deezerIsRunning = false;
// set an empty status for when the user is not listening to music
listeningToNothing();
// check what song the user is listening to
checkCurrentSong();
// set an interval to keep on checking
var songCheck = setInterval(checkCurrentSong, 10000);

// in the second stage of the authentication process a code is sent that can be
// combined with the app secret to retrieve an access token
function retrieveAccessToken(code) {
  const DEEZER_TOKEN_URL = `https://connect.deezer.com/oauth/access_token.php?app_id=${settings.Deezer.app_id}&secret=${settings.Deezer.app_secret}&code=${code}`;

  const request = require('request');

  request(DEEZER_TOKEN_URL, { json: false }, (err, res, body) => {
    if (err) { return console.log(err); }
    const data = new URLSearchParams(body);
    user.accessToken = (data.get("access_token") !== "null") ? data.get("access_token") : null; // update global accessToken
    // write access token to token.json
    console.log(user.accessToken);
    saveNewAccessToken(user.accessToken);

    authServer.close(); // close the server after the user has been authenticated
  });

}

// when a new access token is retrieved update the one stored in settings.json
function saveNewAccessToken(accessToken) {
  // load current settings
  let json_data = require("./settings");
  // replace token
  json_data.Deezer.access_token = accessToken;
  // convert json to string and pretty print it
  const string_data = JSON.stringify(json_data, null, 2);
  // write data to file
  fs.writeFile('./settings.json', string_data, 'utf8', (err) => {
    if (err) { console.log(`Error writing file: ${err}`); }
  });
}

// start auth server to complete the last stage of the Deezer Authentication process
function startAuthServer() {
  if (authServer !== null) return null;
  authServer = http.createServer(function (req, res) {
    res.writeHead(200, {'Content-Type': 'text/html'});

    const u = url.parse(req.url, true);
    if (u.pathname == "/stage-1") {
      retrieveAccessToken(u.query.code);
    }
    res.end("<!DOCTYPE html>\n<html><head><title>You can close this window</title></head><body><script>window.opener=self;window.close();</script>You can close this window</body></html>");

  })
  authServer.listen(settings.auth_server.port);
}

// query the api for the song history and compare the newest entry
// to the current song
function checkCurrentSong() {
  // make sure there is an access token
  if (!user.accessToken) {
    console.log("No access token");
    startAuthServer();
    open(DEEZER_AUTH_URL);
    return null;
  }

  const request = require('request');

  // load last played song
  request(`https://api.deezer.com/user/me/history?access_token=${user.accessToken}`, { json: true }, (err, res, body) => {
    // if something went wrong with the request
    if (err) { return console.log(err); }
    // if the token is no longer valid
    if (body.error && body.error.code == 200) {
      startAuthServer();
      open(DEEZER_AUTH_URL);
      return null;
    }

    const song = body.data[0];

    // if the last entry in the song history is the same as the currently
    // playing song check for how long that has been the case.
    if (user.currentSong && song.id == user.currentSong.id) {
      // do nothing if the current time is less than the expected run time of the song
      if (Date.now() <= lastUpdate + user.currentSong.duration * 1000) return null;
      // if it is the user has likely paused it and we should update the status
      listeningToNothing();

      return null;
    }

    user.currentSong = song;
    lastUpdate = Date.now();

    updateSongRPC(song);
  });
}

// update the Discord RPC status
function updateRPC(RPC) {
  client.updatePresence(RPC);
}

// set the Discord status to listening to nothing
function listeningToNothing() {
  if (isListeningToNothing) return null;
  isListeningToNothing = true;
  console.log("Now listening to nothing.");
  updateRPC({
    details: "Listening to nothing",
    state: "Any recommendations?",
    largeImageKey: 'dz_eq_large',
    largeImageText: 'Deezer',
    // smallImageKey: 'node_js',
    instance: true
  });
}

// update the Discord RPC status with a song
function updateSongRPC(song) {
  isListeningToNothing = false;
  console.log(`Now listening to "${song.title}", displayed as "${song.title_short}".`);
    updateRPC({
    details: `${song.title_short}`,
    state: `By ${song.artist.name}`,
    startTimestamp: Date.now(),
    // no point in having the counter count down as the app is one song behind
    // and we don't know how long the duration of the current song is
    // endTimestamp: Date.now() + Number(song.duration) * 1000,
    largeImageKey: 'dz_eq_large',
    largeImageText: song.album.title,
    // smallImageKey: 'node_js',
    instance: true
  });
}
