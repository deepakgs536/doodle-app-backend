const express = require("express") ;
const { createUser, signIn } = require("../controllers/userController");

const router = express.Router() ;

router.route("/signup").post(createUser)
router.route("/signin").post(signIn)

module.exports = router ;