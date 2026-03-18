const router = require("express").Router();
const { chat } = require("../../controllers/chat-controller");
const { optionalAuthMiddleware } = require("../../utils/auth");

router.route("/").post(optionalAuthMiddleware, chat);

module.exports = router;
