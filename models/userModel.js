const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Please enter a username"],
      unique: true, // prevent duplicate usernames
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Please enter an email"],
      unique: true, // prevent duplicate emails
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, "Please enter a password"],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Users", userSchema);
