const express = require("express") ;
const { createRoom, joinRoom, roomDetail } = require("../controllers/roomController");
const { userData } = require("../controllers/userController");

const router = express.Router() ;

router.route("/create").post(createRoom)
router.route("/join").post(joinRoom)
router.route("/user").get(userData) 
router.route("/:roomId").get(roomDetail)

module.exports = router ;