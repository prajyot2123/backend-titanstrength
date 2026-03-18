const router = require("express").Router();
const userRoutes = require("./user-routes");
const exerciseRoutes = require("./exercise-routes");
const chatRoutes = require("./chat-routes");

router.use("/user", userRoutes);
router.use("/exercise", exerciseRoutes);
router.use("/chat", chatRoutes);

module.exports = router;
