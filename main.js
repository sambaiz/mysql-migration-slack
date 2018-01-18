require('dotenv').config();
const exec = require('child_process').exec;
const http = require('http');
const moment = require('moment');
const { WebClient } = require('@slack/client');
const { createMessageAdapter } = require('@slack/interactive-messages');

const web = new WebClient(process.env.SLACK_ACCESS_TOKEN);
const slackMessages = createMessageAdapter(process.env.SLACK_VERIFICATION_TOKEN);
const channelId = process.env.SLACK_CHANNEL_ID;
const repositoryName = process.env.GITHUB_REPOSITORY_NAME;
const repositoryPath = `${process.env.GITHUB_REPOSITORY_USER}/${process.env.GITHUB_REPOSITORY_NAME}`;
const mySQLConf = process.env.MYSQL_CONF;

const express = require('express');
const bodyParser = require('body-parser');
const app = express();

const auth = require('basic-auth');
const compare = require('tsscmp');

app.use(bodyParser.urlencoded({ extended: false }));
app.all('/auth/*', (req, res, next) => {
  const credentials = auth(req);
  if (!credentials || !check(credentials.name, credentials.pass)) {
    res.status(401).send('Unauthorized');
  } else {
    next();
  }
});

const check = (name, pass) => {
  return compare(name, process.env.USER_NAME) && compare(pass, process.env.USER_PASSWORD)
} 

// Interactive Messages Handler
app.use('/slack', slackMessages.expressMiddleware());

slackMessages.action('migrate', (payload, respond) => {
  let replacement = payload.original_message; 
  delete replacement.attachments[0].actions; 
  replacement.attachments[0].text = `start migration by ${payload.user.name} at ${moment().format()}`;
  replacement.attachments[0].fields = [
    { 
       "title": "State",
       "value": "Running",
       "short": false
    } 
  ]; 

  exec(
    // Attention to command injection
    `rm -rf ${repositoryName} && git clone git@github.com:${repositoryPath}.git && cd ${repositoryName}/goose && goose mysql "${mySQLConf}" up`, 
    (err, stdout, stderr) => {
      replacement.attachments[0].fields = [
        { 
          "title": "Result",
          "value": (err || stderr) ? `${stderr || err}` : "Success",
          "short": false
        }
      ];
      respond(replacement);
    }
  );
  
  return replacement;
});

// Post Messages Handler
app.get('/auth/message', async (req,res) => {
  const { version, filename, commit } = req.query;
  await web.chat.postMessage(channelId, '', {
    attachments: [
      {
        title: `${filename} (Version ${version}) is ready`,
        title_link: `https://github.com/${repositoryName}/commit/${commit}`,
        color: "#36a64f",
        callback_id: "migrate",
        actions: [
          {
            name: "Migrate",
            type: "button",
            style: "primary",
            text: "Migrate",
            value: "Migrate"
          }
        ]
      }
    ]
  }).catch(console.error);
  res.send('done');
});

const port = process.env.PORT || 3000;
http.createServer(app).listen(port, () => {
  console.log(`server listening on port ${port}`);
});
