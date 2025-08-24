const express = require("express") ;
const { createUser, getUsers, signIn, userData } = require("../controllers/userController");
const getAuth = require("../controllers/getAuth");

const router = express.Router() ;

router.route("/").get(userData)
// router.route("/dashboard").get()

module.exports = router ;