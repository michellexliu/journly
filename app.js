//jshint esversion:6
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");
const session = require("express-session");
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const findOrCreate = require("mongoose-findorcreate");
const natural = require("natural");
const Chart = require("chart.js");

const tokenizer = new natural.WordTokenizer();
const Analyzer = natural.SentimentAnalyzer;
const stemmer = natural.PorterStemmer;
const analyzer = new Analyzer("English", stemmer, "pattern");
const Sentiment = require("sentiment");
const sentiment = new Sentiment();

const app = express();

app.use(express.static("public"));
app.set("view engine", "ejs");
app.use(
  bodyParser.urlencoded({
    extended: true
  })
);

app.use(
  session({
    secret: "Our little secret.",
    resave: false,
    saveUninitialized: false
  })
);

app.use(passport.initialize());
app.use(passport.session());

// mongoose.connect("mongodb://localhost:27017/userDB", {
//   useNewUrlParser: true,
//   useUnifiedTopology: true,
//   useFindAndModify: false
// });

mongoose.connect(
  `mongodb+srv://admin-michelle:${process.env.DB_PW}@cluster0.07bud.mongodb.net/userDB`,
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useFindAndModify: false
  }
);
mongoose.set("useCreateIndex", true);

const postSchema = new mongoose.Schema({
  body: String,
  date: Date,
  score: Number
});

const Post = mongoose.model("Post", postSchema);

const userSchema = new mongoose.Schema({
  email: String,
  password: String,
  googleId: String,
  firstName: String,
  lastName: String,
  posts: [postSchema]
});

userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);

const User = mongoose.model("User", userSchema);

passport.use(User.createStrategy());

passport.serializeUser(function (user, done) {
  done(null, user.id);
});

passport.deserializeUser(function (id, done) {
  User.findById(id, function (err, user) {
    done(err, user);
  });
});

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/secrets",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo"
    },
    function (accessToken, refreshToken, profile, cb) {
      console.log(profile);

      User.findOrCreate({ googleId: profile.id }, function (err, user) {
        return cb(err, user);
      });
    }
  )
);

app.get("/", function (req, res) {
  if (req.isAuthenticated()) {
    res.redirect("/posts");
  } else {
    res.render("home");
  }
});

app.get(
  "/auth/google",
  passport.authenticate("google", { scope: ["profile"] })
);

app.get(
  "/auth/google/secrets",
  passport.authenticate("google", { failureRedirect: "/login" }),
  function (req, res) {
    // Successful authentication, redirect to secrets.
    res.redirect("/posts");
  }
);

app.get("/login", function (req, res) {
  res.render("login", { error: false });
});

app.get("/register", function (req, res) {
  res.render("register", { error: false });
});

app.get("/posts", function (req, res) {
  if (req.isAuthenticated()) {
    //console.log(req.user.posts);
    res.render("posts", { postList: req.user.posts, name: req.user.firstName });
  } else if (!req.isAuthenticated()) {
    res.redirect("/login");
  }
});

app.get("/logout", function (req, res) {
  req.logout();
  res.redirect("/");
});

app.post("/register", function (req, res) {
  User.findOne({ username: req.body.username }, function (err, user) {
    if (err) {
      console.log(err);
    } else if (user) {
      res.render("register", { error: true });
    } else {
      User.register(
        {
          username: req.body.username,
          firstName: req.body.firstName,
          lastName: req.body.lastName
        },
        req.body.password,
        function (err, user) {
          if (err) {
            console.log(err);
            res.redirect("/register");
          } else {
            passport.authenticate("local")(req, res, function () {
              res.redirect("/posts");
            });
          }
        }
      );
    }
  });
});

app.post("/login", function (req, res, next) {
  passport.authenticate("local", function (err, user, info) {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.render("login", { error: true });
    }
    req.logIn(user, function (err) {
      if (err) {
        return next(err);
      }
      return res.redirect("/posts");
    });
  })(req, res, next);
});

app.get("/compose", function (req, res) {
  if (!req.isAuthenticated()) {
    res.redirect("/login");
  }
  res.render("compose");
});

app.post("/compose", function (req, res) {
  if (!req.isAuthenticated()) {
    res.redirect("/login");
  }
  const bodyText = req.body.postBody;
  const tokenizedText = tokenizer.tokenize(bodyText);
  console.log(tokenizedText);
  const sentimentResult = sentiment.analyze(bodyText);
  console.log(sentimentResult);
  const sentimentScore = sentimentResult.comparative;

  const post = new Post({
    body: bodyText,
    date: req.body.date,
    score: sentimentScore
  });
  User.findById(req.user.id, function (err, foundUser) {
    if (err) {
      console.log(err);
    } else {
      if (foundUser) {
        User.findOneAndUpdate(
          { _id: foundUser._id },
          { $push: { posts: post } },
          function (err) {
            if (err) {
              console.log(err);
            } else {
              console.log("Successfully added the item: " + post);
            }
          }
        );
        res.redirect("/posts");
      }
    }
  });
});

app.get("/posts/:postId", function (req, res) {
  if (!req.isAuthenticated()) {
    res.redirect("/login");
  }

  User.findById(req.user.id, function (err, foundUser) {
    if (err) {
      console.log(err);
    } else {
      if (foundUser) {
        const foundPost = foundUser.posts.find(
          (post) => post._id == req.params.postId
        );
        res.render("post", { post: foundPost });
      }
    }
  });
});

app.get("/insights", function (req, res) {
  if (!req.isAuthenticated()) {
    res.redirect("/login");
  }

  User.findById(req.user.id, function (err, foundUser) {
    if (err) {
      console.log(err);
    } else {
      if (foundUser) {
        const language = "EN";
        const defaultCategory = "NN";

        const lexicon = new natural.Lexicon(language, defaultCategory);
        const ruleSet = new natural.RuleSet("EN");
        const tagger = new natural.BrillPOSTagger(lexicon, ruleSet);

        const posts = foundUser.posts;
        const sortedByScore = posts.slice().sort(function (a, b) {
          return b.score - a.score;
        });
        // const sortedByDate = posts.sort(function (a, b) {
        //   return a.date - b.date;
        // });
        const scoresOnly = sortedByScore.map((post) => post.score);
        let sum = 0;
        scoresOnly.forEach((score) => {
          sum += score;
        });
        const avg = sum / sortedByScore.length;
        console.log("Scores Only: " + scoresOnly);

        // const positivePosts = posts.filter((post) => post.score >= 0.1);
        // let positiveArr = [];
        // positivePosts.forEach(function (post) {
        //   const tokenizedText = Array.from(
        //     new Set(tokenizer.tokenize(post.body))
        //   );
        //   const taggedWords = tagger.tag(tokenizedText).taggedWords;
        //   const positiveNouns = taggedWords.filter((word) => word.tag === "NN");
        //   positiveNouns.forEach((noun) => positiveArr.push(noun));
        // });
        // positiveArr = Array.from(new Set(positiveArr));

        // console.log("positiveArr: " + positiveArr);

        // const negativePosts = posts.filter((post) => post.score <= -0.1);
        // let negativeArr = [];
        // negativePosts.forEach(function (post) {
        //   const tokenizedText = Array.from(
        //     new Set(tokenizer.tokenize(post.body))
        //   );
        //   console.log("tokenizedText: " + tokenizedText);
        //   const taggedWords = tagger.tag(tokenizedText).taggedWords;
        //   console.log("taggedWords: " + taggedWords);
        //   const negativeNouns = taggedWords.filter((word) => word.tag === "NN");
        //   console.log("negativeNouns: " + negativeNouns);
        //   negativeNouns.forEach((noun) => negativeArr.push(noun));
        // });
        // negativeArr = Array.from(new Set(negativeArr));

        // console.log("negativeArr: " + negativeArr);

        const sortedByDate = posts.slice().sort(function (a, b) {
          return a.date - b.date;
        });

        const xData = sortedByDate.map(function (post) {
          return post.date.toLocaleDateString("en-US");
        });

        const yData = sortedByDate.map(function (post) {
          return post.score;
        });

        const data = {
          x: xData,
          y: yData
        };

        res.render("insights", {
          name: foundUser.firstName,
          posts: posts,
          average: avg,
          mostPositive: sortedByScore[0],
          mostNegative: sortedByScore[sortedByScore.length - 1],
          user: foundUser,
          data: JSON.stringify(data)
        });
      }
    }
  });
});

app.listen(process.env.PORT, function () {
  console.log("Server started on port 3000.");
});
