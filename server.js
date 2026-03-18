const express = require("express");
require("dotenv").config();
const path = require("path");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const routes = require("./routes");
const db = require("./config/connection");

const PORT = process.env.PORT || 3001;
const app = express();

app.set("trust proxy", 1);

const allowedOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.length === 0) {
        return callback(null, true);
      }
      return callback(null, allowedOrigins.includes(origin));
    },
    credentials: true,
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/chat", chatLimiter);

// Serve up static assets
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../client/build")));
}

// app.get('*', (req, res) => {
//   res.sendFile(path.join(__dirname, '../client/build/index.html'));
// });

app.use(routes);

db.once("open", () => {
  app.listen(PORT, () => {
    console.log(`API server running on port ${PORT}!`);
  });
});
