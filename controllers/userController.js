const asyncHandler = require("express-async-handler") ;
const Users = require("../models/userModel") ;
const bcrypt = require("bcrypt") ;
const validator = require("validator");
const jwt = require("jsonwebtoken") ;

const createUser = asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;

  // 1. validate email
  if (!validator.isEmail(email)) {
    res.status(400);
    throw new Error("Invalid email format");
  }

  // 2. check if user exists
  const userExists = await Users.findOne({ email });
  if (userExists) {
    res.status(400);
    throw new Error("User already exists");
  }

  // 3. check if username exists
  const usernameExists = await Users.findOne({ username });
  if (usernameExists) {
    res.status(400);
    throw new Error("Username already taken");
  }

  // 4. hash password
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  // 5. create user
  const user = await Users.create({
    username,
    email,
    password: hashedPassword,
  });

  if (user) {
    // 6. generate token
    const token = jwt.sign({ id: user._id }, process.env.PRIVATE_KEY, {
      expiresIn: "30d",
    });

    // 7. send response
    res.status(201).json({
      _id: user._id,
      username: user.username,
      email: user.email,
      accessToken: token,
    });
  } else {
    res.status(400);
    throw new Error("Invalid user data");
  }
});

const userData = asyncHandler(async(req, res) => {
  res.status(200).json({username : req.user.username , email : req.user.email}) ;
})

const signIn = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!validator.isEmail(email)) {
    res.status(400);
    throw new Error("Invalid email format");
  }

  // Check if email exists
  const user = await Users.findOne({ email });
  if (!user) {
    res.status(400);
    throw new Error('Invalid email or password');
  }

  // Compare password
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    res.status(400);
    throw new Error('Invalid email or password');
  }

  // Generate JWT token
  const token = jwt.sign(
    { id: user._id, email: user.email },
    process.env.PRIVATE_KEY,
    { expiresIn: '1d' }
  );

  res.status(200).json({
    message: 'Login successful',
    accessToken: token,
    user: {
      _id: user._id,
      email: user.email,
      username: user.username,
    },
  });
}) ;

const getUsers = asyncHandler(async (req, res) => {
  const users = await Users.find();
  res.status(200).json({users})
})

module.exports = { createUser, userData , getUsers , signIn} ;