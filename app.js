
var config = require('./config.js');

var request = require("request");
var express = require('express');
var passport = require('passport');
var util = require('util');
var session = require('express-session');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var methodOverride = require('method-override');
var GitHubStrategy = require('passport-github2').Strategy;
var partials = require('express-partials');
var moment = require('moment');
var swig = require('swig');
var sqlite3 = require('sqlite3').verbose();
var db = new sqlite3.Database(config.database.source);

var createUserTable = 'CREATE TABLE IF NOT EXISTS   users (login TEXT, email TEXT, PRIMARY KEY(login,email))';
var createLogTable = 'CREATE TABLE IF NOT EXISTS   log (login TEXT, email TEXT, link TEXT, date TEXT)';

db.serialize(function() {
    db.run(createUserTable, function (err) {
      if (err) {
        console.error('Db error::user table already exists(user table not created)');
      }
    });
    db.run(createLogTable, function (err) {
      if (err) {
        console.error('Db error::log table already exists(not table not created)');
      }
    });
});


db.close();



passport.serializeUser(function(user, done) {
    var db =  new sqlite3.Database(config.database.source);

    var queryNewUser = "INSERT INTO users VALUES ('"+user.username+"', '"+user.emails+"')";
    console.log(queryNewUser);

    db.serialize(function() {
      db.run(queryNewUser, function(err){
        if(err)
        console.error('Db error::user already exists (not added to user table)');
      });
    });

    db.close();
  done(null, user);
});

passport.deserializeUser(function(obj, done) {
  done(null, obj);
});

passport.use(new GitHubStrategy({
    clientID: config.gitAuth.clientId,
    clientSecret: config.gitAuth.clientSecret,
    callbackURL: config.gitAuth.redirectUrl,
    profileFields: ['email']
  },
  function(accessToken, refreshToken, profile, done) {

   var options = {
     headers: {
       'User-Agent':    'JavaScript.ru',
       'Authorization': 'token ' + accessToken
     },
     json:    true,
     url:     'https://api.github.com/user/emails'
   };

   request(options, function(error, response, body) {
     if (error || response.statusCode != 200) {
       console.error('Connection error::getting email adresses');
       done(null, false, {message: "Connection error."});
       return;
     }

     profile.emails = '';
     for(var i = 0; i< body.length; i++) {
        profile.emails+=body[i].email+'; ';
     }

      process.nextTick(function () {

        return done(null, profile);
    });
  }
)
}));


var app = express();
app.engine('html', swig.renderFile);
app.set('views', __dirname + '/views');
app.set('view engine', 'html');
app.use(partials());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(methodOverride());
app.use(session({ secret: 'keyboard cat', resave: false, saveUninitialized: false }));

app.use(cookieParser());
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(__dirname + '/public'));

app.get('/datasets/challenge-1.zip',function(req, res, next){
    if(req.cookies.checkbox==='true') return next();
    res.redirect('/challenge-1');
  },passport.authenticate('github', { scope: [ 'user:email' ] })
);

app.get('/dataset/challenge-2/urls', function(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(403).send('Unauthorized');
  }
  res.status(200).json({ datasetUrls: config.challenge2.datasetUrls });
});

app.get('/challenge-1', function(req, res){
  res.render('challenge-1');
});

app.get('/', function(req, res){
  res.redirect('https://www.getnexar.com/challenges/');
});

app.get('/auth', function(req, res, next) {
  passport.authenticate('github', {
    failureRedirect: req.query.challenge ? config[req.query.challenge].failureRedirect : '/challenge-1',
    callbackURL: config.gitAuth.redirectUrl + (req.query.challenge ? '?challenge=' + req.query.challenge : ''),
  })(req, res, next)
},
  function(req, res) {
    var challenge = config[req.query.challenge] || config.challenge1;
    var requestUrl = challenge.requestUrl;
    var redirectUrl = challenge.redirectUrl;
    var options = {
      json:    true,
      url:     requestUrl
    };
    request(options, function(error, response, body) {
      if (error || response.statusCode != 200) {
        console.error('Connection error::getting download link');

        done(null, false, {message: "Connection error."});
        return;
      }
      var db =  new sqlite3.Database(config.database.source);
      var user = {
        login: req.user.username,
        email: req.user.emails,
        link: body.url,
        date: (new moment()).format('DD.MMM.YYYY | HH:mm:ss').toString()
      };

      var queryLog = "INSERT INTO log VALUES ('"+user.login+"', '"+user.email+"', '"+user.link+"', '"+user.date+"')";
        console.log(queryLog);

      db.serialize(function() {
        db.run(queryLog, function(err){
          if(err) {
             console.error('Db error::user not logged');
          }
        });
      });

      db.close();

      if (challenge) {
        return res.redirect(redirectUrl);
      }

      res.write('<script>window.location="'+body.url+'";setTimeout(function() {window.location= "'+redirectUrl+'";},1500);</script>');
      res.end();
//setTimeout(function() {window.location="'+config.challenge1.redirectUrl+'"},2000);
    });
  });


app.listen(config.server.port, function() {
    console.log("Listening on " + config.server.port)
});


function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { return next(); }
  res.redirect('/')
}
