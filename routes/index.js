const router = require("express").Router();
const path = require("path");
const apiRoutes = require("./api");

router.use("/api", apiRoutes);
router.use((req, res) => {
  const buildPath = path.join(__dirname, "../../client/build/index.html");
  if (process.env.NODE_ENV === "production") {
    return res.sendFile(buildPath, (err) => {
      if (err) {
        return res.status(404).json({ message: "Client build not found." });
      }
      return undefined;
    });
  }
  return res.status(404).json({ message: "Route not found." });
});

module.exports = router;
